"""Inside-sales lead system — ORM tables.

Kept in its own module (not `models.py`) because the marketplace core and the
sales pipeline have genuinely different lifecycles: a `supplier` row only exists
once a company is live on the platform, while a `lead` row churns through nine
stages on the way there. `company` holds stable identity, `lead` holds volatile
pipeline state, and they stay separate for exactly that reason.

Migration convention matches `db.py`: `create_all` builds these tables on first
run, and the `_ensure_*` helpers below are registered with `db.init_db()` so
later column additions ALTER safely on both SQLite and Postgres.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime, Text, JSON, ForeignKey,
    UniqueConstraint, Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base

# Imported for the registry: `Lead.owner` resolves "User" by name, so the
# marketplace models must be registered before mappers are configured.
import models  # noqa: F401


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# Controlled vocabularies. Kept here (not in schemas.py) so the importer,
# the API and the tests all assert against one definition.
# --------------------------------------------------------------------------

# Stored pipeline stages. Exactly one per lead; the funnel partition.
STATUSES = (
    "uncontacted",
    "attempted_no_reply",
    "connected",
    "qualified",
    "onboarding",
    "onboarded",
    "not_interested",
    "nurture",
    "incorrect",
)
DEFAULT_STATUS = "uncontacted"

# Which side of the marketplace this company is being onboarded onto. Different
# pipeline, different script, different CTA.
TRACKS = ("supplier", "buyer")

# Dashboard tiles that are DERIVED from activities/tasks rather than stored.
# These deliberately overlap the statuses above - they are workload views, not
# pipeline stages, and must never be summed with the funnel.
DERIVED_METRICS = (
    "contacted",
    "unanswered",
    "followups_pending",
    "unassigned",
    "mine",
)

ACTIVITY_KINDS = ("call", "whatsapp", "email", "meeting", "note", "voicemail")

ACTIVITY_OUTCOMES = (
    "connected", "no_answer", "busy", "voicemail", "call_back_requested",
    "wrong_number", "email_sent", "email_replied", "email_bounced",
    "whatsapp_sent", "whatsapp_replied", "meeting_booked",
    "not_interested", "callback_completed", "snoozed",
)

# Source `Lead Status` values from the BnS workbook and where each one lands.
# 234 `Non-Indian` + 35 `Foreign - out of scope` are RETAINED but hidden from the
# rep queue (confirmed 2026-10-05) rather than deleted - they may still be worth
# exporting to a future partner.
SOURCE_STATUS_MAP = {
    "valid lead": (DEFAULT_STATUS, False, ""),
    "new lead": (DEFAULT_STATUS, False, ""),
    "non-indian": (DEFAULT_STATUS, True, "Non-Indian (retained, hidden from sales)"),
    "foreign - out of scope": (DEFAULT_STATUS, True, "Foreign - out of scope (retained, hidden)"),
    "ambiguous": (DEFAULT_STATUS, True, "Ambiguous - needs triage"),
    "nothing found": ("incorrect", False, "No data found for this company"),
}
SOURCE_EXCLUDED = ("non-indian", "foreign - out of scope", "ambiguous")
# Registry status written by the enrichment batches, e.g. "Dead - Strike Off".
DEAD_STATUS_PREFIX = "dead"

# Written by an enrichment batch when research PROVED the row is not an entity a
# rep can do business with, even though the registry says it is alive: a project
# vehicle that has not built anything, a holding/trading shell with no works, a
# real-estate or jewellery name that only shares a word with an industrial unit.
# The suffix is free text because the reason is different every time, so it is
# matched by prefix the same way `Dead - ...` is. Note this is NOT `nothing found`
# (which means the data itself is unusable) and NOT `incorrect`: the company is
# real and Indian, it is simply not a lead, so it keeps a normal status and is
# hidden from the queue rather than disqualified - the same treatment as a
# Non-Indian row, and reversible by a human reading the exclusion reason.
OUT_OF_SCOPE_PREFIX = "out of scope"


def map_source_status(src: str):
    """BnS / Expansion workbook `Lead Status` ->
    (status, excluded_from_sales, exclusion_reason, disqualify_reason).

    A `Dead - <MCA status>` row is BOTH hidden from the rep queue and disqualified:
    a struck-off / dissolved / amalgamated company cannot be onboarded, unlike a
    Non-Indian row which is kept live for a possible future partner. Centralised
    here because the suffix varies per batch (Strike Off, Amalgamated, Under
    Liquidation, Dissolved, CIRP) so an exact-key map could never cover it.
    """
    key = (src or "").strip().lower()
    if key.startswith(DEAD_STATUS_PREFIX):
        detail = key.partition("-")[2].strip()
        return ("incorrect", True, "Registry-dead (retained, hidden from sales)",
                "MCA status: " + (detail or "struck off / dissolved"))
    if key.startswith(OUT_OF_SCOPE_PREFIX):
        detail = key.partition("-")[2].strip()
        return (DEFAULT_STATUS, True,
                "Out of scope (retained, hidden from sales): "
                + (detail or "not an operational industrial unit"), "")
    status, excluded, reason = SOURCE_STATUS_MAP.get(
        key, (DEFAULT_STATUS, False, ""))
    # the single `reason` string meant "why hidden" for excluded rows and
    # "why wrong data" for everything else - split it into the right column.
    return status, excluded, reason if excluded else "", "" if excluded else reason


TASK_STATUSES = ("open", "done", "cancelled")


class Category(Base):
    """Mirror of `rfq_categories.py` so the UI can render research axes and a new
    category can ship as data rather than a deploy."""
    __tablename__ = "category"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    label: Mapped[str] = mapped_column(String)
    tier: Mapped[int] = mapped_column(Integer, default=2)  # 1 researched focus, 2 legacy
    default_track: Mapped[str] = mapped_column(String, default="supplier")
    spec_standardization: Mapped[str] = mapped_column(String, default="")
    repeat_frequency: Mapped[str] = mapped_column(String, default="")
    buyer_urgency: Mapped[str] = mapped_column(String, default="")
    winning_edge: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String, default="#3A3A3A")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    keyword_count: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class Company(Base):
    """One row per company. Stable identity, no pipeline state.

    `name_norm` is the dedupe key: lowercased, punctuation-stripped. The import
    upserts on it, which is what makes re-running the importer safe.
    """
    __tablename__ = "company"
    __table_args__ = (
        Index("ix_company_category_primary", "category_primary"),
        Index("ix_company_country", "country"),
        Index("ix_company_hub_city", "hub_city"),
        Index("ix_company_enrichment_status", "enrichment_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    name_norm: Mapped[str] = mapped_column(String, unique=True, index=True)
    legal_name: Mapped[str] = mapped_column(String, default="")

    website: Mapped[str] = mapped_column(String, default="")
    gmb_link: Mapped[str] = mapped_column(String, default="")
    linkedin_url: Mapped[str] = mapped_column(String, default="")

    country: Mapped[str] = mapped_column(String, default="")
    country_confidence: Mapped[str] = mapped_column(String, default="")
    hub_city: Mapped[str] = mapped_column(String, default="")
    address: Mapped[str] = mapped_column(Text, default="")
    # Parsed from the address free text, which frequently embeds a business
    # description: "... Rajkot 360311, Gujarat, India - brake discs, drums & hubs".
    what_they_do: Mapped[str] = mapped_column(Text, default="")

    # NOTE: columns listed in __table_args__ below must NOT also set index=True.
    # SQLAlchemy auto-names a column index ix_<table>_<column>, which collides
    # with the explicit Index of the same name at create_all time.
    category_primary: Mapped[str] = mapped_column(String, default="")
    category_tags: Mapped[list] = mapped_column(JSON, default=list)
    category_tier: Mapped[int] = mapped_column(Integer, default=2)
    category_confidence: Mapped[str] = mapped_column(String, default="")
    category_source: Mapped[str] = mapped_column(String, default="")
    category_rationale: Mapped[str] = mapped_column(Text, default="")
    legacy_category: Mapped[str] = mapped_column(String, default="")
    adjacency: Mapped[list] = mapped_column(JSON, default=list)

    gst: Mapped[str] = mapped_column(String, default="")
    cin: Mapped[str] = mapped_column(String, default="")
    size_band: Mapped[str] = mapped_column(String, default="")
    review_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    review_rating: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Short system key that produced this row ("bns", "expansion"), NOT a prose
    # note - see source_note. Grouping on this must yield a handful of values.
    source_system: Mapped[str] = mapped_column(String, default="")
    # Verbatim provenance sentence from the workbook's `Data Source` column.
    # Kept separately so source_system stays a clean enum for filtering.
    source_note: Mapped[str] = mapped_column(Text, default="")
    source_row_ref: Mapped[str] = mapped_column(String, default="")
    enrichment_status: Mapped[str] = mapped_column(String, default="raw")

    onboarded_supplier_id: Mapped[int | None] = mapped_column(
        ForeignKey("supplier.id"), nullable=True)
    onboarded_buyer_id: Mapped[int | None] = mapped_column(
        ForeignKey("buyer.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    contacts: Mapped[list["Contact"]] = relationship(
        back_populates="company", cascade="all, delete-orphan")
    leads: Mapped[list["Lead"]] = relationship(
        back_populates="company", cascade="all, delete-orphan")


class Contact(Base):
    """One row per person. The BnS source is contact-grain, so contacts arrive
    before companies have been deduped."""
    __tablename__ = "contact"
    __table_args__ = (
        Index("ix_contact_company_id", "company_id"),
        Index("ix_contact_phone_primary", "phone_primary"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("company.id"), nullable=False)
    full_name: Mapped[str] = mapped_column(String, default="")
    designation: Mapped[str] = mapped_column(String, default="")
    decision_maker: Mapped[bool] = mapped_column(Boolean, default=False)
    email: Mapped[str] = mapped_column(String, default="", index=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    phone_primary: Mapped[str] = mapped_column(String, default="")
    phone_secondary: Mapped[str] = mapped_column(String, default="")
    whatsapp: Mapped[str] = mapped_column(String, default="")
    preferred_channel: Mapped[str] = mapped_column(String, default="")  # Phone/WhatsApp/Email
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    # India DPDP / TCPA-style suppression. Manual outreach only (no WhatsApp API),
    # so the app never sends - it only links out - but a rep must be able to
    # record that a number must not be dialled again.
    do_not_call: Mapped[bool] = mapped_column(Boolean, default=False)
    source_row_ref: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    company: Mapped["Company"] = relationship(back_populates="contacts")


class Lead(Base):
    """One row per company PER TRACK. `UNIQUE(company_id, track)` lets a company
    that both bids and posts RFQs carry two leads while sharing one overview."""
    __tablename__ = "lead"
    __table_args__ = (
        UniqueConstraint("company_id", "track", name="uq_lead_company_track"),
        Index("ix_lead_owner_id", "owner_id"),
        Index("ix_lead_status", "status"),
        Index("ix_lead_owner_status", "owner_id", "status"),
        Index("ix_lead_next_action_at", "next_action_at"),
        Index("ix_lead_excluded", "excluded_from_sales"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("company.id"), nullable=False)
    track: Mapped[str] = mapped_column(String, default="supplier")

    status: Mapped[str] = mapped_column(String, default=DEFAULT_STATUS)
    status_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)

    priority_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    priority_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)

    wants_call_back_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    next_action_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    next_action_note: Mapped[str] = mapped_column(String, default="")
    followup_count: Mapped[int] = mapped_column(Integer, default=0)
    last_contacted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    last_inbound_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)

    qualified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    qualified_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    disqualify_reason: Mapped[str] = mapped_column(String, default="")
    nurture_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)

    # Retained-but-hidden out-of-scope leads (Non-Indian / Foreign / Ambiguous).
    # Never deleted; hidden from the rep queue behind a manager toggle.
    excluded_from_sales: Mapped[bool] = mapped_column(Boolean, default=False)
    exclusion_reason: Mapped[str] = mapped_column(String, default="")

    # Canonical source of the lead ("bns", "expansion", ...). Can be aggregated;
    # the raw details, if needed, live on import_batch and the workbook.
    source: Mapped[str] = mapped_column(String, default="")
    source_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    company: Mapped["Company"] = relationship(back_populates="leads")
    owner: Mapped["object | None"] = relationship("User", foreign_keys=[owner_id])


class LeadStatusHistory(Base):
    """Who moved a lead, when, and why. Non-negotiable on a shared pipeline."""
    __tablename__ = "lead_status_history"
    __table_args__ = (Index("ix_lsh_lead_id", "lead_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("lead.id"), nullable=False)
    from_status: Mapped[str] = mapped_column(String, default="")
    to_status: Mapped[str] = mapped_column(String, default="")
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    changed_by_email: Mapped[str] = mapped_column(String, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow)


class LeadActivity(Base):
    """The conversation log - the substance of 'update based on conversations'.

    `pain_point` and `objection` are structured rather than free prose so the
    team accumulates category research as a by-product of calling.
    """
    __tablename__ = "lead_activity"
    __table_args__ = (
        Index("ix_la_lead_id", "lead_id"),
        Index("ix_la_created_at", "created_at"),
        Index("ix_la_kind", "kind"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("lead.id"), nullable=False)
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contact.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String, default="call")
    direction: Mapped[str] = mapped_column(String, default="outbound")
    outcome: Mapped[str] = mapped_column(String, default="")
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    pain_point: Mapped[str] = mapped_column(String, default="")
    objection: Mapped[str] = mapped_column(String, default="")
    competitor: Mapped[str] = mapped_column(String, default="")
    # When set, the API writes this through to lead.next_action_at so the
    # follow-ups-pending tile needs no join.
    next_action_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_by_email: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow)


class LeadTask(Base):
    __tablename__ = "lead_task"
    __table_args__ = (
        Index("ix_lt_lead_id", "lead_id"),
        Index("ix_lt_status_due", "status", "due_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("lead.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, default="")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, default="open")
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)


class LeadScriptTemplate(Base):
    """Per-category call scripts. Resolved by specificity:
    (category, track) -> (NULL, track). Always resolves, so the panel is never
    empty on the lead page."""
    __tablename__ = "lead_script_template"
    __table_args__ = (
        Index("ix_lst_track_category", "track", "category_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_key: Mapped[str | None] = mapped_column(
        ForeignKey("category.key"), nullable=True)
    track: Mapped[str] = mapped_column(String, default="supplier")
    name: Mapped[str] = mapped_column(String, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    opener: Mapped[list] = mapped_column(JSON, default=list)
    pitch: Mapped[str] = mapped_column(Text, default="")
    discovery_questions: Mapped[list] = mapped_column(JSON, default=list)
    qualification_checklist: Mapped[list] = mapped_column(JSON, default=list)
    objection_handling: Mapped[dict] = mapped_column(JSON, default=dict)
    cta: Mapped[str] = mapped_column(Text, default="")
    do_not_say: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class ImportBatch(Base):
    """Provenance for every import run, so a bad run can be diagnosed and
    reversed. The importer is idempotent; this is the audit trail."""
    __tablename__ = "import_batch"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_file: Mapped[str] = mapped_column(String, default="")
    sheet: Mapped[str] = mapped_column(String, default="")
    rows_read: Mapped[int] = mapped_column(Integer, default=0)
    companies_created: Mapped[int] = mapped_column(Integer, default=0)
    companies_updated: Mapped[int] = mapped_column(Integer, default=0)
    contacts_created: Mapped[int] = mapped_column(Integer, default=0)
    leads_created: Mapped[int] = mapped_column(Integer, default=0)
    duplicates_skipped: Mapped[int] = mapped_column(Integer, default=0)
    rows_rejected: Mapped[int] = mapped_column(Integer, default=0)
    rejected_detail: Mapped[list] = mapped_column(JSON, default=list)
    excluded_from_sales: Mapped[int] = mapped_column(Integer, default=0)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False)
    run_by: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
