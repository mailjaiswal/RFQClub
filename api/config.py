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

LLM_ENABLED = os.getenv("LLM_ENABLED", "false").lower() in ("1", "true", "yes")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

# Absolute path to the source-of-truth workbook (seed + BnS sync).
SOURCE_XLSX = os.getenv(
    "SOURCE_XLSX",
    r"d:\Downloads\Open code\Swaniki RFQ Network\BnS_Contacts_Database.xlsx",
)
