"""Seed the rfq table from the RFQ Demand sheet of the source workbook.

Idempotent: clears existing rfq rows then re-inserts the 67 parsed rows.
When the workbook is unavailable (hosted deploys have no Windows path), the
same rows come from the committed portable snapshot in seed_data/rfqs.json
(produced locally with export_seed_json.py).
Optionally seeds demo suppliers + blinded bids for the first few RFQs so the
bids/compare endpoints have data to serve during local dev (--demo-bids).

Run:  python seed_rfqs.py [--demo-bids]
"""
from __future__ import annotations
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl

import config
import db
import models
import rfq_parser
import rfq_tags
from sectors import classify

SEED_JSON = Path(__file__).with_name("seed_data") / "rfqs.json"


def _clear_rfqs(session):
    # Child-first: award references both bid and rfq, save_item references rfq,
    # bid references rfq. SQLite ignores FKs so the old order passed locally,
    # but Postgres enforces them — this order is required there.
    session.query(models.SaveItem).delete()
    session.query(models.Award).delete()
    session.query(models.Bid).delete()
    session.query(models.Rfq).delete()
    session.commit()


def _sync_sequences(session):
    """RFQs are seeded with explicit ids, which leaves the Postgres identity
    sequence behind (next insert collides with id=1). Advance it past the max.
    No-op on SQLite, where rowid already tracks the max."""
    if session.get_bind().dialect.name != "postgresql":
        return
    from sqlalchemy import text
    session.execute(text(
        "SELECT setval(pg_get_serial_sequence('rfq','id'), "
        "(SELECT COALESCE(MAX(id), 1) FROM rfq))"
    ))
    session.commit()


def _norm(s) -> str:
    import re
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _hub_lookup() -> dict:
    """normalized company -> Hub / City, from the All Contacts sheet.

    Best-effort proxy only: a matched supplier resolves to its contacts city when
    present, otherwise it stays unset (never fabricated). """
    wb = openpyxl.load_workbook(config.SOURCE_XLSX, read_only=True, data_only=True)
    ws = wb["All Contacts"]
    rows = ws.iter_rows(values_only=True)
    header = [str(h).strip() if h is not None else "" for h in next(rows)]
    try:
        ci = header.index("Company")
        hi = header.index("Hub / City")
    except ValueError:
        return {}
    out: dict = {}
    for r in rows:
        if not r or ci >= len(r) or hi >= len(r):
            continue
        key = _norm(r[ci])
        city = str(r[hi]).strip() if r[hi] is not None else ""
        if key and city and city.lower() not in ("none", "") and key not in out:
            out[key] = city
    return out


def _to_days(raw) -> int | None:
    if raw is None:
        return None
    s = str(raw)
    m = s.lower()
    if "day" in m or "hour" in m or "week" in m or "month" in m:
        return rfq_parser._closes_days(m)
    try:
        return int(float(s))
    except Exception:
        return None


def seed_rfqs(session):
    if not Path(config.SOURCE_XLSX).exists():
        return _seed_from_json(session)
    try:
        return _seed_from_workbook(session)
    except OSError:
        # Network share down / file locked — the committed snapshot is equivalent.
        return _seed_from_json(session)


def _seed_from_json(session) -> int:
    """Portable path: rebuild the RFQ rows from the committed JSON snapshot."""
    rows = json.loads(SEED_JSON.read_text(encoding="utf-8"))
    _clear_rfqs(session)
    now = datetime.now(timezone.utc)
    count = 0
    for d in rows:
        rfq = models.Rfq(**{k: v for k, v in d.items() if k not in ("created_ago_days", "closes_in_from_now")})
        rfq.created_at = now - timedelta(days=int(d.get("created_ago_days") or 0))
        off = d.get("closes_in_from_now")
        rfq.closes_at = now + timedelta(days=float(off)) if off is not None else None
        session.add(rfq)
        count += 1
    session.commit()
    _sync_sequences(session)
    return count


def _seed_from_workbook(session) -> int:
    wb = openpyxl.load_workbook(config.SOURCE_XLSX, read_only=True, data_only=True)
    ws = wb["RFQ Demand"]
    rows = list(ws.iter_rows(values_only=True))
    header = [str(h).strip() if h is not None else "" for h in rows[0]]
    idx = {h: i for i, h in enumerate(header)}

    def get(r, name):
        i = idx.get(name)
        return r[i] if i is not None and i < len(r) else None

    _clear_rfqs(session)

    hubs = _hub_lookup()
    now = datetime.now(timezone.utc)
    count = 0
    for r in rows[1:]:
        if r is None or get(r, "RFQ Title") is None:
            continue
        title = str(get(r, "RFQ Title")).strip()
        process = str(get(r, "Process") or "").strip()
        material = str(get(r, "Material / Grade") or "").strip()
        spec_notes = str(get(r, "Spec Notes") or "").strip()
        matched = str(get(r, "Matched Supplier Co (in contacts)") or "").strip()
        days = _to_days(get(r, "Closes In"))
        try:
            rid = int(get(r, "#"))
        except Exception:
            rid = None
        sector_key = classify(process, title, material)
        rfq = models.Rfq(
            title=title,
            sector_key=sector_key,
            process=process,
            material=material,
            qty=get(r, "Qty"),
            unit=str(get(r, "Unit") or "").strip(),
            budget_low=get(r, "Budget Low"),
            budget_high=get(r, "Budget High"),
            currency=(str(get(r, "Currency") or "₹").strip() or "₹"),
            budget_status=str(get(r, "Budget Status") or "Open").strip(),
            est_total=get(r, "Est. Total (native)"),
            closes_in_days=days,
            closes_at=(now + timedelta(days=days) if days is not None else None),
            bid_count=int(get(r, "Bids") or 0),
            description=title,
            routing_cap=5,
            status="published",
            issuer_name=str(get(r, "Issuer (Buyer)") or "").strip(),
            matched_supplier=matched,
            spec_notes=spec_notes,
            tags=rfq_tags.derive_tags(process, material, title, spec_notes, sector_key),
            hub_city=hubs.get(_norm(matched), "") if matched else "",
        )
        if rid is not None:
            rfq.id = rid
        # stagger created_at so "posted N days ago" is real and varies per row
        rfq.created_at = now - timedelta(days=(rfq.id or count) % 12)
        session.add(rfq)
        count += 1
    session.commit()
    _sync_sequences(session)
    return count


# --- demo suppliers + blinded bids (first N published RFQs) ---
_DEMO_SUPPLIERS = [
    dict(name="Ganesh Precision", hub_city="Pune, MH", distance_km=410, kyc_verified=True,
         capability_tags=["5-Axis", "Duplex", "NDT in-house"], certifications=["AS9100D"]),
    dict(name="Rajkot Precision Forgings", hub_city="Rajkot, GJ", distance_km=1380, kyc_verified=True,
         capability_tags=["Milling", "Duplex"], certifications=[]),
    dict(name="Coimbatore Machining Works", hub_city="Coimbatore, TN", distance_km=12, kyc_verified=True,
         capability_tags=["5-Axis", "Turning"], certifications=[]),
    dict(name="Chennai Aero Components", hub_city="Chennai, TN", distance_km=590, kyc_verified=True,
         capability_tags=["5-Axis", "Ra 0.4", "NDT"], certifications=["AS9100D"]),
    dict(name="Nagla Engineering Works", hub_city="Ludhiana, PB", distance_km=2100, kyc_verified=True,
         capability_tags=["Milling", "Turning"], certifications=[]),
]
# per-bidder templates: (unit_factor, tooling, freight, lead, terms, exception)
_DEMO_BID = [
    (1.00, 85000, 42000, 5, "30 / 70", False),
    (0.975, 85000, 90000, 8, "40 / 60", False),
    (1.036, 60000, 12000, 4, "Advance", False),
    (1.143, 120000, 55000, 6, "30 / 70", False),
    (1.102, 85000, 110000, 10, "Advance", True),
]


def seed_demo_bids(session, n_rfqs: int | None = None):
    """Give every RFQ whose workbook bid_count is >0 that many REAL blinded
    bids (capped at the 5-shop routing cap), rotating which demo supplier wins
    so comparisons vary. bid_count is then set to the number actually created,
    so the board never advertises bids that the compare screen can't show."""
    session.query(models.Supplier).delete()
    session.commit()
    sups = []
    for s in _DEMO_SUPPLIERS:
        sup = models.Supplier(**s)
        session.add(sup)
        sups.append(sup)
    session.commit()

    q = session.query(models.Rfq).order_by(models.Rfq.id)
    if n_rfqs:
        q = q.limit(n_rfqs)
    rfqs = q.all()
    letters = "ABCDE"
    covered = 0
    for j, rfq in enumerate(rfqs):
        k = max(0, min(int(rfq.bid_count or 0), len(sups)))
        if k == 0:
            rfq.bid_count = 0
            continue
        unit0 = rfq.budget_low or ((rfq.est_total / rfq.qty) if (rfq.est_total and rfq.qty) else 9800)
        for i in range(k):
            sidx = (j + i) % len(sups)  # rotate so different shops win per RFQ
            s = sups[sidx]
            factor, tooling, freight, lead, terms, exc = _DEMO_BID[sidx]
            bid = models.Bid(
                rfq_id=rfq.id, supplier_id=s.id, bidder_code=letters[i],
                unit_price=round(unit0 * factor, 2), tooling=tooling, freight=freight,
                gst_included=True, lead_weeks=lead, payment_terms=terms, validity_days=30,
                exception_flag=exc, exception_note=("±0.05 mm vs required ±0.02 mm; NDT outsourced." if exc else ""),
                source="demo",
            )
            bid.tlc_cents = bid.compute_tlc_cents(rfq.qty)
            session.add(bid)
        rfq.bid_count = k
        covered += 1
    session.commit()
    return covered


def main():
    db.init_db()
    session = db.SessionLocal()
    try:
        n = seed_rfqs(session)
        src = str(config.SOURCE_XLSX) if Path(config.SOURCE_XLSX).exists() else str(SEED_JSON)
        print(f"Seeded {n} RFQs from '{src}' -> {config.DATABASE_URL}")
        if "--demo-bids" in sys.argv:
            m = seed_demo_bids(session)
            print(f"Seeded demo suppliers + blinded bids for {m} RFQs.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
