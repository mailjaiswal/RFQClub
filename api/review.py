"""Concierge review CLI — the mandatory human gate before anything hits the board.

Thin front-end over `workflow.py`, which holds the actual rules and is shared
with the operator HTTP endpoints (`/api/operator/*`), so CLI and web review can
never drift apart. Moves rows in pending_draft (status PENDING, captured by
ingest_bot or the web form) into the live rfq table; approved RFQs appear on the
board immediately (DB-driven, no rebuild needed).

Commands:
    python review.py list
    python review.py show <draft_id>
    python review.py approve <draft_id> [--publish] [--force] [--title "..." --sector cnc ...]
    python review.py edit <draft_id> --title "..." --qty 500 --budget-low 200 ...
    python review.py reject <draft_id> [--reason "..."]

`approve` without --publish still writes the rfq row but leaves it as a draft;
with --publish it goes straight to the board. Default is draft so the operator
can eyeball it in the DB before flipping it live.
"""
from __future__ import annotations
import argparse
import sys

import db
import models
import sectors
import util
import workflow
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
            low_conf = workflow.low_confidence(d)
            flag = f"  \u26a0 low-confidence: {','.join(low_conf)}" if low_conf else ""
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


def _edits_from_args(args) -> dict:
    """Only the flags actually passed on the command line. An unpassed flag stays
    absent (not null), so workflow.apply_edits leaves the parsed value untouched —
    null would mean 'clear this field' for the numeric ones."""
    raw = {
        "title": args.title, "process": args.process, "material": args.material,
        "qty": args.qty, "unit": args.unit, "low": args.budget_low, "high": args.budget_high,
        "closes_in_days": args.days, "sector_key": args.sector, "description": args.description,
    }
    return {k: v for k, v in raw.items() if v is not None}


def _fail(msg: str):
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(1)


def cmd_approve(args):
    s = _session()
    try:
        draft, rfq = workflow.approve_draft(
            s, args.draft_id, edits=_edits_from_args(args),
            publish=args.publish, force=args.force)
        state = "PUBLISHED" if args.publish else "draft"
        print(f"Approved #{draft.id} -> RFQ {rfq.code} ({state}). "
              f"{rfq.title[:50]} | {sectors.label(rfq.sector_key)} | {util.format_inr(rfq.est_total)}")
    except workflow.WorkflowError as exc:
        _fail(str(exc))
    finally:
        s.close()


def cmd_edit(args):
    s = _session()
    try:
        d = s.get(models.PendingDraft, args.draft_id)
        if not d:
            print(f"No draft #{args.draft_id}", file=sys.stderr)
            return
        fields = workflow.apply_edits(draft_to_fields(d), _edits_from_args(args))
        d.parsed = fields
        s.commit()
        print(f"Edited draft #{d.id} (still PENDING). Review again with: python review.py show {d.id}")
        print(render_draft(d))
    except workflow.WorkflowError as exc:
        _fail(str(exc))
    finally:
        s.close()


def cmd_reject(args):
    s = _session()
    try:
        d = workflow.reject_draft(s, args.draft_id, reason=args.reason or "")
        print(f"Rejected draft #{d.id}.")
    except workflow.WorkflowError as exc:
        _fail(str(exc))
    finally:
        s.close()


def cmd_publish(args):
    """Publish / un-publish / close an existing rfq row."""
    s = _session()
    try:
        rfq = workflow.set_rfq_status(s, args.rfq_id, args.status)
        print(f"RFQ {rfq.code} is now {rfq.status}: {rfq.title[:60]}")
    except workflow.WorkflowError as exc:
        _fail(str(exc))
    finally:
        s.close()


def _add_edit_args(p):
    """Correction flags shared by `approve` and `edit` so an operator can fix a
    mis-parsed field at the same moment they approve it."""
    p.add_argument("--title"); p.add_argument("--process"); p.add_argument("--material")
    p.add_argument("--qty", type=float); p.add_argument("--unit")
    p.add_argument("--budget-low", dest="budget_low", type=float)
    p.add_argument("--budget-high", dest="budget_high", type=float)
    p.add_argument("--days", type=int); p.add_argument("--sector"); p.add_argument("--description")


def build_parser():
    ap = argparse.ArgumentParser(prog="review", description="RFQClub concierge review gate")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")

    p_show = sub.add_parser("show"); p_show.add_argument("draft_id", type=int)

    p_ap = sub.add_parser("approve")
    p_ap.add_argument("draft_id", type=int)
    p_ap.add_argument("--publish", action="store_true", help="set status=published (default: draft)")
    p_ap.add_argument("--force", action="store_true", help="approve even if a matching RFQ is already live")
    _add_edit_args(p_ap)

    p_ed = sub.add_parser("edit")
    p_ed.add_argument("draft_id", type=int)
    _add_edit_args(p_ed)

    p_rj = sub.add_parser("reject")
    p_rj.add_argument("draft_id", type=int)
    p_rj.add_argument("--reason", default="")

    p_pb = sub.add_parser("status", help="change an rfq row's status")
    p_pb.add_argument("rfq_id", type=int)
    p_pb.add_argument("status", choices=list(workflow.RFQ_STATUSES))
    return ap


_HANDLERS = {
    "list": cmd_list, "show": cmd_show, "approve": cmd_approve,
    "edit": cmd_edit, "reject": cmd_reject, "status": cmd_publish,
}


def main(argv=None):
    args = build_parser().parse_args(argv)
    _HANDLERS[args.cmd](args)


if __name__ == "__main__":
    main()
