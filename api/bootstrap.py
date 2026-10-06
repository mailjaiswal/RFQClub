"""First-boot auto-seed for hosted deploys (Render + Neon).

The FastAPI startup event calls ensure_seeded() — if the rfq table is empty
(e.g. a fresh Neon branch), the demo dataset is rebuilt from the committed
JSON snapshot, with the same demo suppliers + blinded bids as
`seed_rfqs.py --demo-bids`. Neon persists afterwards, so this runs once.
"""
from __future__ import annotations

from sqlalchemy.exc import IntegrityError

import config
import db
import models
import security


def ensure_seeded(session=None) -> bool:
    """Seed RFQs + demo bids when the board is empty. Returns True if seeded."""
    own = session is None
    s = session or db.SessionLocal()
    try:
        if s.query(models.Rfq).count() > 0:
            # Already seeded (e.g. a prod DB that predates the demand_bids
            # column) — non-destructively backfill it so the board can show the
            # true bids-received figure. No-op once every row is populated.
            import seed_rfqs

            n = seed_rfqs.sync_demand_bids(s)
            if n:
                print(f"[bootstrap] backfilled demand_bids on {n} RFQs")
            return False
        # Import here: seed_rfqs imports openpyxl, which exists only on the
        # workbook path; keep bootstrap cheap for the startup event.
        import seed_rfqs

        n = seed_rfqs.seed_rfqs(s)
        m = seed_rfqs.seed_demo_bids(s)
        print(f"[bootstrap] seeded {n} RFQs + demo bids on {m} of them")
        return True
    except IntegrityError:
        # Two cold-start workers can race the empty-table check; the loser
        # simply finds the DB already seeded.
        s.rollback()
        print("[bootstrap] seed skipped (concurrent boot)")
        return False
    finally:
        if own:
            s.close()


def ensure_sales_admin(session=None) -> bool:
    """Seed (once) the first inside-sales console owner so the console is reachable.

    Non-destructive, with one additive exception. When the address does not exist we
    create it as a `sales_manager` carrying `must_change_password=True`, so the
    shipped throwaway starter password is rotated on the very first sign-in. When it
    ALREADY exists (commonly the site owner's Google/OTP account, which may hold a
    marketplace role like `operator`) we must NOT strip that role or clobber any
    password they already set — console entry for them comes from the
    CONSOLE_ADMIN_EMAILS allowlist instead. The only thing we add is a starter
    password, and ONLY if the account has none yet (so email+password sign-in works)
    — flagged must-change. Returns True if anything was created/changed.
    """
    email = (config.SALES_ADMIN_EMAIL or "").strip().lower()
    if not email or "@" not in email:
        return False
    own = session is None
    s = session or db.SessionLocal()
    try:
        u = s.query(models.User).filter(models.User.email == email).first()
        if u is None:
            u = models.User(
                email=email,
                name=config.SALES_ADMIN_NAME or "Admin",
                role="sales_manager",
                password_hash=security.hash_password(config.SALES_ADMIN_PASSWORD),
                must_change_password=True,
                is_active=True,
            )
            s.add(u)
            try:
                s.commit()
            except IntegrityError:
                s.rollback()
                return False
            print(f"[bootstrap] seeded inside-sales manager {email} (must change password on first login)")
            return True
        # Pre-existing account: enable email+password sign-in without touching role
        # or an existing password. Console access itself is granted by the
        # CONSOLE_ADMIN_EMAILS allowlist (see auth.require_sales).
        if not u.password_hash:
            u.password_hash = security.hash_password(config.SALES_ADMIN_PASSWORD)
            u.must_change_password = True
            u.is_active = True
            s.commit()
            print(f"[bootstrap] enabled console sign-in for existing account {email} (starter password set; must change on first login)")
            return True
        return False
    finally:
        if own:
            s.close()
