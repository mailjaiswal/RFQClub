"""The concierge review workflow — the mandatory human gate before an RFQ is
published to the board.

Single implementation shared by the `review.py` CLI and the operator HTTP
endpoints in `main.py`, so the two can never drift apart.

Two kinds of work-in-progress reach the operator:
  * `pending_draft` rows (PENDING) — intake captured by the Telegram bot or the
    web "Post an RFQ" form, structured by `rfq_parser` but not yet an RFQ record.
  * `rfq` rows with status "draft" — structured records created directly via the
    API that were never published.

Approving a draft writes the `rfq` row; publishing is an explicit choice, and a
title that already matches a live RFQ is refused unless the operator forces it.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import draft_util
import models
import rfq_tags
import sectors
import util

# Statuses an RFQ record may be moved to through this workflow. "awarded" is set
# by the award endpoint, never by the reviewer.
RFQ_STATUSES = ("published", "draft", "closed")

# Fields an operator may correct during review, mapped to their draft keys.
EDIT_FIELDS = ("title", "process", "material", "qty", "unit", "low", "high",
               "closes_in_days", "sector_key", "description", "notes", "hub_city")


class WorkflowError(Exception):
    """Invalid review action. `status` is the HTTP code the API should return."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---- field handling -------------------------------------------------------

def apply_edits(fields: dict, edits: dict | None) -> dict:
    """Overlay only the keys the caller actually sent. For the numeric fields an
    explicit null/empty means 'clear it'; for text fields null means 'leave as
    parsed' so a partial edit can't wipe a field by omission."""
    out = dict(fields or {})
    numeric = ("qty", "low", "high", "closes_in_days")
    for key in EDIT_FIELDS:
        if not edits or key not in edits:
            continue
        val = edits.get(key)
        if key in numeric:
            if val is None or val == "":
                out[key] = None
                continue
            try:
                val = float(val)
            except (TypeError, ValueError):
                raise WorkflowError(f"{key} must be a number")
            if val < 0:
                raise WorkflowError(f"{key} cannot be negative")
            if key == "closes_in_days":
                if val != int(val):
                    raise WorkflowError("closes_in_days must be a whole number")
                val = int(val)
            out[key] = val
            continue
        if val is None:
            continue
        val = str(val)
        if key == "sector_key":
            val = val.strip()
            if val not in sectors.SECTORS:
                raise WorkflowError(f"unknown sector_key {val!r} — expected one of {', '.join(sectors.SECTORS)}")
        out[key] = val
    if not str(out.get("title") or "").strip():
        raise WorkflowError("a title is required before an RFQ can be approved")
    return out


# ---- serialization --------------------------------------------------------

def low_confidence(draft: models.PendingDraft) -> list[str]:
    conf = (draft.confidence or {}) if isinstance(draft.confidence, dict) else {}
    return sorted(k for k, v in conf.items() if isinstance(v, (int, float)) and v < 0.6)


def title_index(session) -> dict[str, models.Rfq]:
    """Normalized live titles -> RFQ, built once per queue call so serialization
    doesn't re-scan the whole rfq table for every draft."""
    idx: dict[str, models.Rfq] = {}
    for r in session.query(models.Rfq).filter(models.Rfq.status == "published"):
        key = draft_util.norm_title(r.title)
        if key and key not in idx:
            idx[key] = r
    return idx


def draft_out(session, draft: models.PendingDraft, dedupe_index: dict[str, models.Rfq] | None = None) -> dict:
    f = draft_util.draft_to_fields(draft)
    low, high = f.get("low"), f.get("high")
    title = str(f.get("title") or "")
    if dedupe_index is None:
        dup = draft_util.dedupe_hit(session, title)
    else:
        dup = dedupe_index.get(draft_util.norm_title(title))
    sector_key = f.get("sector_key") or "cnc"
    clarifications = draft_util.open_clarifications(f)
    return {
        "id": draft.id,
        "status": draft.status,
        "source": draft.source or "telegram",
        "created_at": draft.created_at.isoformat() if draft.created_at else None,
        "reviewed_at": draft.reviewed_at.isoformat() if draft.reviewed_at else None,
        "reviewed_by": draft.reviewed_by or "",
        "reject_reason": draft.reject_reason or "",
        "raw_text": (draft.raw_text or "")[:2000],
        "fields": {
            "title": f.get("title") or "",
            "process": f.get("process") or "",
            "material": f.get("material") or "",
            "qty": f.get("qty"),
            "unit": f.get("unit") or "",
            "low": low,
            "high": high,
            "closes_in_days": f.get("closes_in_days"),
            "sector_key": sector_key,
            "sector_label": sectors.label(sector_key),
            "description": f.get("description") or "",
            "notes": f.get("notes") or "",
            "hub_city": f.get("hub_city") or "",
            "clarify": [c["question"] for c in clarifications],
            "clarifications": clarifications,
            "clarify_answers": f.get("clarify_answers") or {},
            "budget_display": ("Open budget" if low is None else (
                util.format_inr(low, f.get("cur") or "₹") if high in (None, low)
                else f"{util.format_inr(low, f.get('cur') or '₹')}–{util.format_inr(high, f.get('cur') or '₹')}"
            )),
        },
        "confidence": draft.confidence or {},
        "low_confidence": low_confidence(draft),
        "duplicate_of": {"id": dup.id, "code": dup.code, "title": dup.title} if dup else None,
    }


# ---- actions --------------------------------------------------------------

def _get_pending(session, draft_id: int) -> models.PendingDraft:
    draft = session.get(models.PendingDraft, draft_id)
    if not draft:
        raise WorkflowError(f"draft #{draft_id} not found", 404)
    return draft


def approve_draft(session, draft_id: int, edits: dict | None = None, publish: bool = False,
                  actor: models.User | None = None, force: bool = False) -> tuple[models.PendingDraft, models.Rfq]:
    """Turn a PENDING draft into an `rfq` row (draft or published)."""
    draft = _get_pending(session, draft_id)
    if draft.status != "PENDING":
        raise WorkflowError(f"draft #{draft.id} is already {draft.status}", 409)
    fields = apply_edits(draft_util.draft_to_fields(draft), edits)
    title = str(fields["title"]).strip()
    # Carry the still-open clarify questions (if any) onto the RFQ, merged with any
    # free-text notes a bot/LLM pass stored, so the board listing keeps the context.
    open_q = [c["question"] for c in draft_util.open_clarifications(fields)]
    stored = list(fields.get("clarify") or [])
    fields["clarify"] = stored + [q for q in open_q if q not in stored]
    if not force:
        dup = draft_util.dedupe_hit(session, title)
        if dup:
            raise WorkflowError(
                f"already on the board as {dup.code} — pass force to approve anyway", 409)
    rfq = write_rfq(session, fields, publish=publish, user_id=draft.user_id)
    draft.status = "APPROVED"
    draft.parsed = fields
    draft.reviewed_at = _now()
    draft.reviewed_by = actor.email if actor else (getattr(draft, "reviewed_by", "") or "cli")
    session.commit()
    session.refresh(rfq)
    return draft, rfq


def reject_draft(session, draft_id: int, reason: str = "",
                 actor: models.User | None = None) -> models.PendingDraft:
    draft = _get_pending(session, draft_id)
    if draft.status != "PENDING":
        raise WorkflowError(f"draft #{draft.id} is already {draft.status}", 409)
    draft.status = "REJECTED"
    draft.reject_reason = (reason or "").strip()[:500]
    draft.reviewed_at = _now()
    draft.reviewed_by = actor.email if actor else (draft.reviewed_by or "cli")
    session.commit()
    return draft


def answer_clarifications(session, draft_id: int, answers: dict,
                          actor: models.User | None = None) -> models.PendingDraft:
    """The buyer (or a concierge on their behalf) answers the open clarify
    questions. Each accepted answer is folded into the draft's fields via
    draft_util.apply_clarification and recorded for the review trail. Only a
    PENDING draft can be clarified; a malformed answer for a known key is skipped
    rather than raising, so one bad field can't block the rest."""
    draft = _get_pending(session, draft_id)
    if draft.status != "PENDING":
        raise WorkflowError(f"draft #{draft.id} is already {draft.status}", 409)
    fields = draft_util.draft_to_fields(draft)
    recorded = fields.setdefault("clarify_answers", {})
    for key, value in (answers or {}).items():
        changed, disp = draft_util.apply_clarification(fields, key, value)
        if changed:
            recorded[key] = {"answer": disp, "raw": (value or "").strip()[:500],
                             "at": _now().isoformat(), "by": (actor.email if actor else "buyer")}
    # assign a fresh dict so SQLAlchemy detects the JSON change
    draft.parsed = fields
    session.commit()
    session.refresh(draft)
    return draft


def write_rfq(session, fields: dict, publish: bool, user_id: int | None = None) -> models.Rfq:
    """Create an unsaved/saved-but-uncommitted `rfq` row from reviewed fields."""
    now = _now()
    low, high = fields.get("low"), fields.get("high")
    qty = fields.get("qty")
    est_total = fields.get("est_total")
    if est_total is None and qty and low is not None:
        est_total = round(((low + (high if high is not None else low)) / 2) * qty, 2)
    days = fields.get("closes_in_days")
    sector_key = fields.get("sector_key") or sectors.classify(
        fields.get("process", ""), fields.get("title", ""), fields.get("material", ""))
    title = str(fields.get("title") or "Untitled RFQ").strip()
    desc = fields.get("description") or title
    notes = fields.get("notes") or ""
    rfq = models.Rfq(
        title=title, sector_key=sector_key,
        process=fields.get("process", ""), material=fields.get("material", ""),
        qty=qty, unit=fields.get("unit", ""),
        budget_low=low, budget_high=high, currency=fields.get("cur") or "₹",
        budget_status="Priced" if low is not None else "Open",
        est_total=est_total, closes_in_days=days,
        closes_at=(now + timedelta(days=days)) if days is not None else None,
        description=desc, clarify=fields.get("clarify", []) or [],
        spec_notes=notes, routing_cap=fields.get("routing_cap") or 5,
        hub_city=fields.get("hub_city", "") or "",
        tags=rfq_tags.derive_tags(fields.get("process", ""), fields.get("material", ""),
                                 title, notes, sector_key),
        status="published" if publish else "draft",
        user_id=user_id,
    )
    session.add(rfq)
    return rfq


def set_rfq_status(session, rfq_id: int, status: str,
                   actor: models.User | None = None) -> models.Rfq:
    """Publish / unpublish (back to draft) / close an existing RFQ record."""
    if status not in RFQ_STATUSES:
        raise WorkflowError(f"status must be one of {', '.join(RFQ_STATUSES)}")
    rfq = session.get(models.Rfq, rfq_id)
    if not rfq:
        raise WorkflowError(f"RFQ {rfq_id} not found", 404)
    if rfq.status == "awarded":
        raise WorkflowError("this RFQ has been awarded — its status can no longer be changed", 409)
    if status == "published" and rfq.status != "published":
        # (re)publishing refreshes the deadline so bids aren't judged against a stale date
        if rfq.closes_in_days is not None:
            rfq.closes_at = _now() + timedelta(days=int(rfq.closes_in_days))
    rfq.status = status
    session.commit()
    return rfq


# ---- queue view -----------------------------------------------------------

def queue(session, include_reviewed: int = 0) -> dict:
    """Everything a concierge needs to act on, in one call."""
    pending = (session.query(models.PendingDraft)
               .filter(models.PendingDraft.status == "PENDING")
               .order_by(models.PendingDraft.id.asc()).all())
    recent = (session.query(models.PendingDraft)
              .filter(models.PendingDraft.status != "PENDING")
              .order_by(models.PendingDraft.reviewed_at.desc().nullslast(),
                        models.PendingDraft.id.desc()).limit(max(0, include_reviewed)).all()
              if include_reviewed else [])
    rfq_drafts = (session.query(models.Rfq).filter(models.Rfq.status == "draft")
                  .order_by(models.Rfq.id.desc()).all())
    idx = title_index(session)
    # `import main` at call time keeps serialization of rfq cards in one place
    from main import _card
    return {
        "pending": [draft_out(session, d, idx) for d in pending],
        "recently_reviewed": [draft_out(session, d, idx) for d in recent],
        "rfq_drafts": [_card(r) for r in rfq_drafts],
        "counts": {
            "pending": len(pending),
            "rfq_drafts": len(rfq_drafts),
            "published": session.query(models.Rfq).filter(models.Rfq.status == "published").count(),
        },
    }
