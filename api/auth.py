"""Email-OTP auth (mock delivery) for RFQClub.

Demo mode: the 6-digit code is returned in the API response and shown on the
login screen instead of being emailed — clearly labelled as such in the UI.
Sessions are stateless HMAC-signed bearer tokens (email|role|exp.sig) so the
Vercel frontend can call this API cross-site without cookie gymnastics.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import config
import db
import models

router = APIRouter(prefix="/api/auth", tags=["auth"])

# In-memory OTP store: email -> (code, expiry_epoch). Codes are short-lived;
# a server restart simply invalidates pending codes (request a new one).
_OTP: dict[str, tuple[str, float]] = {}
OTP_TTL = 600.0
TOKEN_TTL = 7 * 86400

ROLES = ("buyer", "supplier", "operator")


class EmailIn(BaseModel):
    email: str


class VerifyIn(BaseModel):
    email: str
    code: str


class RoleIn(BaseModel):
    role: str


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
    return {"id": u.id, "email": u.email, "role": u.role, "created_at": u.created_at.isoformat() if u.created_at else None}


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
