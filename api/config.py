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

LLM_ENABLED = os.getenv("LLM_ENABLED", "false").lower() in ("1", "true", "yes")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

# Absolute path to the source-of-truth workbook (seed + BnS sync).
SOURCE_XLSX = os.getenv(
    "SOURCE_XLSX",
    r"d:\Downloads\Open code\Swaniki RFQ Network\BnS_Contacts_Database.xlsx",
)
