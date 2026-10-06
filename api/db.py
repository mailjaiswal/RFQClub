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


sqlite_only = _url().startswith("sqlite")
connect_args = {"check_same_thread": False} if sqlite_only else {}

# Managed Postgres (Neon) poolers close long-lived/idle-in-transaction
# connections, which killed a bulk import mid-run. pre_ping validates a
# pooled connection before checkout so a stale handle is transparently replaced
# instead of erroring mid-transaction.
#
# `pool_recycle` is the console's latency lever: a recycled-out connection is
# rebuilt on checkout, and a fresh Neon connection costs TCP + TLS + auth
# (~0.5-1s from Render). At the old 20s, low-traffic consoles paid that rebuild
# on almost every click. pre_ping already catches dead handles, so recycling can
# be patient; the pool stays warm between requests instead.
engine = create_engine(
    _url(), connect_args=connect_args, future=True,
    pool_pre_ping=True,
    pool_recycle=1800 if not sqlite_only else 20,
    # SQLite ignores pool sizing, so only hand these to Postgres (QueuePool).
    **({} if sqlite_only else {"pool_size": 5, "max_overflow": 10, "pool_timeout": 15}),
)
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
    import lead_models  # noqa: F401  (inside-sales lead system tables)
    Base.metadata.create_all(engine)
    _ensure_user_columns()
    _ensure_draft_columns()
    _ensure_rfq_columns()
    _ensure_award_columns()
    _ensure_lead_columns()


def _ensure_columns(table: str, add: dict[str, str], indexes: tuple[tuple[str, str], ...] = ()) -> None:
    """Add missing columns (and their indexes) to an existing table.

    `create_all` builds missing tables but never adds columns to an existing one,
    so each additive column is ALTERed in only when absent — portable across
    Postgres and SQLite (the latter lacks ADD COLUMN IF NOT EXISTS). An
    ALTER-added column also arrives without its ORM-declared index, hence the
    separate CREATE INDEX IF NOT EXISTS pass."""
    cols = {c["name"] for c in inspect(engine).get_columns(table)}
    missing = {col: ddl for col, ddl in add.items() if col not in cols}
    if missing:
        with engine.begin() as cx:
            for col, ddl in missing.items():
                cx.execute(text(f'ALTER TABLE "{table}" ADD COLUMN {col} {ddl}'))
    if indexes:
        have = {i["name"] for i in inspect(engine).get_indexes(table)}
        for name, col in indexes:
            if name not in have:
                with engine.begin() as cx:
                    cx.execute(text(f'CREATE INDEX IF NOT EXISTS {name} ON "{table}" ({col})'))


def _ensure_user_columns():
    """Lightweight idempotent migration for the auth columns on `user` (Neon
    already has the table, so ALTER only what is missing)."""
    _ensure_columns(
        "user",
        {"name": "VARCHAR DEFAULT ''", "password_hash": "VARCHAR", "google_id": "VARCHAR",
         "last_login": "TIMESTAMP",
         "otp_hash": "VARCHAR", "otp_expires_at": "TIMESTAMP",
         "reset_hash": "VARCHAR", "reset_expires_at": "TIMESTAMP",
         "must_change_password": "BOOLEAN DEFAULT FALSE",
         "is_active": "BOOLEAN DEFAULT TRUE"},
        (("ix_user_google_id", "google_id"), ("ix_user_reset_hash", "reset_hash")),
    )


def _ensure_draft_columns():
    """Concierge review trail on `pending_draft`."""
    _ensure_columns(
        "pending_draft",
        {"user_id": "INTEGER", "source": "VARCHAR DEFAULT 'telegram'",
         "reviewed_by": "VARCHAR DEFAULT ''", "reject_reason": "TEXT DEFAULT ''"},
        (("ix_pending_draft_user_id", "user_id"),),
    )


def _ensure_rfq_columns():
    """Board demand column: `demand_bids` = the real bids-received figure shown
    on the board, kept separate from `bid_count` (the <=5 blinded quotes the
    compare screen can actually reveal)."""
    _ensure_columns("rfq", {"demand_bids": "INTEGER DEFAULT 0"})


def _ensure_award_columns():
    """Post-award escrow / managed-QC / milestone tracking on `award`."""
    _ensure_columns(
        "award",
        {"escrow_status": "VARCHAR DEFAULT 'not_started'",
         "qc_status": "VARCHAR DEFAULT 'n/a'",
         "milestones": "JSON DEFAULT '[]'",
         "order_updated_at": "TIMESTAMP"},
    )


def _ensure_lead_columns():
    """Additive columns added to the inside-sales tables after their first deploy.

    `create_all` already builds these nine tables from scratch, so this is empty
    on a clean database and only fires when a column is appended later. Declared
    here (rather than at the point of use) to keep every schema change routed
    through one idempotent, SQLite+Postgres-safe path.

    Each entry must stay additive-only: never drop or retype a shipped column.
    """
    _ensure_columns("company", {
        "source_note": "TEXT DEFAULT ''",
    })
    _ensure_columns("lead", {
        "source_note": "TEXT DEFAULT ''",
    })
