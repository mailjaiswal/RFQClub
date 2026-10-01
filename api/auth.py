"""Auth for RFQClub: email + password (with forgot/reset), "Continue with Google"
(ID-token), and the original email-OTP (mock delivery) — all issuing the same
stateless bearer token.

Sessions are stateless HMAC-signed bearer tokens (email|role|exp.sig) so the
Vercel frontend can call this API cross-site without cookie gymnastics. The
delivery of an OTP is mocked in dev: the 6-digit code is returned in the API
response and shown on the login screen, clearly labelled as such in the UI.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import config
import db
import models
import security

router = APIRouter(prefix="/api/auth", tags=["auth"])

# In-memory OTP store: email -> (code, expiry_epoch). Codes are short-lived;
# a server restart simply invalidates pending codes (request a new one).
_OTP: dict[str, tuple[str, float]] = {}
OTP_TTL = 600.0
# In-memory password-reset store: email -> (single-use token, expiry_epoch).
# Delivery is mocked like the OTP: in dev the token is returned in the response
# and the UI jumps straight to the reset step (no email provider is wired up).
_RESET: dict[str, tuple[str, float]] = {}
RESET_TTL = 3600.0
TOKEN_TTL = 7 * 86400

ROLES = ("buyer", "supplier", "operator")

# ---- simple in-process rate limiter (sliding window) ----
# Render runs this API as a single free-tier process, so an in-memory bucket is
# enough to blunt credential-stuffing and email enumeration without new deps.
# (For multi-instance/elastic scaling move this to Redis.)
_RATE: dict[str, list[float]] = {}
_RATE_LOCK = threading.Lock()


def _client_ip(request: Request | None) -> str:
    if request is None:
        return "unknown"
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _throttle(bucket: str, limit: int, window: float) -> None:
    """Record a hit for `bucket`; raise 429 once it exceeds `limit` in `window`s."""
    now = time.time()
    with _RATE_LOCK:
        hits = [t for t in _RATE.get(bucket, ()) if now - t < window]
        if len(hits) >= limit:
            _RATE[bucket] = hits
            retry = int(window - (now - hits[0])) + 1
            raise HTTPException(429, f"Too many attempts — please wait {retry}s and try again")
        hits.append(now)
        _RATE[bucket] = hits
        if len(_RATE) > 5000:  # opportunistic prune of stale buckets
            for k in [k for k, v in _RATE.items() if not v or now - v[-1] > 3600]:
                _RATE.pop(k, None)


def _stamp_login(user: models.User) -> None:
    user.last_login = datetime.now(timezone.utc)


class EmailIn(BaseModel):
    email: str


class VerifyIn(BaseModel):
    email: str
    code: str


class RoleIn(BaseModel):
    role: str


class RegisterIn(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class GoogleIn(BaseModel):
    credential: str


class ResetIn(BaseModel):
    token: str
    password: str


class PasswordIn(BaseModel):
    current_password: str = ""
    new_password: str


def _norm(email: str) -> str:
    return (email or "").strip().lower()


def _get_or_create_user(session: Session, email: str) -> models.User:
    user = session.query(models.User).filter(models.User.email == email).first()
    if not user:
        user = models.User(email=email)
        session.add(user)
        session.commit()
    return user


def _sign(payload: str) -> str:
    return hmac.new(config.AUTH_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token(user: models.User) -> str:
    payload = f"{user.email}|{user.role}|{int(time.time()) + TOKEN_TTL}"
    return f"{payload}.{_sign(payload)}"


def parse_token(token: str) -> str | None:
    """Return the email embedded in a valid, unexpired token, else None."""
    try:
        payload, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(_sign(payload), sig):
            return None
        email, _role, exp = payload.rsplit("|", 2)
        if int(exp) < time.time():
            return None
        return email
    except ValueError:
        return None


def user_from_header(authorization: str | None, session: Session) -> models.User | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    email = parse_token(authorization[7:].strip())
    if not email:
        return None
    return _get_or_create_user(session, email)


def optional_user(
    authorization: str | None = Header(default=None),
    session: Session = Depends(db.get_db),
) -> models.User | None:
    """FastAPI dependency: the signed-in user, or None for anonymous visitors."""
    return user_from_header(authorization, session)


def require_user(user: models.User | None = Depends(optional_user)) -> models.User:
    if user is None:
        raise HTTPException(401, "Sign in required")
    return user


def _user_out(u: models.User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name or "", "role": u.role,
            "has_password": bool(u.password_hash),
            "last_login": u.last_login.isoformat() if u.last_login else None,
            "created_at": u.created_at.isoformat() if u.created_at else None}


@router.post("/otp/request")
def otp_request(payload: EmailIn, request: Request, session: Session = Depends(db.get_db)):
    email = _norm(payload.email)
    if not email or "@" not in email or len(email) > 254:
        raise HTTPException(400, "Enter a valid email address")
    _throttle(f"otp:{email}", 6, 900)
    _throttle(f"otpip:{_client_ip(request)}", 30, 900)
    _get_or_create_user(session, email)
    code = f"{secrets.randbelow(1_000_000):06d}"
    _OTP[email] = (code, time.time() + OTP_TTL)
    out = {"ok": True, "email": email, "expires_in": int(OTP_TTL)}
    if config.OTP_MODE == "dev":
        out["dev_code"] = code  # mock delivery — shown on screen in demo mode
    return out


@router.post("/otp/verify")
def otp_verify(payload: VerifyIn, request: Request, session: Session = Depends(db.get_db)):
    email = _norm(payload.email)
    _throttle(f"otpverify:{email}", 8, 300)
    rec = _OTP.get(email)
    if not rec or rec[1] < time.time():
        raise HTTPException(400, "Code expired — request a new one")
    if not hmac.compare_digest(rec[0], (payload.code or "").strip()):
        raise HTTPException(400, "Incorrect code")
    del _OTP[email]
    user = _get_or_create_user(session, email)
    _stamp_login(user)
    session.commit()
    return {"token": make_token(user), "user": _user_out(user)}


@router.post("/register")
def register(payload: RegisterIn, request: Request, session: Session = Depends(db.get_db)):
    email = _norm(payload.email)
    if not email or "@" not in email or len(email) > 254:
        raise HTTPException(400, "Enter a valid email address")
    _throttle(f"register:{email}|{_client_ip(request)}", 8, 3600)
    password = payload.password or ""
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    user = session.query(models.User).filter(models.User.email == email).first()
    if user and user.password_hash:
        raise HTTPException(409, "An account with this email already exists — sign in instead")
    if not user:
        user = models.User(email=email)
        session.add(user)
    user.password_hash = security.hash_password(password)
    if payload.name.strip():
        user.name = payload.name.strip()
    _stamp_login(user)  # registration signs the user straight in
    session.commit()
    return {"token": make_token(user), "user": _user_out(user), "is_new": True}


@router.post("/login")
def login(payload: LoginIn, request: Request, session: Session = Depends(db.get_db)):
    email = _norm(payload.email)
    ip = _client_ip(request)
    _throttle(f"login:{email}|{ip}", 10, 300)
    _throttle(f"loginip:{ip}", 40, 600)
    user = session.query(models.User).filter(models.User.email == email).first()
    if user and not user.password_hash:
        raise HTTPException(401, "This account uses the one-time code or Google — sign in that way")
    if not user or not security.verify_password(payload.password or "", user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    _stamp_login(user)
    session.commit()
    return {"token": make_token(user), "user": _user_out(user), "is_new": False}


def _verify_google_id_token(credential: str) -> dict:
    """Validate a Google Identity Services ID token via Google's tokeninfo
    endpoint (no extra dependency). Returns the claims or raises HTTPException."""
    if not config.GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google sign-in is not configured on this server")
    try:
        r = httpx.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential}, timeout=8.0)
    except httpx.HTTPError:
        raise HTTPException(502, "Could not reach Google to verify the sign-in")
    if r.status_code != 200:
        raise HTTPException(401, "Google sign-in failed — token rejected")
    try:
        claims = r.json()
    except ValueError:
        raise HTTPException(401, "Google sign-in failed — bad response")
    if claims.get("aud") != config.GOOGLE_CLIENT_ID:
        raise HTTPException(401, "Google sign-in failed — token audience mismatch")
    if claims.get("iss") not in config.GOOGLE_ISSUERS:
        raise HTTPException(401, "Google sign-in failed — unexpected issuer")
    email = _norm(claims.get("email", ""))
    if not email or claims.get("email_verified") is False:
        raise HTTPException(401, "Google account email is not verified")
    return {"email": email, "google_id": claims.get("sub", ""), "name": claims.get("name", "")}


@router.post("/google")
def google(payload: GoogleIn, request: Request, session: Session = Depends(db.get_db)):
    _throttle(f"google:{_client_ip(request)}", 20, 3600)
    info = _verify_google_id_token(payload.credential)
    user = session.query(models.User).filter(models.User.email == info["email"]).first()
    is_new = user is None
    if not user:
        user = models.User(email=info["email"])
        session.add(user)
    if info["google_id"]:
        user.google_id = info["google_id"]
    if info["name"] and not user.name:
        user.name = info["name"]
    _stamp_login(user)
    session.commit()
    return {"token": make_token(user), "user": _user_out(user), "is_new": is_new}


@router.post("/forgot")
def forgot(payload: EmailIn, request: Request, session: Session = Depends(db.get_db)):
    """Start a password reset. Always reports ok so it never leaks which emails
    have accounts. When an account exists we mint a single-use token; in dev mode
    it is returned so the UI can present the reset step directly (mock delivery).
    """
    email = _norm(payload.email)
    _throttle(f"forgot:{email}", 5, 3600)
    _throttle(f"forgotip:{_client_ip(request)}", 20, 3600)
    out = {"ok": True, "expires_in": int(RESET_TTL)}
    user = session.query(models.User).filter(models.User.email == email).first()
    if user:
        # drop any prior pending link, then issue a fresh one
        token = secrets.token_urlsafe(32)
        _RESET[email] = (token, time.time() + RESET_TTL)
        if config.OTP_MODE == "dev":
            out["dev_reset_token"] = token  # mock delivery — used directly by the UI
    return out


@router.post("/reset")
def reset(payload: ResetIn, request: Request, session: Session = Depends(db.get_db)):
    """Consume a reset token and set a new password, then sign the user in."""
    _throttle(f"reset:{_client_ip(request)}", 20, 3600)
    token = (payload.token or "").strip()
    password = payload.password or ""
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    email = None
    for candidate, (tok, exp) in list(_RESET.items()):
        if hmac.compare_digest(tok, token):
            email = candidate
            if exp < time.time():
                del _RESET[candidate]
                raise HTTPException(400, "Reset link expired — request a new one")
            break
    if email is None:
        raise HTTPException(400, "Invalid or expired reset link")
    user = session.query(models.User).filter(models.User.email == email).first()
    del _RESET[email]  # single-use, whether or not the user lookup succeeds
    if not user:
        raise HTTPException(400, "Invalid or expired reset link")
    user.password_hash = security.hash_password(password)
    _stamp_login(user)  # reset signs the user in
    session.commit()
    return {"token": make_token(user), "user": _user_out(user), "is_new": False}


@router.post("/password")
def change_password(payload: PasswordIn, request: Request,
                    user: models.User = Depends(require_user),
                    session: Session = Depends(db.get_db)):
    """Change (or, for a Google/OTP-only account, set) the password. Requires a
    valid bearer token; if the account already has a password, the current one
    must match. Does NOT re-issue a token — the session stays valid."""
    _throttle(f"pw:{user.email}", 6, 900)
    new = payload.new_password or ""
    if len(new) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")
    if user.password_hash:
        if not security.verify_password(payload.current_password or "", user.password_hash):
            raise HTTPException(401, "Current password is incorrect")
        if security.verify_password(new, user.password_hash):
            raise HTTPException(400, "New password must be different from the current one")
    user.password_hash = security.hash_password(new)
    session.commit()
    return {"ok": True, "user": _user_out(user)}


@router.get("/me")
def me(user: models.User | None = Depends(optional_user)):
    if user is None:
        raise HTTPException(401, "Not signed in")
    return {"user": _user_out(user)}


@router.post("/role")
def set_role(payload: RoleIn, user: models.User = Depends(require_user), session: Session = Depends(db.get_db)):
    role = (payload.role or "").strip().lower()
    if role not in ROLES:
        raise HTTPException(400, f"role must be one of {', '.join(ROLES)}")
    user.role = role
    session.commit()
    # role is embedded in the token — issue a fresh one
    return {"token": make_token(user), "user": _user_out(user)}
