"""Display helpers: Indian Lakh/Cr formatting + deadline urgency buckets."""
from __future__ import annotations
from datetime import datetime, timezone


def format_inr(value: float | None, currency: str = "₹") -> str:
    if value is None:
        return "—"
    sym = {"₹": "₹", "INR": "₹", "$": "$", "€": "€"}.get((currency or "₹").strip(), "₹")
    v = float(value)
    if v >= 1_00_00_000:
        return f"{sym}{v / 1_00_00_000:.2f} Cr"
    if v >= 1_00_000:
        return f"{sym}{v / 1_00_000:.2f} L"
    if v >= 1_000:
        return f"{sym}{v:,.0f}"
    return f"{sym}{v:,.0f}"


def urgency(closes_in_days: int | None) -> str:
    """green = comfortable, amber = closing soon, red = last few days."""
    if closes_in_days is None:
        return "green"
    if closes_in_days <= 3:
        return "red"
    if closes_in_days <= 7:
        return "amber"
    return "green"


def cents_to_rupees(cents: int) -> float:
    return round((cents or 0) / 100, 2)


def is_open(closes_at: datetime | None) -> bool:
    if closes_at is None:
        return True
    if closes_at.tzinfo is None:
        closes_at = closes_at.replace(tzinfo=timezone.utc)
    return closes_at > datetime.now(timezone.utc)
