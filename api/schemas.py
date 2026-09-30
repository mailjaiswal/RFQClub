"""Pydantic request schemas (responses are serialized explicitly in main.py)."""
from __future__ import annotations
from pydantic import BaseModel, Field


class BidCreate(BaseModel):
    supplier_id: int | None = None
    supplier_name: str = ""
    hub_city: str = ""
    distance_km: int | None = None
    capability_tags: list[str] = Field(default_factory=list)
    unit_price: float = Field(gt=0)
    tooling: float = Field(default=0, ge=0)
    freight: float = Field(default=0, ge=0)
    gst_included: bool = True
    lead_weeks: int | None = Field(default=None, ge=0)
    payment_terms: str = ""
    validity_days: int | None = Field(default=None, ge=0)
    exception_flag: bool = False
    exception_note: str = ""
    notes: str = ""
    source: str = "web"


class RfqCreate(BaseModel):
    title: str = Field(min_length=4)
    description: str = ""
    sector_key: str = "cnc"
    process: str = ""
    material: str = ""
    qty: float | None = None
    unit: str = ""
    budget_low: float | None = None
    budget_high: float | None = None
    currency: str = "₹"
    closes_in_days: int | None = Field(default=None, ge=0)
    clarify: list[str] = Field(default_factory=list)
    routing_cap: int = Field(default=5, ge=1, le=10)


class AwardIn(BaseModel):
    bid_id: int
