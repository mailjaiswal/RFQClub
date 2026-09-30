"""SQLAlchemy engine + session for RFQClub API (SQLite locally, Postgres in prod)."""
from __future__ import annotations
from sqlalchemy import create_engine
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
