"""Derive display tags for an RFQ from its raw fields.

The source workbook has no tag array, so tags are computed from what IS present:
the classified sector label, matched process keywords, material tokens, and
regex hits for certifications / finishes / tolerances in the title + spec notes.
Every tag carries a `kind` (sector|process|material|cert) that the UI uses to
color the chip. Pure functions, no DB / workbook access, no external deps beyond
the stdlib `re`.
"""
from __future__ import annotations
import re

from sectors import label as sector_label

# process keywords reused from the parser so tags stay consistent with routing
from rfq_parser import PROCESS_KW

# certification / finish / tolerance signals -> green "cert" chips
_CERT_RES = [
    re.compile(r"ISO\s?9001", re.I),
    re.compile(r"ISO\s?\d{4,5}", re.I),
    re.compile(r"AS\s?9100\s?[A-D]?", re.I),
    re.compile(r"IATF\s?16949", re.I),
    re.compile(r"\bCE\b"),
    re.compile(r"RAL\s?\d{4}", re.I),
    re.compile(r"ASTM\s?[A-Z]*\s?\d+[\w-]*", re.I),
    re.compile(r"\bBIS\b"),
    re.compile(r"IS\s?:?\s?\d+", re.I),
    re.compile(r"[±]\s?[\d.]+\s?mm", re.I),
    re.compile(r"Ra\s?[\d.]+", re.I),
    re.compile(r"NDT|X-ray|magnetic particle|dye penetrant", re.I),
    re.compile(r"anodis(ing|ed)|powder coat|zinc plat|passivat|electroplat|chrome plat", re.I),
    re.compile(r"heat treat|quench|temper|anneal|carburis", re.I),
]


def _dedup_keep_order(items: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for it in items:
        key = it["label"].lower()
        if key and key not in seen:
            seen.add(key)
            out.append(it)
    return out


def _clean(label: str) -> str:
    return re.sub(r"\s+", " ", (label or "")).strip(" -·,./")


def derive_tags(process: str, material: str, title: str, spec_notes: str,
                sector_key: str | None = None) -> list[dict]:
    """Return [{label, kind}] capped at 7. UI caps the visible set to 4."""
    tags: list[dict] = []

    # 1) sector tag first (always present, drives the colored legend)
    if sector_key:
        tags.append({"label": _clean(sector_label(sector_key)), "kind": "sector"})

    # 2) process tags: any PROCESS_KW hits present in process+title
    hay = f"{process} {title}".lower()
    for kw in PROCESS_KW:
        if kw in hay:
            tags.append({"label": _clean(kw), "kind": "process"})
    # also honor the explicit process cell even if not in the keyword list
    p = _clean(process)
    if p and p.lower() not in (t["label"].lower() for t in tags):
        tags.append({"label": p, "kind": "process"})

    # 3) material tags: leading tokens of the grade string (e.g. "6061-T6", "aluminium")
    mat = _clean(material)
    if mat:
        for tok in re.split(r"[\s/,]+", mat):
            tok = tok.strip("-·.,/")
            if len(tok) >= 2:
                tags.append({"label": tok, "kind": "material"})
            if sum(1 for t in tags if t["kind"] == "material") >= 2:
                break

    # 4) cert / finish / tolerance tags via regex over title + spec notes
    cert_hay = f"{title}. {spec_notes}"
    for rx in _CERT_RES:
        m = rx.search(cert_hay)
        if m:
            tags.append({"label": _clean(m.group(0)), "kind": "cert"})

    return _dedup_keep_order(tags)[:7]
