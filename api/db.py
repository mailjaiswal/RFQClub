"""SQLAlchemy engine + session for RFQClub API (SQLite locally, Postgres in prod)."""
from __future__ import annotations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

import config


def _url() -> str:
    """Normalise DATABASE_URL: managed hosts (Render/Neon) hand out plain
    postgresql://, which SQLAlchemy routes to psycopg2 — we ship psycopg3."""
    u = config.DATABASE_URL
    if u.startswith("postgresql://"):
        u = "postgresql+psycopg://" + u[len("postgresql://"):]
    return u


connect_args = {"check_same_thread": False} if _url().startswith("sqlite") else {}
engine = create_engine(_url(), connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    import models  # noqa: F401  (register all tables on Base.metadata)
    Base.metadata.create_all(engine)
    _ensure_user_columns()


def _ensure_user_columns():
    """Lightweight idempotent migration. create_all builds missing tables but
    never adds columns to an existing one (Neon already has `user`), so ALTER
    in the auth columns only when absent — portable across Postgres and SQLite
    (the latter lacks ADD COLUMN IF NOT EXISTS)."""
    cols = {c["name"] for c in inspect(engine).get_columns("user")}
    add = {"name": "VARCHAR DEFAULT ''", "password_hash": "VARCHAR", "google_id": "VARCHAR",
           "last_login": "TIMESTAMP",
           "otp_hash": "VARCHAR", "otp_expires_at": "TIMESTAMP",
           "reset_hash": "VARCHAR", "reset_expires_at": "TIMESTAMP"}
    missing = {col: ddl for col, ddl in add.items() if col not in cols}
    if missing:
        with engine.begin() as cx:
            for col, ddl in missing.items():
                cx.execute(text(f'ALTER TABLE "user" ADD COLUMN {col} {ddl}'))
    # An ALTER-added column arrives without its ORM-declared index, so create
    # those separately (IF NOT EXISTS keeps this safe to re-run).
    indexed = {i["name"] for i in inspect(engine).get_indexes("user")}
    for name, col in (("ix_user_google_id", "google_id"), ("ix_user_reset_hash", "reset_hash")):
        if name not in indexed:
            with engine.begin() as cx:
                cx.execute(text(f'CREATE INDEX IF NOT EXISTS {name} ON "user" ({col})'))
