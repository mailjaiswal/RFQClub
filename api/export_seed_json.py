"""Export the seeded RFQ rows to a portable JSON snapshot.

Run this once locally (after seeding from the source workbook) to commit
`api/seed_data/rfqs.json`. Hosted deploys (Render) have no access to the
Windows workbook path, so `seed_rfqs.py` falls back to this snapshot —
see bootstrap.py for the first-boot auto-seed.

Run:  python export_seed_json.py
"""
from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path

import db
import models

OUT = Path(__file__).with_name("seed_data") / "rfqs.json"

# Columns carried verbatim into the snapshot (ids preserved so RFQ·0001.. stay stable).
FIELDS = [
    "id", "title", "sector_key", "process", "material", "qty", "unit",
    "budget_low", "budget_high", "currency", "budget_status", "est_total",
    "closes_in_days", "bid_count", "description", "attachments", "clarify",
    "routing_cap", "status", "issuer_name", "matched_supplier", "spec_notes",
    "tags", "hub_city",
]


def main():
    db.init_db()
    s = db.SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        rows = []
        for r in s.query(models.Rfq).order_by(models.Rfq.id).all():
            d = {f: getattr(r, f) for f in FIELDS}
            # Deadlines are relative in the workbook; carry offsets, recompute on seed.
            ca = r.created_at.replace(tzinfo=timezone.utc) if r.created_at and r.created_at.tzinfo is None else r.created_at
            d["created_ago_days"] = max(0, (now - ca).days) if ca else 0
            if r.closes_at:
                cl = r.closes_at.replace(tzinfo=timezone.utc) if r.closes_at.tzinfo is None else r.closes_at
                d["closes_in_from_now"] = round((cl - now).total_seconds() / 86400.0, 4)
            else:
                d["closes_in_from_now"] = None
            rows.append(d)
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Exported {len(rows)} RFQs -> {OUT}")
    finally:
        s.close()


if __name__ == "__main__":
    main()
