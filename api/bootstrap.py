"""First-boot auto-seed for hosted deploys (Render + Neon).

The FastAPI startup event calls ensure_seeded() — if the rfq table is empty
(e.g. a fresh Neon branch), the demo dataset is rebuilt from the committed
JSON snapshot, with the same demo suppliers + blinded bids as
`seed_rfqs.py --demo-bids`. Neon persists afterwards, so this runs once.
"""
from __future__ import annotations

from sqlalchemy.exc import IntegrityError

import db
import models


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
