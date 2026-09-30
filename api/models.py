"""RFQClub data models (SQLAlchemy 2.0)."""
from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime, Text, JSON, ForeignKey, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Buyer(Base):
    __tablename__ = "buyer"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company: Mapped[str] = mapped_column(String, default="")
    hub: Mapped[str] = mapped_column(String, default="")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    about: Mapped[str] = mapped_column(Text, default="")
    buys_sectors: Mapped[list] = mapped_column(JSON, default=list)


class Supplier(Base):
    __tablename__ = "supplier"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, default="")
    hub_city: Mapped[str] = mapped_column(String, default="")
    gst: Mapped[str] = mapped_column(String, default="")
    kyc_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    capability_tags: Mapped[list] = mapped_column(JSON, default=list)
    certifications: Mapped[list] = mapped_column(JSON, default=list)
    distance_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # P3 earned reputation (nullable until enough delivered-order history)
    delivered_orders: Mapped[int] = mapped_column(Integer, default=0)
    on_time_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    reject_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    response_score: Mapped[float | None] = mapped_column(Float, nullable=True)


class Rfq(Base):
    __tablename__ = "rfq"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String)
    sector_key: Mapped[str] = mapped_column(String, default="cnc")
    process: Mapped[str] = mapped_column(String, default="")
    material: Mapped[str] = mapped_column(String, default="")
    qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String, default="")
    budget_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    budget_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String, default="₹")
    budget_status: Mapped[str] = mapped_column(String, default="Open")  # Priced/Open
    est_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    closes_in_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bid_count: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(Text, default="")
    attachments: Mapped[list] = mapped_column(JSON, default=list)
    clarify: Mapped[list] = mapped_column(JSON, default=list)
    routing_cap: Mapped[int] = mapped_column(Integer, default=5)
    status: Mapped[str] = mapped_column(String, default="published")  # published/closed/awarded/draft
    buyer_id: Mapped[int | None] = mapped_column(ForeignKey("buyer.id"), nullable=True)
    issuer_name: Mapped[str] = mapped_column(String, default="")  # hidden from public API
    matched_supplier: Mapped[str] = mapped_column(String, default="")
    spec_notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    buyer: Mapped["Buyer"] = relationship()
    bids: Mapped[list["Bid"]] = relationship(back_populates="rfq", cascade="all, delete-orphan")

    @property
    def code(self) -> str:
        return f"RFQ·{self.id:04d}"


class Bid(Base):
    __tablename__ = "bid"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rfq_id: Mapped[int] = mapped_column(ForeignKey("rfq.id"), index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"), nullable=True)
    bidder_code: Mapped[str] = mapped_column(String, default="")  # A..E shown to buyer
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    tooling: Mapped[float] = mapped_column(Float, default=0)
    freight: Mapped[float] = mapped_column(Float, default=0)
    gst_included: Mapped[bool] = mapped_column(Boolean, default=True)
    lead_weeks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payment_terms: Mapped[str] = mapped_column(String, default="")
    validity_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exception_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    exception_note: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    tlc_cents: Mapped[int] = mapped_column(Integer, default=0)  # total landed cost, cents
    source: Mapped[str] = mapped_column(String, default="web")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    rfq: Mapped["Rfq"] = relationship(back_populates="bids")
    supplier: Mapped["Supplier"] = relationship()

    GST_RATE = 0.18

    def compute_tlc_cents(self, qty: float | None) -> int:
        line = (self.unit_price or 0) * (qty or 0)
        subtotal = line + (self.tooling or 0) + (self.freight or 0)
        gst = subtotal * self.GST_RATE if self.gst_included else 0
        return int(round((subtotal + gst) * 100))


class Award(Base):
    __tablename__ = "award"
    rfq_id: Mapped[int] = mapped_column(ForeignKey("rfq.id"), primary_key=True)
    bid_id: Mapped[int] = mapped_column(ForeignKey("bid.id"))
    awarded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    revealed: Mapped[bool] = mapped_column(Boolean, default=False)


class User(Base):
    __tablename__ = "user"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, default="")
    role: Mapped[str] = mapped_column(String, default="supplier")  # buyer/supplier/operator
    org_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    telegram_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class PendingDraft(Base):
    __tablename__ = "pending_draft"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(String, default="PENDING")  # PENDING/APPROVED/REJECTED
    raw_text: Mapped[str] = mapped_column(Text, default="")
    parsed: Mapped[dict] = mapped_column(JSON, default=dict)
    confidence: Mapped[dict] = mapped_column(JSON, default=dict)
    source_chat_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_msg_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
