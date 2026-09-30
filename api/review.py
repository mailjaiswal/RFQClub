"""Concierge review CLI — the mandatory human gate before anything hits the board.

Moves rows in pending_draft (status PENDING, captured by ingest_bot) into the
live rfq table. New approved RFQs appear on the board immediately (DB-driven,
no rebuild needed).

Commands:
    python review.py list
    python review.py show <draft_id>
    python review.py approve <draft_id> [--publish]
    python review.py edit <draft_id> --title "..." --qty 500 --budget-low 200 ...
    python review.py reject <draft_id>

`approve` without --publish still writes the rfq row but leaves it as a draft;
with --publish it goes straight to the board. Default is draft so the operator
can eyeball it in the DB before flipping it live.
"""
from __future__ import annotations
import argparse
import sys
from datetime import datetime, timedelta, timezone

import db
import models
import sectors
import util
from draft_util import draft_to_fields, render_draft


def _session():
    db.init_db()
    return db.SessionLocal()


def _pending(session):
    return session.query(models.PendingDraft).filter(
        models.PendingDraft.status == "PENDING"
    ).order_by(models.PendingDraft.id).all()


def cmd_list(_args):
    s = _session()
    try:
        rows = _pending(s)
        if not rows:
            print("No PENDING drafts.")
            return
        print(f"{len(rows)} PENDING draft(s):")
        for d in rows:
            p = d.parsed or {}
            title = (p.get("title") or "")[:60]
            low_conf = [k for k, v in (d.confidence or {}).items() if isinstance(v, (int, float)) and v < 0.6]
            flag = f"  ⚠ low-confidence: {','.join(low_conf)}" if low_conf else ""
            print(f"  #{d.id:<4} [{p.get('sector_key','?'):<7}] {title}{flag}")
    finally:
        s.close()


def cmd_show(args):
    s = _session()
    try:
        d = s.get(models.PendingDraft, args.draft_id)
        if not d:
            print(f"No draft #{args.draft_id}", file=sys.stderr)
            return
        print(render_draft(d))
    finally:
        s.close()


def _apply_edits(fields: dict, args) -> dict:
    edits = {
        "title": args.title, "process": args.process, "material": args.material,
        "qty": args.qty, "unit": args.unit, "low": args.budget_low, "high": args.budget_high,
        "closes_in_days": args.days, "sector_key": args.sector, "description": args.description,
    }
    for k, v in edits.items():
        if v is not None:
            fields[k] = v
    return fields


def _write_rfq(session, fields: dict, publish: bool) -> models.Rfq:
    now = datetime.now(timezone.utc)
    low = fields.get("low")
    high = fields.get("high")
    qty = fields.get("qty")
    est_total = fields.get("est_total")
    if est_total is None and qty and low is not None:
        est_total = round(((low + (high or low)) / 2) * qty, 2)
    days = fields.get("closes_in_days")
    rfq = models.Rfq(
        title=fields.get("title") or "Untitled RFQ",
        sector_key=fields.get("sector_key") or sectors.classify(fields.get("process", ""), fields.get("title", ""), fields.get("material", "")),
        process=fields.get("process", ""), material=fields.get("material", ""),
        qty=qty, unit=fields.get("unit", ""),
        budget_low=low, budget_high=high, currency=fields.get("cur") or "₹",
        budget_status="Priced" if low is not None else "Open",
        est_total=est_total,
        closes_in_days=days,
        closes_at=(now + timedelta(days=days)) if days is not None else None,
        description=fields.get("description") or fields.get("title") or "",
        clarify=fields.get("clarify", []) or [],
        spec_notes=fields.get("notes", ""),
        routing_cap=5,
        status="published" if publish else "draft",
    )
    session.add(rfq)
    return rfq


def cmd_approve(args):
    s = _session()
    try:
        d = s.get(models.PendingDraft, args.draft_id)
        if not d:
            print(f"No draft #{args.draft_id}", file=sys.stderr)
            return
        fields = draft_to_fields(d)
        rfq = _write_rfq(s, fields, publish=args.publish)
        d.status = "APPROVED"
        d.reviewed_at = datetime.now(timezone.utc)
        s.commit()
        state = "PUBLISHED" if args.publish else "draft"
        print(f"Approved #{d.id} -> RFQ {rfq.code} ({state}). "
              f"{rfq.title[:50]} | {sectors.label(rfq.sector_key)} | {util.format_inr(rfq.est_total)}")
    finally:
        s.close()


def cmd_edit(args):
    s = _session()
    try:
        d = s.get(models.PendingDraft, args.draft_id)
        if not d:
            print(f"No draft #{args.draft_id}", file=sys.stderr)
            return
        fields = draft_to_fields(d)
        fields = _apply_edits(fields, args)
        d.parsed = fields
        s.commit()
        print(f"Edited draft #{d.id} (still PENDING). Review again with: python review.py show {d.id}")
        print(render_draft(d))
    finally:
        s.close()


def cmd_reject(args):
    s = _session()
    try:
        d = s.get(models.PendingDraft, args.draft_id)
        if not d:
            print(f"No draft #{args.draft_id}", file=sys.stderr)
            return
        d.status = "REJECTED"
        d.reviewed_at = datetime.now(timezone.utc)
        s.commit()
        print(f"Rejected draft #{d.id}.")
    finally:
        s.close()


def build_parser():
    ap = argparse.ArgumentParser(prog="review", description="RFQClub concierge review gate")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")

    p_show = sub.add_parser("show"); p_show.add_argument("draft_id", type=int)

    p_ap = sub.add_parser("approve")
    p_ap.add_argument("draft_id", type=int)
    p_ap.add_argument("--publish", action="store_true", help="set status=published (default: draft)")

    p_ed = sub.add_parser("edit")
    p_ed.add_argument("draft_id", type=int)
    p_ed.add_argument("--title"); p_ed.add_argument("--process"); p_ed.add_argument("--material")
    p_ed.add_argument("--qty", type=float); p_ed.add_argument("--unit")
    p_ed.add_argument("--budget-low", dest="budget_low", type=float)
    p_ed.add_argument("--budget-high", dest="budget_high", type=float)
    p_ed.add_argument("--days", type=int); p_ed.add_argument("--sector"); p_ed.add_argument("--description")

    p_rj = sub.add_parser("reject"); p_rj.add_argument("draft_id", type=int)
    return ap


_HANDLERS = {
    "list": cmd_list, "show": cmd_show, "approve": cmd_approve,
    "edit": cmd_edit, "reject": cmd_reject,
}


def main(argv=None):
    args = build_parser().parse_args(argv)
    _HANDLERS[args.cmd](args)


if __name__ == "__main__":
    main()
