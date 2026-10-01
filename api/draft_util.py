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


def norm_title(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def dedupe_hit(session, title: str) -> models.Rfq | None:
    """Return a published RFQ whose normalized title already matches (approx)."""
    nt = norm_title(title)
    if not nt:
        return None
    for r in session.query(models.Rfq).all():
        if norm_title(r.title) == nt:
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
    f.setdefault("cur", "\u20b9")
    f.setdefault("unit", "")
    f.setdefault("clarify", [])
    f.setdefault("clarify_answers", {})
    f.setdefault("confidence", {})
    return f


# The clarify loop. A question is "open" for exactly as long as its field is
# empty, so answering it (or the concierge editing that field) resolves it with
# no separate flag to keep in sync. Keys map onto the draft's field names.
CLARIFY_QUESTIONS = {
    "qty": "Confirm quantity and unit (pcs / kg / sets).",
    "material": "Which grade / material specification applies?",
    "process": "Which process should shops quote against (machining, casting, fabrication\u2026)?",
    "budget": "Is there an indicative budget, or should we route it open?",
}
_ORDER = ("qty", "material", "process", "budget")


def _field_empty(fields: dict, key: str) -> bool:
    if key == "qty":
        return fields.get("qty") in (None, "")
    if key == "budget":
        return fields.get("low") is None
    return not str(fields.get(key) or "").strip()


def open_clarifications(fields: dict) -> list[dict]:
    """The structured questions still unanswered on this draft."""
    return [{"key": k, "question": CLARIFY_QUESTIONS[k]} for k in _ORDER if _field_empty(fields, k)]


_MONEY_MULT = {"lakh": 100_000, "lakhs": 100_000, "lac": 100_000, "l": 100_000,
               "cr": 10_000_000, "crore": 10_000_000, "crores": 10_000_000,
               "k": 1_000, "000": 1_000}
_RE_AMT = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(lakh|lakhs|lac|crore|crores|cr|k|000)?\b", re.I)


def _parse_budget(text: str) -> tuple[float | None, float | None]:
    """Robust budget parse for buyer-typed answers. Handles '\u20b98-15 Lakh',
    '8L-15L', '1.2 Cr', '5000', '1,20,000'. When a range carries a multiplier only
    on the trailing value, it is applied to the leading one too (the common
    '8-15 lakh' shorthand)."""
    pairs = []
    for m in _RE_AMT.finditer(text or ""):
        try:
            num = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        pairs.append((num, _MONEY_MULT.get((m.group(2) or "").lower())))
    if not pairs:
        return None, None
    vals = [n * (mu or 1) for n, mu in pairs]
    if len(pairs) == 2 and pairs[0][1] is None and pairs[1][1] is not None:
        vals[0] = pairs[0][0] * pairs[1][1]
    low = min(vals)
    high = max(vals) if len(vals) > 1 else None
    return low, high


def apply_clarification(fields: dict, key: str, answer: str) -> tuple[bool, str]:
    """Fold one buyer answer into the draft's fields, reusing the regex parser for
    the numeric ones so "~1200 pcs" / "\u20b98-15 L" land correctly. Returns
    (changed, a short display string of what was captured)."""
    answer = (answer or "").strip()
    if key not in CLARIFY_QUESTIONS or not answer:
        return False, ""
    conf = fields.setdefault("confidence", {})
    if key == "qty":
        qty, unit = rfq_parser.extract_qty(answer)
        if qty is None:
            return False, ""
        fields["qty"] = qty
        if unit:
            fields["unit"] = unit
        conf["qty"] = 1.0
        return True, f"{qty:g} {fields.get('unit', '')}".strip()
    if key == "budget":
        low, high = _parse_budget(answer)
        if low is None:
            return False, ""
        fields["low"] = low
        fields["high"] = high if high not in (None, 0) else None
        fields["cur"] = fields.get("cur") or "\u20b9"
        conf["low"] = conf["budget"] = 1.0
        disp = util.format_inr(low) if not fields["high"] else f"{util.format_inr(low)}\u2013{util.format_inr(fields['high'])}"
        return True, disp
    # material / process are free text; a process or material hint can also
    # (re)classify the sector when it was only guessed.
    fields[key] = answer
    conf[key] = 1.0
    if key in ("process", "material"):
        fields["sector_key"] = sectors.classify(fields.get("process", ""), fields.get("title", ""), fields.get("material", ""))
    return True, answer


def create_draft(session, raw_text: str, parsed: dict | None = None,
                 confidence: dict | None = None, source_chat_id: int | None = None,
                 source_msg_id: int | None = None, user_id: int | None = None,
                 source: str = "telegram") -> models.PendingDraft:
    if parsed is None:
        parsed = rfq_parser.from_freeform(raw_text)
    parsed = normalize_fields(parsed)
    confidence = confidence if confidence is not None else parsed.get("confidence", {})
    d = models.PendingDraft(
        status="PENDING", raw_text=raw_text or "",
        parsed=parsed, confidence=confidence,
        source_chat_id=source_chat_id, source_msg_id=source_msg_id,
        user_id=user_id, source=source,
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
    clar = open_clarifications(f)
    if clar:
        lines.append("  Open     : " + " | ".join(c["question"] for c in clar))
    answers = f.get("clarify_answers") or {}
    for key, rec in answers.items():
        disp = rec.get("answer") if isinstance(rec, dict) else rec
        who = rec.get("by", "buyer") if isinstance(rec, dict) else ""
        lines.append(f"  Answered : {key} -> {disp}" + (f"  ({who})" if who else ""))
    if conf:
        flags = [f"{k}={v:.2f}" for k, v in conf.items() if isinstance(v, (int, float))]
        if flags:
            lines.append("  Confidence: " + " ".join(flags))
    if draft.raw_text:
        snippet = draft.raw_text.strip().replace("\n", " ")[:140]
        lines.append(f"  Raw       : {snippet}…")
    return "\n".join(lines)
