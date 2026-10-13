"""AI free-text ingestion — read any pasted text and work out what the console should do.

The rep pastes an unstructured snippet into the console "paste anything" box: a
WhatsApp reply, a forwarded email, a cold-call note, an RFQ enquiry, or a supplier
quotation. This module hands that raw text to a large language model (Gemini is the
primary engine, matching the Swaniki CRM; an OpenAI-compatible provider is an
optional fallback) and asks it to decide WHICH of the three things the text actually
is, and to pull the structured fields out of it.

It returns an "analysis" dict — nothing is written to the database here. The console
shows this analysis to the rep as a PREVIEW; only after the rep confirms does
sales_api's /leads/ai/accept route commit it (routing a `lead` to the CRM, an `rfq`
to the board-or-draft queue, and a `supplier_quote` to a bid or a supplier lead).

Deliberately free of DB/auth imports: this is a pure text->JSON translator so it can
be smoke-tested on its own and can never accidentally write.

Key resolution:
    1. GEMINI_API_KEY (api/config.env or the environment)  -> primary
    2. LLM_ENABLED + LLM_API_KEY (OpenAI-style)            -> fallback
Neither set => available() is False and the API returns a clear 503, so it is obvious
what to configure rather than a silent no-op.
"""
from __future__ import annotations

import json
import re
import time

import httpx

import config

# ---- model wiring ---------------------------------------------------------

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
# Tried in order; whatever answers last is used first next call. Mirrors the
# proven call pattern the Swaniki CRM ships (same free-tier model family).
GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash"]
_Cool_SECONDS = 60
_state = {"preferred": None, "cool": {}}

MAX_TEXT_CHARS = 20000


def gemini_key() -> str:
    return (getattr(config, "GEMINI_API_KEY", "") or "").strip()


def openai_ready() -> bool:
    return bool(getattr(config, "LLM_ENABLED", False) and getattr(config, "LLM_API_KEY", ""))


def available() -> bool:
    """Is any AI engine configured? If not, the caller returns 503 rather than
    pretending the paste was understood."""
    return bool(gemini_key() or openai_ready())


# ---- the extraction contract ---------------------------------------------

# These field lists are what the model is allowed to emit; sales_api re-validates
# every key against the real columns before anything is written, so a hallucinated
# field is dropped server-side, never trusted.
LEAD_KEYS = [
    "company", "category", "legal_name", "track", "city", "country", "address",
    "website", "linkedin_url", "gst", "cin", "size_band", "what_they_do",
    "contact_name", "designation", "email", "phone_primary", "phone_secondary",
    "whatsapp", "decision_maker", "status", "notes",
]
RFQ_KEYS = [
    "title", "sector_key", "process", "material", "qty", "unit",
    "budget_low", "budget_high", "currency", "closes_in_days", "description",
    "issuer_name", "hub_city", "notes",
]
QUOTE_KEYS = [
    "rfq_code", "rfq_title", "supplier_name", "contact_name", "designation",
    "email", "phone", "city", "item", "unit_price", "currency", "qty", "unit",
    "tooling", "freight", "lead_weeks", "payment_terms", "validity_days",
    "gst_included", "notes",
]


def build_system_prompt(categories: list[dict], sectors: list[dict]) -> str:
    cat_lines = "\n".join(f'  - "{c["key"]}" = {c["label"]}' for c in categories)
    sec_lines = "\n".join(f'  - "{s["key"]}" = {s["label"]}' for s in sectors)
    return (
        "You are the ingestion engine inside RFQClub, an Indian B2B manufacturing "
        "RFQ marketplace. A sales rep pastes free text — a WhatsApp reply, a forwarded "
        "email, a call note, an enquiry, or a supplier quotation. Decide what it is and "
        "extract the structured data. Return ONLY one JSON object, no prose, no code "
        "fences, EXACTLY this shape:\n\n"
        "{\n"
        '  "kind": "lead" | "rfq" | "supplier_quote" | "unknown",\n'
        '  "confidence": 0.0 to 1.0,\n'
        '  "summary": "<one plain-English sentence, <=180 chars, what you understood>",\n'
        '  "record": { ...fields for that kind only... },\n'
        '  "missing": ["<human labels of fields a complete record needs that the text does NOT state>"],\n'
        '  "notes": "<anything you deliberately left out, or an empty string>"\n'
        "}\n\n"
        "Field sets per kind (use ONLY these keys inside \"record\"):\n"
        "- lead: " + ", ".join(LEAD_KEYS) + "\n"
        "- rfq: " + ", ".join(RFQ_KEYS) + "\n"
        "- supplier_quote: " + ", ".join(QUOTE_KEYS) + "\n\n"
        "What each kind means:\n"
        "- lead: someone/company worth selling TO — a prospect, a contact, a firm that "
        "makes something and might join the platform. Extract company (required) and any "
        "contact/phone/email/address/GST/website details.\n"
        "- rfq: a BUYER asking for a quotation for parts/work — quantity, material, "
        "process, budget, deadline. Extract a short imperative title plus the specs.\n"
        "- supplier_quote: a SELLER replying with a PRICE for an existing RFQ (\"we can "
        "make that for ₹42/pc, 3 weeks\"). If the text names an RFQ (a code like RFQ·0007 "
        "or an RFQ id number, or a title that identifies one), put it in rfq_code/rfq_title "
        "so it can be filed as a bid. If no RFQ is identifiable, leave rfq_code empty — it "
        "will be saved as a supplier lead instead.\n\n"
        "Valid category keys for a LEAD (\"category\"):\n" + cat_lines + "\n"
        "Use the KEY, or the exact label; blank if genuinely unknown.\n"
        "Valid sector_key values for an RFQ:\n" + sec_lines + "\n\n"
        "Rules you must not break:\n"
        "- NEVER invent a value that is not stated or clearly implied in the text. A "
        "phone, email, price, date or name not present must be omitted or null — do not "
        "guess. Set \"missing\" to the fields a complete record would want.\n"
        "- Clean final forms only: phone as digits with +91 where the text gives an Indian "
        "number, email lowercase, links with https://. Indian Lakh = 100000, Cr = 10000000.\n"
        "- decision_maker / gst_included are \"Y\" or \"N\" or omit. qty, budget_low, "
        "budget_high, unit_price, tooling, freight, lead_weeks, validity_days, "
        "closes_in_days are numbers (or null). currency defaults to ₹ (INR) only if a "
        "rupee amount appears without an explicit currency.\n"
        "- If the text is a greeting, spam, or carries no actionable data, return "
        "kind=\"unknown\" with an empty record and explain in summary.\n"
        "- If you truly cannot tell between kinds, pick the closest and lower confidence; "
        "a human confirms the preview before anything is saved.\n"
        "- Never emit a password, secret or credential."
    )


# ---- the model call -------------------------------------------------------

def _extract_json(txt: str) -> dict:
    """Models occasionally wrap JSON in prose or fences; dig the object out."""
    try:
        return json.loads(txt)
    except Exception:
        pass
    start, end = txt.find("{"), txt.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(txt[start:end + 1])
        except Exception:
            pass
    raise ValueError("the model did not return readable JSON: " + (txt or "")[:200])


def _model_order() -> list[str]:
    now = time.time()
    _state["cool"] = {m: t for m, t in _state["cool"].items() if t > now}
    order: list[str] = []
    pref = _state["preferred"]
    if pref and pref in GEMINI_MODELS and pref not in _state["cool"]:
        order.append(pref)
    for m in GEMINI_MODELS:
        if m not in order and m not in _state["cool"]:
            order.append(m)
    return order or list(GEMINI_MODELS)


def _call_gemini(text: str, system: str) -> tuple[str, str]:
    key = gemini_key()
    payload = {
        "contents": [{"role": "user", "parts": [{"text": text[:MAX_TEXT_CHARS]}]}],
        "systemInstruction": {"parts": [{"text": system}]},
        "generationConfig": {
            "temperature": 0.0,
            # These are "thinking" models: a small cap leaves the reasoning tokens
            # no room and the reply comes back empty, so leave a generous budget
            # and bound the thinking (same lesson the Swaniki CRM learned).
            "maxOutputTokens": 8192,
            "thinkingConfig": {"thinkingBudget": 1024},
            "responseMimeType": "application/json",
        },
    }
    headers = {"x-goog-api-key": key, "Content-Type": "application/json"}
    last = "unknown"
    for model in _model_order():
        for attempt in range(3):
            try:
                r = httpx.post(
                    f"{GEMINI_BASE}/models/{model}:generateContent",
                    headers=headers, json=payload, timeout=60)
            except httpx.RequestError as exc:
                last = str(exc)
                continue
            if r.status_code == 200:
                data = r.json()
                cand = (data.get("candidates") or [{}])[0]
                parts = (cand.get("content") or {}).get("parts") or []
                out = "".join(p.get("text", "") for p in parts).strip()
                if out:
                    _state["preferred"] = model
                    _state["cool"].pop(model, None)
                    return out, model
                last = f"empty (finishReason={cand.get('finishReason')})"
                break
            if r.status_code == 429:
                last = "429 rate limited"
                if attempt < 2:
                    time.sleep(3 * (attempt + 1))
                    continue
                _state["cool"][model] = time.time() + _Cool_SECONDS
                break
            if r.status_code in (500, 502, 503, 504):
                last = f"{r.status_code}: {r.text[:150]}"
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                break
            last = f"{r.status_code}: {r.text[:150]}"
            break
    raise RuntimeError(f"Gemini request failed — {last}")


def _call_openai(text: str, system: str) -> tuple[str, str]:
    model = getattr(config, "LLM_MODEL", "gpt-4o-mini")
    r = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
        json={
            "model": model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": text[:MAX_TEXT_CHARS]}],
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
        },
        timeout=45,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"], model


def analyze(text: str, categories: list[dict], sectors: list[dict]) -> dict:
    """Classify + extract one pasted blob. Returns the analysis dict; raises if no
    engine is configured or the model misbehaves (the caller maps that to a 5xx)."""
    text = (text or "").strip()
    if not text:
        raise ValueError("nothing to analyse — paste some text first")
    system = build_system_prompt(categories, sectors)
    if gemini_key():
        raw, model = _call_gemini(text, system)
    elif openai_ready():
        raw, model = _call_openai(text, system)
    else:
        raise RuntimeError("no AI engine configured")
    data = _extract_json(raw)
    return normalize_analysis(data, model=model)


# ---- normalisation (server never trusts the model's shape) ----------------

_KINDS = ("lead", "rfq", "supplier_quote", "unknown")
_ALLOWED_BY_KIND = {
    "lead": set(LEAD_KEYS),
    "rfq": set(RFQ_KEYS),
    "supplier_quote": set(QUOTE_KEYS),
    "unknown": set(),
}


def _coerce_num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return v
    s = re.sub(r"[^\d.\-]", "", str(v))
    if not s or s in ("-", "."):
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() else f
    except ValueError:
        return None


_NUM_FIELDS = {
    "qty", "budget_low", "budget_high", "closes_in_days", "unit_price",
    "tooling", "freight", "lead_weeks", "validity_days",
}


def normalize_analysis(data: dict, model: str = "") -> dict:
    """Trim the model's output to the contract: a known kind, only allowed keys,
    numbers coerced, junk dropped. This is the object handed to the preview and
    echoed back on accept."""
    if not isinstance(data, dict):
        data = {}
    kind = str(data.get("kind") or "").strip().lower()
    if kind not in _KINDS:
        kind = "unknown"
    raw_rec = data.get("record") if isinstance(data.get("record"), dict) else {}
    allowed = _ALLOWED_BY_KIND[kind]
    rec: dict = {}
    for k, v in raw_rec.items():
        key = str(k).strip().lower()
        if key not in allowed:
            continue
        if key in _NUM_FIELDS:
            n = _coerce_num(v)
            if n is not None:
                rec[key] = n
            continue
        if isinstance(v, bool):
            rec[key] = "Y" if v else "N"
            continue
        if v is None:
            continue
        s = str(v).strip()
        if s and s.lower() not in ("null", "none", "n/a", "na", "-"):
            rec[key] = s
    try:
        conf = float(data.get("confidence", 0) or 0)
    except (TypeError, ValueError):
        conf = 0.0
    missing = data.get("missing")
    missing = [str(m).strip() for m in missing if str(m).strip()] if isinstance(missing, list) else []
    return {
        "kind": kind,
        "confidence": round(max(0.0, min(1.0, conf)), 2),
        "summary": str(data.get("summary") or "").strip()[:300],
        "record": rec,
        "missing": missing[:20],
        "notes": str(data.get("notes") or "").strip()[:400],
        "model": model,
    }
