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
import time

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
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
    return {"id": u.id, "email": u.email, "name": u.name or "", "role": u.role, "created_at": u.created_at.isoformat() if u.created_at else None}


@router.post("/otp/request")
def otp_request(payload: EmailIn, session: Session = Depends(db.get_db)):
    email = _norm(payload.email)
    if not email or "@" not in email or len(email) > 254:
        raise HTTPException(400, "Enter a valid email address")
    _get_or_create_user(session, email)
    code = f"{secrets.randbelow(1_000_000):06d}"
    _OTP[email] = (code, time.time() + OTP_TTL)
    out = {"ok": True, "email": email, "expires_in": int(OTP_TTL)}
    if config.OTP_MODE == "dev":
        out["dev_code"] = code  # mock delivery — shown on screen in demo mode
    return out


@router.post("/otp/verify")
def otp_verify(payload: VerifyIn, session: Session = Depends(db.get_db)):
    email = _norm(payload.email)
    rec = _OTP.get(email)
    if not rec or rec[1] < time.time():
        raise HTTPException(400, "Code expired — request a new one")
    if not hmac.compare_digest(rec[0], (payload.code or "").strip()):
        raise HTTPException(400, "Incorrect code")
    del _OTP[email]
    user = _get_or_create_user(session, email)
    return {"token": make_token(user), "user": _user_out(user)}


@router.post("/register")
def register(payload: RegisterIn, session: Session = Depends(db.get_db)):
    email = _norm(payload.email)
    if not email or "@" not in email or len(email) > 254:
        raise HTTPException(400, "Enter a valid email address")
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
    session.commit()
    return {"token": make_token(user), "user": _user_out(user), "is_new": True}


@router.post("/login")
def login(payload: LoginIn, session: Session = Depends(db.get_db)):
    email = _norm(payload.email)
    user = session.query(models.User).filter(models.User.email == email).first()
    if user and not user.password_hash:
        raise HTTPException(401, "This account uses the one-time code or Google — sign in that way")
    if not user or not security.verify_password(payload.password or "", user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
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
def google(payload: GoogleIn, session: Session = Depends(db.get_db)):
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
    session.commit()
    return {"token": make_token(user), "user": _user_out(user), "is_new": is_new}


@router.post("/forgot")
def forgot(payload: EmailIn, session: Session = Depends(db.get_db)):
    """Start a password reset. Always reports ok so it never leaks which emails
    have accounts. When an account exists we mint a single-use token; in dev mode
    it is returned so the UI can present the reset step directly (mock delivery).
    """
    email = _norm(payload.email)
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
def reset(payload: ResetIn, session: Session = Depends(db.get_db)):
    """Consume a reset token and set a new password, then sign the user in."""
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
    session.commit()
    return {"token": make_token(user), "user": _user_out(user), "is_new": False}


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
