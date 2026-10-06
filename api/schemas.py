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


class AwardOrderIn(BaseModel):
    """Operator update of the post-award escrow / managed-QC / milestone state."""
    escrow_status: str | None = None   # not_started|funded|part_released|released
    qc_status: str | None = None       # n/a|scheduled|in_progress|passed|failed
    milestone_key: str | None = None
    milestone_state: str | None = None  # pending|active|done


# ---- concierge review workflow ----
class IntakeIn(BaseModel):
    """The web "Post an RFQ" form. Lands in the review queue, never straight on
    the board — publishing requires a concierge (see workflow.approve_draft)."""
    title: str = Field(min_length=4, max_length=200)
    description: str = Field(default="", max_length=4000)
    process: str = Field(default="", max_length=200)
    material: str = Field(default="", max_length=200)
    qty: float | None = Field(default=None, gt=0)
    unit: str = Field(default="", max_length=40)
    budget_low: float | None = Field(default=None, ge=0)
    budget_high: float | None = Field(default=None, ge=0)
    closes_in_days: int | None = Field(default=None, ge=0, le=365)
    sector_key: str = Field(default="", max_length=20)
    hub_city: str = Field(default="", max_length=80)


class ReviewEdits(BaseModel):
    """Field corrections an operator makes while reviewing. Only the keys sent are
    applied; a null on qty/low/high/closes_in_days clears that field."""
    title: str | None = None
    process: str | None = None
    material: str | None = None
    qty: float | None = None
    unit: str | None = None
    low: float | None = None
    high: float | None = None
    closes_in_days: int | None = None
    sector_key: str | None = None
    description: str | None = None
    notes: str | None = None
    hub_city: str | None = None


class ApproveIn(BaseModel):
    edits: ReviewEdits | None = None
    publish: bool = True
    force: bool = False  # approve despite a matching RFQ already being live


class ClarifyIn(BaseModel):
    """Answers to a draft's open clarify questions, keyed by field name
    (qty / material / process / budget). Empty answers are ignored."""
    answers: dict[str, str] = Field(default_factory=dict)


class RejectIn(BaseModel):
    reason: str = Field(default="", max_length=500)


class ImportBnSIn(BaseModel):
    """A pasted BnS page-extract to import into the review queue as drafts."""
    text: str = Field(min_length=1, max_length=200000)
    dry_run: bool = False


class RfqStatusIn(BaseModel):
    status: str = Field(pattern="^(published|draft|closed)$")


# ---- inside-sales "internal" area (see sales_api.py / lead_models.py) ----
class LeadStatusIn(BaseModel):
    """Move a lead to another pipeline stage. `note` is optional free text that is
    written through to the status-history audit row."""
    status: str
    note: str = Field(default="", max_length=1000)


class ActivityIn(BaseModel):
    """One logged touchpoint (call / WhatsApp / email / meeting / note). Append-only.
    `set_status`, when present, also advances the lead stage in the same write."""
    kind: str = Field(default="call")            # call|whatsapp|email|meeting|note|voicemail
    outcome: str = Field(default="")             # one of lead_models.ACTIVITY_OUTCOMES
    direction: str = Field(default="outbound")   # outbound|inbound
    summary: str = Field(default="", max_length=4000)
    pain_point: str = Field(default="", max_length=500)
    objection: str = Field(default="", max_length=500)
    competitor: str = Field(default="", max_length=200)
    contact_id: int | None = None
    duration_seconds: int | None = Field(default=None, ge=0)
    # ISO-8601 string; parsed defensively in the router, ignored if blank/bad.
    next_action_at: str | None = None
    next_action_note: str = Field(default="", max_length=500)
    set_status: str | None = None


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_at: str | None = None                    # ISO-8601
    assigned_to_email: str | None = None         # manager may route a task to another rep


class NextStepIn(BaseModel):
    """Set (or clear) the single 'what happens next' pointer on the lead."""
    next_action_at: str | None = None
    next_action_note: str = Field(default="", max_length=500)


class AssignIn(BaseModel):
    """Claim to self, or (manager) assign to a specific rep email. Passing neither
    unassigns the lead back to the shared pool."""
    lead_ids: list[int] = Field(default_factory=list, max_length=500)
    owner_email: str | None = None               # None/"" => claim to self; explicit => manager assign


# ---- Inside-sales console: manager-only Team (user provisioning) ----
class TeamCreateIn(BaseModel):
    email: str
    name: str = ""
    password: str
    role: str = "sales"          # sales | sales_manager


class TeamPasswordIn(BaseModel):
    email: str
    password: str


class TeamStatusIn(BaseModel):
    email: str
    is_active: bool


class TeamRoleIn(BaseModel):
    email: str
    role: str                    # sales | sales_manager
