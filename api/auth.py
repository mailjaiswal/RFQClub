"""Auth for RFQClub: email + password (with forgot/reset), "Continue with Google"
(ID-token), and the original email-OTP — all issuing the same stateless bearer
token.

Sessions are stateless HMAC-signed bearer tokens (email|role|exp.sig) so the
Vercel frontend can call this API cross-site without cookie gymnastics.

Sign-in codes and reset links are emailed through `mailer` (Resend or SMTP) when
a provider is configured. With none configured — or if a send fails — and
`OTP_MODE=dev`, the secret is returned in the API response and shown on the login
screen instead, clearly labelled as such in the UI, so the demo never dead-ends.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import config
import db
import mailer
import models
import security

router = APIRouter(prefix="/api/auth", tags=["auth"])

# OTP fallback store: email -> (code, expiry_epoch), used only for an address that
# has no user row yet; otherwise codes live on the row (otp_hash) and survive a
# restart. Either way codes are short-lived.
_OTP: dict[str, tuple[str, float]] = {}
OTP_TTL = 600.0
# Password-reset fallback store: email -> (single-use token, expiry_epoch). Like
# the OTP, a real token is persisted on the user row (reset_hash) and emailed when
# a mail provider is configured; this dict covers the dev/no-row case.
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


# ---- durable one-time secrets ---------------------------------------------
# Codes and reset links live on the user row (as keyed digests) so they survive
# a restart and work across instances; the in-memory dicts above remain only as a
# fallback for an address that has no row yet.


def _epoch(dt: datetime | None) -> float:
    """UTC epoch for a datetime that arrives tz-aware (Postgres) or naive (SQLite)."""
    if dt is None:
        return 0.0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _future(seconds: float) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


def _store_otp(session: Session, email: str, code: str, ttl: float) -> None:
    user = session.query(models.User).filter(models.User.email == email).first()
    if user is not None:
        user.otp_hash = _sign(code)
        user.otp_expires_at = _future(ttl)
        session.commit()
    else:
        _OTP[email] = (code, time.time() + ttl)


def _check_otp(session: Session, email: str, code: str) -> str:
    """Classify a presented code as 'ok' | 'bad' | 'expired' | 'none'."""
    user = session.query(models.User).filter(models.User.email == email).first()
    if user is not None and user.otp_hash:
        if _epoch(user.otp_expires_at) < time.time():
            _clear_otp(session, email)
            return "expired"
        return "ok" if hmac.compare_digest(user.otp_hash, _sign(code)) else "bad"
    rec = _OTP.get(email)
    if not rec:
        return "none"
    if rec[1] < time.time():
        _OTP.pop(email, None)
        return "expired"
    return "ok" if hmac.compare_digest(rec[0], code) else "bad"


def _clear_otp(session: Session, email: str) -> None:
    user = session.query(models.User).filter(models.User.email == email).first()
    if user is not None and (user.otp_hash or user.otp_expires_at):
        user.otp_hash = None
        user.otp_expires_at = None
        session.commit()
    _OTP.pop(email, None)


def _store_reset(session: Session, email: str, token: str, ttl: float) -> None:
    """Persist a single-use reset token (superseding any earlier one)."""
    user = session.query(models.User).filter(models.User.email == email).first()
    if user is not None:
        user.reset_hash = _sign(token)
        user.reset_expires_at = _future(ttl)
        session.commit()
    else:
        _RESET[email] = (token, time.time() + ttl)


def _consume_reset(session: Session, token: str) -> models.User:
    """Return the user matching this token, invalidating it. Raises 400 otherwise."""
    user = session.query(models.User).filter(models.User.reset_hash == _sign(token)).first()
    if user is not None:
        expired = _epoch(user.reset_expires_at) < time.time()
        user.reset_hash = None
        user.reset_expires_at = None
        session.commit()
        if expired:
            raise HTTPException(400, "Reset link expired — request a new one")
        return user
    for email, (tok, exp) in list(_RESET.items()):
        if hmac.compare_digest(tok, token):
            del _RESET[email]
            if exp < time.time():
                raise HTTPException(400, "Reset link expired — request a new one")
            fallback = session.query(models.User).filter(models.User.email == email).first()
            if fallback is None:
                raise HTTPException(400, "Invalid or expired reset link")
            return fallback
    raise HTTPException(400, "Invalid or expired reset link")


def _attempt(send, *args) -> str | None:
    """Try to email something. Returns None on success, or a human-readable reason
    when there is no provider configured or the send failed."""
    try:
        if mailer.provider() == "dev":
            return "no email provider is configured on this server"
        send(*args)
        return None
    except mailer.MailError as exc:
        return str(exc)


def _reveal_or_fail(out: dict, key: str, secret: str, detail: str | None,
                    missing_msg: str) -> dict:
    """Delivery couldn't happen (no provider, or the send failed). In demo mode we
    surface the secret on-screen so the flow stays usable and say why; otherwise
    we fail loudly rather than pretending an email went out."""
    if config.OTP_MODE == "dev":
        if secret:
            out[key] = secret
        if detail:
            out["delivery_warning"] = detail
        return out
    raise HTTPException(503, detail or missing_msg)


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
    _store_otp(session, email, code, OTP_TTL)
    out = {"ok": True, "email": email, "expires_in": int(OTP_TTL)}
    detail = _attempt(mailer.send_otp, email, code, int(OTP_TTL // 60))
    if detail is None:
        out["delivery"] = "email"
        return out
    return _reveal_or_fail(out, "dev_code", code, detail,
                           "Could not email a code — contact support")


@router.post("/otp/verify")
def otp_verify(payload: VerifyIn, request: Request, session: Session = Depends(db.get_db)):
    email = _norm(payload.email)
    _throttle(f"otpverify:{email}", 8, 300)
    state = _check_otp(session, email, (payload.code or "").strip())
    if state == "expired" or state == "none":
        raise HTTPException(400, "Code expired — request a new one")
    if state == "bad":
        raise HTTPException(400, "Incorrect code")
    _clear_otp(session, email)
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
    have accounts. When an account exists we mint a single-use token, persist it on
    the user row, and email a reset link. With no mail provider (or a failed send)
    in dev mode the token is returned so the UI can present the reset step.
    """
    email = _norm(payload.email)
    _throttle(f"forgot:{email}", 5, 3600)
    _throttle(f"forgotip:{_client_ip(request)}", 20, 3600)
    out = {"ok": True, "expires_in": int(RESET_TTL)}
    user = session.query(models.User).filter(models.User.email == email).first()
    if not user:
        return out  # unknown address: say nothing, issue nothing
    # issuing a fresh link supersedes any earlier pending one
    token = secrets.token_urlsafe(32)
    _store_reset(session, email, token, RESET_TTL)
    link = f"{config.WEB_BASE_URL}/login?reset={token}"
    detail = _attempt(mailer.send_reset_link, email, link, int(RESET_TTL // 60))
    if detail is None:
        out["delivery"] = "email"
        return out
    return _reveal_or_fail(out, "dev_reset_token", token, detail,
                           "Could not email a reset link — contact support")


@router.post("/reset")
def reset(payload: ResetIn, request: Request, session: Session = Depends(db.get_db)):
    """Consume a reset token and set a new password, then sign the user in."""
    _throttle(f"reset:{_client_ip(request)}", 20, 3600)
    token = (payload.token or "").strip()
    password = payload.password or ""
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    user = _consume_reset(session, token)  # single-use; raises 400 if invalid/expired
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
