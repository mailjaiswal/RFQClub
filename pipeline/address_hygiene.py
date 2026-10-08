"""Keep research prose out of the Address column.

Why this exists (found while closing contact-enrichment batch 9, 2026-10-08):
`apply_rfq_categories.py` classifies each row from `signals=["Address", "Website"]`
and `rfq_categories.classify()` weights the address text twice, while a bare
"works" is a weak keyword for Job Work / Machining. Enrichment batches had been
writing perfectly normal research wording into Address - "Works: Plot No. 4/6,
MIDC, Bhosari", "no works address published anywhere", "a directory listing puts a
works at ..." - and that prose alone was enough to flip the harvested sector on 12
rows. The result reached reps as "Job Work / Machining" for a paper mill, a cycle
importer and a container maker, and nothing in the audit trail showed where the
claim came from, because `Category (Researched)` was empty.

The rule this enforces: **a sector is asserted through `Category (Researched)`, never
through prose in a signal column.** Address holds postal lines only. Anything else a
batch wanted to say about a row belongs in Data Source, which the classifier never
reads.

`guard()` asks the real classifier whether the candidate address would change the
verdict the company's own name and harvested vertical already produce. If it would,
the text is reduced (neutral relabel -> drop the offending parenthetical -> drop the
offending clause) until the sector is no longer being asserted from it, and whatever
had to come out is returned so the caller can keep it as provenance. If no reduction
works, the Address write is refused outright and the whole text is returned as a note
- a missing address line is recoverable, a fabricated sector tag is not.

Note: `apply_enrichment.py` (the BnS workbook applier) writes Address into a sheet the
classifier also reads and has the same exposure. It is not wired here yet because that
file still SETs Data Source instead of appending, and routing prose into a column that
gets overwritten would lose it. Fix the Data Source semantics there first.
"""
import re

import rfq_categories as rc

# Words that read naturally as a factory label but are also classifier evidence.
# 'works' is the one that caused the damage; the rest are listed so a future batch
# cannot re-introduce the same shape by writing "Engineering Works" or "die shop".
RELABEL = [
    (re.compile(r"\bgroup works and office\b", re.I), "group office and plant"),
    (re.compile(r"\bworks and office\b", re.I), "office and plant"),
    (re.compile(r"\bworks\s*/\s*plant\b", re.I), "plant"),
    (re.compile(r"\bworks\b", re.I), "plant"),
]

_SPLIT = re.compile(r"\n+|\s*\|\s*|\s+[-\u2013]\s+|\s*;\s*")
_PAREN = re.compile(r"\s*\([^()]*\)")


def _signals(text, website):
    """Mirror how classify_sheet() builds its signal string (Address + Website)."""
    return " ".join(x for x in (text, website) if x)


def _verdict(company, legacy, website, address):
    sig = _signals(address, website)
    return rc.classify(company=str(company), address=sig, website=sig,
                       legacy_category=legacy)


def _asserting(text, company, legacy, website):
    """Sector the address text would assert, plus the base it overrides (or None)."""
    base = _verdict(company, legacy, website, "")
    with_addr = _verdict(company, legacy, website, text)
    if with_addr["primary"] == base["primary"]:
        return None
    return base, with_addr


def guard(address, *, company, legacy="", website=""):
    """Return (address_to_write, prose_to_keep_as_note, warning).

    address_to_write may be "" - that means the text was refused entirely and lives
    on as a note, so the row's sector still comes only from its name and vertical.
    """
    original = re.sub(r"\s{2,}", " ", str(address or "")).strip()
    if not original:
        return "", [], ""
    notes = []
    # 1. relabel first, unconditionally. 'Works' as an address label means the factory
    #    site, which is a fact a rep can read either way - and it is a keyword the
    #    classifier reads as machining evidence. Swapping it for 'Plant' loses nothing
    #    and removes the hook even on rows whose verdict happens to already match
    #    (Kaizen's name alone says Job Work, so its 'Works: Plot 4/6' was harmless
    #    *today* and would not be after one re-harvest of the legacy column).
    text = original
    for pat, rep in RELABEL:
        text = pat.sub(rep, text)
    rewrote = text != original
    if not _asserting(text, company, legacy, website):
        return text, [], ("relabelled (signal word -> neutral wording)"
                          if rewrote else "")
    # 2. lift out the parenthetical asides that themselves assert a sector; an aside
    #    that only qualifies geography ("(Delhi-NCR)") stays where it is
    for m in list(_PAREN.finditer(text)):
        aside = m.group(0)
        if not _asserting(aside, company, legacy, website):
            continue
        notes.append(aside.strip())
        text = text.replace(aside, " ", 1)
    text = re.sub(r"\s{2,}", " ", text).strip(" ,;|-")
    if notes and not _asserting(text, company, legacy, website):
        return text, notes, "aside(s) moved to the note"
    # 3. drop whole clauses that carry the evidence, keeping a usable postal line
    kept, dropped = [], []
    for part in (p.strip(" ,;") for p in _SPLIT.split(text)):
        if not part:
            continue
        if _asserting(part, company, legacy, website):
            dropped.append(part)
        else:
            kept.append(part)
    cand = " | ".join(kept)
    if kept and not _asserting(cand, company, legacy, website):
        return cand, notes + dropped, "clause(s) moved to the note"
    # 4. nothing left that is safe to write: refuse the cell, keep the evidence
    now = _asserting(text, company, legacy, website)
    if not now:
        return text, notes, ("relabelled (signal word -> neutral wording)"
                             if rewrote else "reduced")
    base, forced = now
    return "", notes + [text], (
        "REFUSED - every remaining phrase in this address asserts a sector "
        "(%s -> %s); kept as a Data Source note, so set the batch's `category` key "
        "instead if the evidence is real"
        % (base.get("primary_label") or "uncategorised",
           forced.get("primary_label") or "uncategorised"))
