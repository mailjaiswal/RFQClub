"""Shared draft helpers used by the Telegram bot and the review CLI.

A "draft" is the structured result of parsing messy incoming text
(rfq_parser.from_freeform + optional llm_structurer) stored in pending_draft
with status PENDING. Nothing here publishes to the board — that only happens
through review.py approve (the human gate).
"""
from __future__ import annotations
import re
from datetime import datetime, timezone

import models
import rfq_parser
import sectors
import util


def _norm_title(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def dedupe_hit(session, title: str) -> models.Rfq | None:
    """Return a published RFQ whose normalized title already matches (approx)."""
    nt = _norm_title(title)
    if not nt:
        return None
    for r in session.query(models.Rfq).all():
        if _norm_title(r.title) == nt:
            return r
    return None


def normalize_fields(parsed: dict) -> dict:
    """Coalesce the many key spellings a draft can have into one shape."""
    f = dict(parsed or {})
    # llm_structurer may write budget_low/high; regex uses low/high
    if f.get("low") is None and f.get("budget_low") is not None:
        f["low"] = f.get("budget_low")
    if f.get("high") is None and f.get("budget_high") is not None:
        f["high"] = f.get("budget_high")
    f.setdefault("cur", "₹")
    f.setdefault("unit", "")
    f.setdefault("clarify", [])
    f.setdefault("confidence", {})
    return f


def create_draft(session, raw_text: str, parsed: dict | None = None,
                 confidence: dict | None = None, source_chat_id: int | None = None,
                 source_msg_id: int | None = None) -> models.PendingDraft:
    if parsed is None:
        parsed = rfq_parser.from_freeform(raw_text)
    parsed = normalize_fields(parsed)
    confidence = confidence if confidence is not None else parsed.get("confidence", {})
    d = models.PendingDraft(
        status="PENDING", raw_text=raw_text or "",
        parsed=parsed, confidence=confidence,
        source_chat_id=source_chat_id, source_msg_id=source_msg_id,
    )
    session.add(d)
    session.commit()
    session.refresh(d)
    return d


def draft_to_fields(draft: models.PendingDraft) -> dict:
    return normalize_fields(draft.parsed or {})


def render_draft(draft: models.PendingDraft) -> str:
    f = draft_to_fields(draft)
    conf = f.get("confidence", {}) or {}
    sector = sectors.label(f.get("sector_key", "cnc"))
    low = f.get("low")
    high = f.get("high")
    budget = "Open budget" if low is None else (
        util.format_inr(low) if high in (None, low) else f"{util.format_inr(low)}–{util.format_inr(high)}"
    )
    days = f.get("closes_in_days")
    lines = [
        f"Draft #{draft.id}  [{draft.status}]",
        f"  Title    : {f.get('title','')}",
        f"  Sector   : {sector}",
        f"  Process  : {f.get('process') or '—'}",
        f"  Material : {f.get('material') or '—'}",
        f"  Qty      : {f.get('qty') or '—'} {f.get('unit','')}".rstrip(),
        f"  Budget   : {budget}",
        f"  Closes   : {str(days)+' days' if days is not None else '—'}",
    ]
    clar = f.get("clarify") or []
    if clar:
        lines.append("  Clarify  : " + " | ".join(clar))
    if conf:
        flags = [f"{k}={v:.2f}" for k, v in conf.items() if isinstance(v, (int, float))]
        if flags:
            lines.append("  Confidence: " + " ".join(flags))
    if draft.raw_text:
        snippet = draft.raw_text.strip().replace("\n", " ")[:140]
        lines.append(f"  Raw       : {snippet}…")
    return "\n".join(lines)
