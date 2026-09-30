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
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
ALLOWED_CHAT_IDS = {int(x) for x in os.getenv("ALLOWED_CHAT_IDS", "").replace(",", " ").split() if x.lstrip("-").isdigit()}
OPERATOR_CHAT_IDS = {int(x) for x in os.getenv("OPERATOR_CHAT_IDS", "").replace(",", " ").split() if x.lstrip("-").isdigit()}

LLM_ENABLED = os.getenv("LLM_ENABLED", "false").lower() in ("1", "true", "yes")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")

# Absolute path to the source-of-truth workbook (seed + BnS sync).
SOURCE_XLSX = os.getenv(
    "SOURCE_XLSX",
    r"d:\Downloads\Open code\Swaniki RFQ Network\BnS_Contacts_Database.xlsx",
)
