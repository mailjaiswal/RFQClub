"""RFQ parsing — reuses the proven regex parser from build_rfq_demand.py.

parse_rfq(chunk): structured BnS page-extract chunk (verbatim logic).
extract_* helpers + from_freeform(text): best-effort on arbitrary forwarded
text/voice-transcript (the bot path). The bot combines this regex pass with an
optional LLM pass; a human concierge always reviews before publish, so nothing
fabricated reaches the board.
"""
from __future__ import annotations
import re
from sectors import classify

PROCESS_KW = [
    "5-axis machined", "cnc turning centers", "cnc-machined", "cnc machined", "cnc turned",
    "vmc milled", "broached and hobbed", "precision ground", "deep hole drilling",
    "wire edm", "heat treatment", "anodising", "duplex and super duplex",
    "eps pattern tooling", "carbide inserts", "coolant management", "zero-point workholding",
    "double-girder", "pillar-mounted",
]


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def money(s: str) -> float:
    return float(s.replace(",", ""))


def _closes_days(closes: str) -> int | None:
    m = re.search(r"(\d+)\s*(day|week|month|hr|hour)", (closes or "").lower())
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2)
    if unit.startswith("week"):
        return n * 7
    if unit.startswith("month"):
        return n * 30
    if unit.startswith("hr") or unit.startswith("hour"):
        return 0
    return n


# ---------- structured BnS extract parser (verbatim logic) ----------
def parse_rfq(chunk: str) -> dict | None:
    lines = [l.strip() for l in chunk.splitlines() if l.strip() and l.strip() not in ("Filters", "1")]
    if not lines:
        return None
    title = lines[0]
    spec = next((l for l in lines[1:] if "·" in l and "Qty" in l), "")
    tl = title.lower()
    process = next((p for p in PROCESS_KW if p in tl), "")
    material = spec.split("· Qty")[0].strip() if spec else ""
    m = re.search(r"Qty\s+([\d,\.]+)\s*(pcs|sets?|package|lots?|tonnes?|tools?)", spec, re.I)
    qty = money(m.group(1)) if m else None
    unit = (m.group(2).rstrip("s").lower() if m else "")
    notes = ""
    if spec and m:
        tail = spec.split("·", 2)
        notes = " · ".join(x.strip() for x in tail[2:]) if len(tail) > 2 else ""
    budget = next((l for l in lines if "Open budget" in l or ("/" in l and re.search(r"[₹$€]", l))), "")
    cur = low = high = None
    bstatus = "Open"
    unit_price = ""
    if budget and "Open budget" not in budget:
        mb = re.match(r"\s*([₹$€])\s*([\d,\.]+)\s*-\s*([\d,\.]+)\s*/\s*(\w+)", budget)
        if mb:
            cur, low, high, unit_price = mb.group(1), money(mb.group(2)), money(mb.group(3)), mb.group(4).lower()
            bstatus = "Priced"
    closes = next((l for l in lines if "Closes in" in l), "")
    closes = closes.replace("Closes in", "").strip()
    bids = next((l for l in lines if re.match(r"\d+ bids?$", l)), "")
    bids_n = int(bids.split()[0]) if bids else None
    issuer = ""
    for i, l in enumerate(lines):
        if "Company name hidden" in l:
            issuer = lines[i - 1]
            break
    est_total = round(((low + high) / 2) * qty, 2) if (qty and low is not None) else None
    d = dict(
        title=title, process=process, material=material, qty=qty, unit=unit or unit_price,
        cur=cur or "", low=low, high=high, bstatus=bstatus, closes=closes,
        closes_in_days=_closes_days(closes), bids=bids_n,
        issuer=issuer, notes=notes, est_total=est_total,
    )
    d["sector_key"] = classify(process, title, material)
    return d


# ---------- free-form best-effort extractors (bot path) ----------
_RE_QTY = re.compile(r"(\d[\d,\.]*)\s*(pcs|pieces|sets?|no\.?|numbers?|tons?|kg|units?|lots?)", re.I)
_RE_MONEY = re.compile(r"(₹|Rs\.?|INR|\$|€)\s*([0-9][\d,\.]*)\s*(Lakh|Lakhs|Lac|Cr|Crore|Crores|k|000)?", re.I)
_RE_RANGE = re.compile(r"(₹|Rs\.?|INR)?\s*([\d,\.]+)\s*(?:-|to)\s*([\d,\.]+)\s*(?:/|per\s+)?(\w+)?", re.I)
_RE_DAYS = re.compile(r"(\d+)\s*(day|week|month)s?", re.I)


def _to_number(num: str, mult: str) -> float:
    v = money(num)
    m = (mult or "").lower()
    if m in ("lakh", "lakhs", "lac"):
        v *= 1_00_000
    elif m in ("cr", "crore", "crores"):
        v *= 1_00_00_000
    elif m in ("k", "000"):
        v *= 1_000
    return v


def extract_qty(text: str) -> tuple[float | None, str]:
    m = _RE_QTY.search(text)
    if not m:
        return None, ""
    return money(m.group(1)), m.group(2).rstrip("s").lower()


def extract_budget(text: str) -> tuple[float | None, float | None, str]:
    mr = _RE_RANGE.search(text)
    if mr and "/" in (mr.group(0) or ""):
        try:
            return money(mr.group(2)), money(mr.group(3)), "₹"
        except Exception:
            pass
    ms = list(_RE_MONEY.finditer(text))
    if ms:
        low = _to_number(ms[0].group(2), ms[0].group(3))
        high = _to_number(ms[-1].group(2), ms[-1].group(3)) if len(ms) > 1 else low
        return low, (high or None), "₹"
    return None, None, ""


def extract_deadline(text: str) -> int | None:
    m = _RE_DAYS.search(text)
    if not m:
        return None
    return _closes_days(m.group(0))


def from_freeform(text: str) -> dict:
    """Regex pass over arbitrary text -> a draft dict + per-field confidence.

    Confidence is honest: high when the token was actually matched, low/absent
    when guessed. The concierge review + optional LLM pass fill the gaps.
    """
    text = text or ""
    first_line = next((l.strip() for l in text.splitlines() if l.strip()), "")[:120]
    qty, unit = extract_qty(text)
    low, high, cur = extract_budget(text)
    days = extract_deadline(text)
    process = next((p for p in PROCESS_KW if p in text.lower()), "")
    confidence = {
        "title": 0.6 if first_line else 0.0,
        "process": 0.8 if process else 0.3,
        "qty": 0.9 if qty else 0.0,
        "budget": 0.85 if (low is not None) else 0.2,
        "deadline": 0.8 if days is not None else 0.0,
    }
    return dict(
        title=first_line, process=process, material="",
        qty=qty, unit=unit, low=low, high=high, cur=cur or "₹",
        bstatus="Priced" if low is not None else "Open",
        closes_in_days=days, bids=None, issuer="", notes="",
        est_total=round(((low + (high or low)) / 2) * qty, 2) if (qty and low is not None) else None,
        sector_key=classify(process, first_line, ""),
        confidence=confidence,
    )
