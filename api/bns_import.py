"""BnS page-extract importer — turns a paste of the BnS RFQ listing into
concierge-review drafts, never straight onto the board.

The BnS source is a members-only listing the team copies by hand; each entry is
delimited by a `Submit a bid` marker. We reuse the exact chunking + `parse_rfq`
logic that produced the original seed data (`build_rfq_demand.py`), so parsing
fidelity matches, then file each parsed RFQ as a PENDING `pending_draft`
(source="bns") so it surfaces in the `/review` queue for a human to verify and
publish. This is deliberately the *same* landing point as the Telegram bot and
the web form — the concierge gate is the only way onto the board.

Nothing here fetches the website: it only parses text you hand it. A scheduled
live fetcher would call `import_extract` with freshly-fetched text once the site
URL, access permission and (if login-gated) credentials are sorted out.
"""
from __future__ import annotations

import models
import rfq_parser
from draft_util import create_draft, dedupe_hit, norm_title

# `Submit a bid` sits after each listing entry; a real entry always shows a
# closing date, so that's our "is this a chunk" guard (verbatim from the seed).
_DELIM = "Submit a bid"

# Issuers we never import (throwaway / trial accounts in the source extract).
TEST_ISSUERS = {"free tester", "trial demo"}


def split_bns_chunks(text: str) -> list[str]:
    return [c for c in (text or "").split(_DELIM) if "Closes in" in c]


def _confidence(fields: dict) -> dict:
    """Honest per-field confidence for a structured BnS page extract: the page
    states these explicitly, so present fields are trustworthy and genuinely
    missing ones (open budget, no deadline) stay flagged low."""
    return {
        "title": 0.95,
        "process": 0.7 if fields.get("process") else 0.3,
        "qty": 0.95 if fields.get("qty") else 0.3,
        "budget": 0.9 if fields.get("low") is not None else 0.2,
        "deadline": 0.9 if fields.get("closes_in_days") is not None else 0.2,
    }


def _pending_titles(session) -> set[str]:
    """Normalized titles of drafts already sitting in the review queue, so a
    re-import of the same extract doesn't file duplicates of each other."""
    seen = set()
    for d in session.query(models.PendingDraft).filter(models.PendingDraft.status == "PENDING").all():
        t = (d.parsed or {}).get("title")
        nt = norm_title(t) if t else ""
        if nt:
            seen.add(nt)
    return seen


def parse_extract(text: str) -> list[dict]:
    """Parse the extract into candidate RFQ dicts (no DB writes). Test-issuer
    rows are dropped here so callers see the real candidate set."""
    out = []
    for chunk in split_bns_chunks(text):
        parsed = rfq_parser.parse_rfq(chunk)
        if not parsed or not (parsed.get("title") or "").strip():
            continue
        if (parsed.get("issuer") or "").strip().lower() in TEST_ISSUERS:
            continue
        out.append(parsed)
    return out


def import_extract(session, text: str, actor: models.User | None = None,
                   source: str = "bns", dry_run: bool = False) -> dict:
    """File every parsed BnS entry as a PENDING draft for the concierge, skipping
    anything already live on the board or already queued. Returns an honest
    summary; on `dry_run` it reports what *would* be created without writing."""
    candidates = parse_extract(text)
    existing_pending = _pending_titles(session)

    created, dup_live, dup_pending = [], [], []
    for fields in candidates:
        title = str(fields.get("title") or "").strip()[:200]
        nt = norm_title(title)
        if dedupe_hit(session, title) is not None:
            dup_live.append(title)
            continue
        if nt in existing_pending:
            dup_pending.append(title)
            continue

        # BnS entries have no free description; keep the spec notes and record the
        # listed issuer + raw closing text for the reviewer's context.
        fields = dict(fields)
        fields["title"] = title
        fields["source"] = source  # keep normalize_fields from defaulting this to "bot"
        fields.setdefault("description", "")
        fields["hub_city"] = fields.get("hub_city") or ""
        fields["source_note"] = f"BnS extract · issuer: {fields.get('issuer') or 'hidden'} · {fields.get('closes') or ''}".strip()
        conf = _confidence(fields)

        if dry_run:
            created.append(title)
            existing_pending.add(nt)
            continue

        draft = create_draft(session, raw_text=title, parsed=fields,
                             confidence=conf, source=source)
        created.append(draft.id)
        existing_pending.add(nt)

    return {
        "parsed": len(candidates),
        "dry_run": dry_run,
        "created": created,
        "created_count": len(created),
        "skipped_duplicate_live": dup_live,
        "skipped_duplicate_pending": dup_pending,
    }
