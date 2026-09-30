"""Optional LLM-assist for structuring messy RFQ text (env-gated).

Regex (rfq_parser.from_freeform) is the always-on fallback. When LLM_ENABLED
and an API key are present we ask the model to map raw text to the sector
schema, then merge: regex fields win where they were confidently matched and
the LLM fills the gaps. Any provider/network error is swallowed so ingestion
never depends on the LLM being available. Returns None on failure.
"""
from __future__ import annotations
import json
import re

import config

_SECTOR_KEYS = ["cnc", "foundry", "sheet", "auto", "elec", "tools", "plant"]

SYSTEM_PROMPT = (
    "You extract a manufacturing RFQ (Request for Quotation) from messy, forwarded "
    "text or a voice transcript. Return ONLY a JSON object with these keys: "
    "title (short imperative), process, material, qty (number or null), unit, "
    "budget_low (number or null), budget_high (number or null), currency, "
    f"closes_in_days (integer or null), sector_key (one of: {', '.join(_SECTOR_KEYS)}), "
    "clarify (array of short questions the buyer must answer), confidence "
    "(object mapping each field name to a 0..1 float for how sure you are). "
    "Never invent numbers: if a value is not present in the text, return null "
    "and give it low confidence. Indian Lakh = 100000, Cr = 10000000."
)


def _extract_json(txt: str) -> dict | None:
    # tolerate code fences / trailing prose by grabbing the first {...} block
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def structure(text: str, regex_draft: dict) -> dict | None:
    """Return an enriched draft dict, or None if the LLM is off/unreachable."""
    if not (config.LLM_ENABLED and config.LLM_API_KEY and text):
        return None
    try:
        import httpx
        payload = {
            "model": config.LLM_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text[:4000]},
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
        r = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
            json=payload, timeout=25,
        )
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
    except Exception:
        return None

    llm = _extract_json(content)
    if not llm:
        return None

    merged = dict(regex_draft)
    conf = dict(regex_draft.get("confidence", {}) or {})
    llm_conf = llm.get("confidence", {}) or {}

    def pick(field, llm_key=None, regex_key=None):
        lk = llm_key or field
        rk = regex_key or field
        regex_val = regex_draft.get(rk)
        llm_val = llm.get(lk)
        # regex already confident -> keep it; else take LLM value when present
        if regex_val not in (None, "", 0.0) and conf.get(field, 0) >= 0.8:
            return
        if llm_val not in (None, ""):
            merged[field] = llm_val
            conf[field] = float(llm_conf.get(lk, 0.6))

    pick("title")
    pick("process")
    pick("material")
    pick("qty")
    pick("unit")
    pick("budget_low", llm_key="budget_low", regex_key="low")
    pick("budget_high", llm_key="budget_high", regex_key="high")
    pick("closes_in_days", llm_key="closes_in_days", regex_key="closes_in_days")
    if llm.get("sector_key") in _SECTOR_KEYS and conf.get("sector_key", 0) < 0.8:
        merged["sector_key"] = llm["sector_key"]
    if llm.get("clarify"):
        merged["clarify"] = llm["clarify"]
    if merged.get("budget_low") is not None:
        merged["low"] = merged.get("budget_low", merged.get("low"))
        merged["bstatus"] = "Priced"

    merged["confidence"] = conf
    merged["llm_used"] = True
    return merged
