"""Seed the `category` table from `rfq_categories.py`.

The registry file stays the single source of truth for taxonomy (it is also what
`apply_rfq_categories.py` uses to tag the workbooks). This syncs it into the
database so the API can serve research axes and new categories can be turned on
without a code deploy.

Idempotent: safe to run on every boot. Updates label/track/colour/research axes
in place; never deletes a category that has leads attached, it deactivates it.

Usage:
    python seed_categories.py          # sync
    python seed_categories.py --show   # print current state, write nothing
"""
from __future__ import annotations

import sys
from pathlib import Path

API = Path(__file__).resolve().parent
# The registry lives above the app, beside the source workbooks. Walk up until we
# find it rather than hard-coding a depth, so the app can be relocated.
_ROOT = API
while _ROOT != _ROOT.parent and not (_ROOT / "rfq_categories.py").exists():
    _ROOT = _ROOT.parent
if not (_ROOT / "rfq_categories.py").exists():
    raise SystemExit("rfq_categories.py not found above %s" % API)
sys.path.insert(0, str(_ROOT))

import db  # noqa: E402
import lead_models as lm  # noqa: E402
from db import SessionLocal  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

import rfq_categories as rc  # noqa: E402


def sync(session) -> dict:
    existing = {c.key: c for c in session.scalars(select(lm.Category)).all()}
    created, updated, retired = [], [], []

    for order, key in enumerate(rc.CATEGORIES):
        cat = rc.CATEGORIES[key]
        row = existing.get(key)
        if row is None:
            row = lm.Category(key=key)
            session.add(row)
            created.append(key)
        else:
            updated.append(key)

        row.label = cat["label"]
        row.tier = cat["tier"]
        row.default_track = cat.get("default_track", "supplier")
        row.spec_standardization = cat["spec_standardization"]
        row.repeat_frequency = cat["repeat_frequency"]
        row.buyer_urgency = cat["buyer_urgency"]
        row.winning_edge = cat["winning_edge"]
        row.color = cat["color"]
        row.sort_order = order
        row.keyword_count = len(cat.get("keywords", []))
        row.is_active = True

    # Categories dropped from the registry: retire, but only if nothing uses them.
    # Deactivating rather than deleting keeps `company.category_primary` and
    # `lead_script_template.category_key` referentially valid.
    for key, row in existing.items():
        if key in rc.CATEGORIES or not row.is_active:
            continue
        in_use = session.scalar(
            select(func.count())
            .select_from(lm.Company)
            .where(lm.Company.category_primary == key)
        ) or 0
        if in_use:
            row.is_active = False
            retired.append(f"{key} (deactivated, {in_use} companies use it)")
        else:
            session.delete(row)
            retired.append(f"{key} (deleted, unused)")

    session.commit()
    return {"created": created, "updated": updated, "retired": retired}


def show(session) -> None:
    rows = session.scalars(select(lm.Category).order_by(lm.Category.sort_order)).all()
    print("%-14s %-26s %-5s %-9s %s" % ("KEY", "LABEL", "TIER", "TRACK", "URGENCY"))
    print("-" * 78)
    for r in rows:
        print("%-14s %-26s %-5s %-9s %s%s" % (
            r.key, r.label[:26], r.tier, r.default_track, r.buyer_urgency,
            "" if r.is_active else "   [INACTIVE]"))
    t1 = [r for r in rows if r.tier == 1]
    print("\n%d categories (%d Tier 1, %d Tier 2)" % (
        len(rows), len(t1), len(rows) - len(t1)))


def main() -> None:
    db.init_db()
    session = SessionLocal()
    try:
        if "--show" in sys.argv:
            show(session)
            return
        res = sync(session)
        print("category sync complete")
        for k, v in res.items():
            if v:
                print("  %-9s %d  %s" % (k, len(v), ", ".join(v)[:70]))
        print()
        show(session)
    finally:
        session.close()


if __name__ == "__main__":
    main()
