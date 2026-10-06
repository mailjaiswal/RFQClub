"""Environment/config loader for the RFQClub API.

Reads api/config.env (if present) then os.environ. All accessors are safe
defaults so the API runs without any secrets configured (bot/LLM disabled).
"""
from __future__ import annotations
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    _ENV = Path(__file__).with_name("config.env")
    if _ENV.exists():
        load_dotenv(_ENV)
except Exception:  # dotenv optional
    pass

API_DIR = Path(__file__).resolve().parent
DATA_DIR = API_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'data.db').as_posix()}")
CORS_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001",
).split(",") if o.strip()]
# Broad, deployment-proof origin allowlist so browser mutations work without
# hand-editing env on every host: any Vercel/Render app + local dev. We use
# Bearer tokens (not cookies), so no allow_credentials and this stays safe for
# the demo. Override/extend via CORS_ORIGIN_REGEX if you lock it down later.
CORS_ORIGIN_REGEX = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^(https://[\w.-]+\.vercel\.app|https://[\w.-]+\.onrender\.com|http://localhost:\d+|http://127\.0\.0\.1:\d+)$",
).strip()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
ALLOWED_CHAT_IDS = {int(x) for x in os.getenv("ALLOWED_CHAT_IDS", "").replace(",", " ").split() if x.lstrip("-").isdigit()}
OPERATOR_CHAT_IDS = {int(x) for x in os.getenv("OPERATOR_CHAT_IDS", "").replace(",", " ").split() if x.lstrip("-").isdigit()}

# Auth (email-OTP mock): HMAC secret for stateless session tokens, and the
# delivery mode — "dev" returns the code in the API response (demo, on-screen).
AUTH_SECRET = os.getenv("AUTH_SECRET", "dev-insecure-change-me").strip()
OTP_MODE = os.getenv("OTP_MODE", "dev").strip().lower()

# "Continue with Google" (Google Identity Services ID-token): the Web OAuth
# Client ID whose `aud` we require on the presented token. Unset => Google
# sign-in disabled (endpoint returns 503), everything else still works.
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")

# Transactional email (sign-in codes + password-reset links). Empty key/host =>
# nothing is sent and secrets are surfaced on-screen instead (demo behaviour).
# EMAIL_MODE: auto (pick a configured provider) | dev | resend | smtp.
EMAIL_MODE = os.getenv("EMAIL_MODE", "auto").strip().lower()
EMAIL_FROM = os.getenv("EMAIL_FROM", "RFQClub <onboarding@resend.dev>").strip()
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "0") or 0)
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").strip()
# starttls (587) or ssl (465)
SMTP_SECURITY = os.getenv("SMTP_SECURITY", "starttls").strip().lower()
# Public web origin, used to build password-reset links sent by email.
WEB_BASE_URL = os.getenv("WEB_BASE_URL", "https://rfqclub-web.vercel.app").strip().rstrip("/")

# Emails allowed to take the concierge/operator role (review + publish RFQs).
# Comma-separated. When empty, any signed-in account may claim operator — which is
# what makes the demo review queue reachable without a deploy-time config step; set
# this list for real deployments and the role becomes strictly allowlisted.
OPERATOR_EMAILS = {e.strip().lower() for e in os.getenv("OPERATOR_EMAILS", "").split(",") if e.strip()}


def is_operator_email(email: str) -> bool:
    return (email or "").strip().lower() in OPERATOR_EMAILS


# ---- Inside-sales "internal" area -------------------------------------------------
# A separate, hidden surface for the inside-sales team (see lead_models.py and the
# /api/sales/* router). Unlike OPERATOR_EMAILS — which stays wide-open for the demo
# — this side is FAIL-CLOSED: when SALES_EMAILS is empty nobody can take the sales
# role and every /api/sales/* call is denied, so the area is completely unreachable
# to normal buyer/supplier users until an address is explicitly listed here.
# A manager's email belongs in both lists (managers are reps who also see the
# leaderboard / assignment / CSV-export tools).
SALES_EMAILS = {e.strip().lower() for e in os.getenv("SALES_EMAILS", "").split(",") if e.strip()}
SALES_MANAGER_EMAILS = {e.strip().lower() for e in os.getenv("SALES_MANAGER_EMAILS", "").split(",") if e.strip()}


def is_sales_email(email: str) -> bool:
    e = (email or "").strip().lower()
    return e in SALES_EMAILS or e in SALES_MANAGER_EMAILS


def is_sales_manager_email(email: str) -> bool:
    return (email or "").strip().lower() in SALES_MANAGER_EMAILS


# The very first inside-sales manager, seeded on startup so the console is never
# a locked room with nobody holding a key. Access is otherwise 100% DB-managed
# (a manager provisions reps from the console Team panel), so this seed runs once
# and then never touches the row again — the account is flagged
# `must_change_password` so this temporary password is rotated on first sign-in.
# Override via env before first boot; the shipped default is a throwaway.
SALES_ADMIN_EMAIL = os.getenv("SALES_ADMIN_EMAIL", "mail.jaiswal@gmail.com").strip().lower()
SALES_ADMIN_PASSWORD = os.getenv("SALES_ADMIN_PASSWORD", "Welcome@123")
SALES_ADMIN_NAME = os.getenv("SALES_ADMIN_NAME", "Admin").strip()

# Console owners, independent of the single `role` column. Normally the console is
# gated purely on role (a manager provisions reps from the Team panel). But the
# first admin may already own a marketplace role (e.g. the concierge `operator`) on
# the SAME email — and a user has only one role value — so role alone would force
# them to choose. Listing those emails here grants console/manager access REGARDLESS
# of role, so one account can run the marketplace desk and the console at once.
# Defaults to the seeded admin; comma-separated; compared case-insensitively.
CONSOLE_ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.getenv("CONSOLE_ADMIN_EMAILS", SALES_ADMIN_EMAIL).split(",")
    if e.strip()
}


def is_console_admin(email: str) -> bool:
    return (email or "").strip().lower() in CONSOLE_ADMIN_EMAILS

LLM_ENABLED = os.getenv("LLM_ENABLED", "false").lower() in ("1", "true", "yes")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

# Absolute path to the source-of-truth workbook (seed + BnS sync).
SOURCE_XLSX = os.getenv(
    "SOURCE_XLSX",
    r"d:\Downloads\Open code\Swaniki RFQ Network\BnS_Contacts_Database.xlsx",
)
