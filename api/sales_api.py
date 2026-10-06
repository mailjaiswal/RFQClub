"""Inside-sales "internal" API — the workspace the inside-sales team uses to work
the BnS + Expansion lead books.

Every route here lives under a single router-level dependency, `require_sales`, so
the whole surface is gated as one: an account must carry a sales/sales_manager role
AND still be on the SALES_EMAILS allowlist (see auth.require_sales and config). The
area is fail-closed — an empty allowlist denies everyone — and no normal buyer or
supplier token can reach any of it. Manager-only actions (reassignment, the
out-of-scope pool, leaderboard detail, CSV export) additionally require
`require_sales_manager`.

The marketplace core (models.py) is intentionally not imported beyond `models.User`
for owner identity; this router only ever touches the lead-system tables declared
in lead_models.py, keeping the two lifecycles separate.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

import config  # noqa: F401  (kept for parity / future allowlist checks)
import db
import lead_models as lm
import models
import security
from auth import require_sales, require_sales_manager
from schemas import (ActivityIn, AssignIn, LeadStatusIn, NextStepIn, TaskIn,
                     TeamCreateIn, TeamPasswordIn, TeamRoleIn, TeamStatusIn)

# The router-level gate: require a valid sales token for EVERY route below.
router = APIRouter(prefix="/api/sales", tags=["sales"], dependencies=[Depends(require_sales)])


# ---------------------------------------------------------------------------
# Vocabularies + display mapping (the stored keys stay stable; the UI shows these)
# ---------------------------------------------------------------------------
STATUS_LABELS = {
    "uncontacted": "Not contacted",
    "attempted_no_reply": "Potential",
    "connected": "In conversation",
    "qualified": "In conversation",
    "onboarding": "Onboarding",
    "onboarded": "Onboarded",
    "not_interested": "Declined",
    "nurture": "On hold",
    "incorrect": "Dead",
}
# Order the funnel tiles / stepper render in. Every stored status appears once.
FUNNEL_ORDER = [
    "uncontacted", "attempted_no_reply", "connected", "qualified",
    "onboarding", "onboarded", "not_interested", "nurture", "incorrect",
]
# "In conversation" collapses two stored stages for display; the stepper uses this.
STEPPER_STAGES = [
    ("uncontacted", "Not contacted"),
    ("attempted_no_reply", "Potential"),
    ("connected", "In conversation"),
    ("onboarding", "Onboarding"),
    ("onboarded", "Onboarded"),
]
DEAD_END_STATUSES = ("not_interested", "incorrect", "nurture")
OUTBOUND_KINDS = ("call", "whatsapp", "email", "voicemail")


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _parse_dt(s: str | None) -> datetime | None:
    if not s or not str(s).strip():
        return None
    t = str(s).strip()
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(t)
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _owner_email(lead: lm.Lead) -> str:
    return lead.owner.email if lead.owner else ""


def _reachable(company: lm.Company | None) -> bool:
    if not company:
        return False
    return any((c.phone_primary or c.email or c.whatsapp) for c in company.contacts)


def _company_out(company: lm.Company | None) -> dict:
    if company is None:
        return {}
    return {
        "id": company.id,
        "name": company.name,
        "legal_name": company.legal_name,
        "website": company.website,
        "gmb_link": company.gmb_link,
        "linkedin_url": company.linkedin_url,
        "hub_city": company.hub_city,
        "country": company.country,
        "address": company.address,
        "what_they_do": company.what_they_do,
        "size_band": company.size_band,
        "cin": company.cin,
        "gst": company.gst,
        "category_primary": company.category_primary,
        "category_tags": company.category_tags or [],
        "category_tier": company.category_tier,
        "adjacency": company.adjacency or [],
        "review_count": company.review_count,
        "review_rating": company.review_rating,
        "source_system": company.source_system,
        "source_note": company.source_note,
    }


def _contact_out(c: lm.Contact) -> dict:
    return {
        "id": c.id,
        "full_name": c.full_name,
        "designation": c.designation,
        "decision_maker": bool(c.decision_maker),
        "email": c.email,
        "phone_primary": c.phone_primary,
        "phone_secondary": c.phone_secondary,
        "whatsapp": c.whatsapp,
        "preferred_channel": c.preferred_channel,
        "is_primary": bool(c.is_primary),
        "do_not_call": bool(c.do_not_call),
    }


def _activity_out(a: lm.LeadActivity) -> dict:
    return {
        "id": a.id,
        "kind": a.kind,
        "direction": a.direction,
        "outcome": a.outcome,
        "summary": a.summary,
        "pain_point": a.pain_point,
        "objection": a.objection,
        "competitor": a.competitor,
        "duration_seconds": a.duration_seconds,
        "contact_id": a.contact_id,
        "by_email": a.created_by_email,
        "created_at": _iso(a.created_at),
    }


def _task_out(t: lm.LeadTask) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "due_at": _iso(t.due_at),
        "status": t.status,
        "overdue": bool(t.due_at and t.status == "open"
                        and (t.due_at if t.due_at.tzinfo else t.due_at.replace(tzinfo=timezone.utc))
                        < datetime.now(timezone.utc)),
        "completed_at": _iso(t.completed_at),
    }


def _history_out(h: lm.LeadStatusHistory) -> dict:
    return {
        "id": h.id,
        "from_status": h.from_status,
        "to_status": h.to_status,
        "from_label": STATUS_LABELS.get(h.from_status, h.from_status),
        "to_label": STATUS_LABELS.get(h.to_status, h.to_status),
        "note": h.note,
        "by_email": h.changed_by_email,
        "changed_at": _iso(h.changed_at),
    }


def _lead_row(session, lead: lm.Lead) -> dict:
    co = lead.company
    return {
        "id": lead.id,
        "track": lead.track,
        "status": lead.status,
        "status_label": STATUS_LABELS.get(lead.status, lead.status),
        "company_id": lead.company_id,
        "company": co.name if co else "",
        "hub_city": co.hub_city if co else "",
        "category_label": co.category_primary if co else "",
        "size_band": co.size_band if co else "",
        "priority_rank": lead.priority_rank,
        "priority_score": lead.priority_score,
        "owner_email": _owner_email(lead),
        "next_action_at": _iso(lead.next_action_at),
        "next_action_note": lead.next_action_note,
        "followup_count": lead.followup_count,
        "last_contacted_at": _iso(lead.last_contacted_at),
        "reachable": _reachable(co),
        "excluded_from_sales": bool(lead.excluded_from_sales),
        "exclusion_reason": lead.exclusion_reason,
        "source": lead.source,
    }


def _active_filters(query, *, include_excluded: bool):
    if not include_excluded:
        query = query.filter(lm.Lead.excluded_from_sales.is_(False))
    return query


# ---------------------------------------------------------------------------
# GET /api/sales/meta — controlled vocabularies for the UI (statuses, kinds, tracks)
# ---------------------------------------------------------------------------
@router.get("/meta")
def sales_meta():
    return {
        "statuses": [{"key": s, "label": STATUS_LABELS.get(s, s)} for s in lm.STATUSES],
        "funnel_order": FUNNEL_ORDER,
        "stepper": [{"key": k, "label": v} for k, v in STEPPER_STAGES],
        "tracks": list(lm.TRACKS),
        "activity_kinds": list(lm.ACTIVITY_KINDS),
        "activity_outcomes": list(lm.ACTIVITY_OUTCOMES),
        "views": ["mine", "unassigned", "followups", "all", "excluded"],
    }


# ---------------------------------------------------------------------------
# GET /api/sales/summary — dashboard tiles + funnel (rep view) / leaderboard (mgr)
# ---------------------------------------------------------------------------
def _status_counts(session, owner_id: int | None = None) -> dict[str, int]:
    q = select(lm.Lead.status, func.count()).group_by(lm.Lead.status)
    if owner_id is not None:
        q = q.where(lm.Lead.owner_id == owner_id)
    return {s: (n or 0) for s, n in session.execute(q).all()}


@router.get("/summary")
def sales_summary(
    session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales),
):
    now = datetime.now(timezone.utc)
    active = lm.Lead.excluded_from_sales.is_(False)

    def count(*where):
        q = select(func.count()).select_from(lm.Lead).where(*where)
        return session.scalar(q) or 0

    funnel = _status_counts(session)

    # workload tiles, DERIVED from activities/tasks (never summed with the funnel)
    contacted = count(active, lm.Lead.last_contacted_at.is_not(None))
    unassigned = count(active, lm.Lead.owner_id.is_(None))
    mine_total = count(active, lm.Lead.owner_id == user.id)
    followups_pending = count(
        active, lm.Lead.next_action_at.is_not(None), lm.Lead.next_action_at <= now)
    callable_now = count(active, lm.Lead.company_id.in_(
        select(lm.Company.id).join(lm.Contact).where(
            (lm.Contact.phone_primary != "") | (lm.Contact.email != "")
            | (lm.Contact.whatsapp != "")).distinct()))

    out = {
        "funnel": [{"key": s, "label": STATUS_LABELS.get(s, s), "count": funnel.get(s, 0)}
                   for s in FUNNEL_ORDER],
        "tiles": {
            "uncontacted": funnel.get("uncontacted", 0),
            "contacted": contacted,
            "followups_pending": followups_pending,
            "unassigned": unassigned,
            "mine": mine_total,
            "callable_now": callable_now,
            "onboarded": funnel.get("onboarded", 0),
            "excluded": count(lm.Lead.excluded_from_sales.is_(True)),
        },
    }

    if (user.role or "").strip().lower() == "sales_manager":
        rows = session.execute(
            select(lm.Lead.owner_id, lm.Lead.status, func.count())
            .where(lm.Lead.excluded_from_sales.is_(False))
            .group_by(lm.Lead.owner_id, lm.Lead.status)).all()
        emails = {u.id: u.email for u in session.query(models.User).all()}
        by_owner: dict[int | None, dict] = {}
        for oid, status, n in rows:
            d = by_owner.setdefault(oid, {"owner_email": emails.get(oid, "") or "(unassigned)",
                                          "total": 0, "contacted": 0, "in_conversation": 0,
                                          "onboarded": 0})
            d["total"] += n
            if status in ("connected", "qualified", "onboarding"):
                d["in_conversation"] += n
            elif status == "onboarded":
                d["onboarded"] += n
        # contacted (has been dialled) is tracked per-owner via last_contacted_at
        for oid in by_owner:
            q = select(func.count()).select_from(lm.Lead).where(
                lm.Lead.excluded_from_sales.is_(False), lm.Lead.last_contacted_at.is_not(None))
            q = q.where(lm.Lead.owner_id == oid) if oid is not None else q.where(lm.Lead.owner_id.is_(None))
            by_owner[oid]["contacted"] = session.scalar(q) or 0
        board = sorted(by_owner.values(), key=lambda x: (-x["onboarded"], -x["in_conversation"]))
        out["leaderboard"] = board

    return out


# ---------------------------------------------------------------------------
# GET /api/sales/leads — the queue, with views + filters + paging
# ---------------------------------------------------------------------------
@router.get("/leads")
def list_leads(
    view: str = Query("mine", pattern="^(mine|unassigned|followups|all|excluded)$"),
    status: str | None = Query(None),
    track: str | None = Query(None),
    category: str | None = Query(None),
    hub_city: str | None = Query(None),
    owner_email: str | None = Query(None),
    q: str | None = Query(None),
    sort: str = Query("priority", pattern="^(priority|next_action|company|status|recent)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales),
):
    is_manager = (user.role or "").strip().lower() == "sales_manager"
    query = session.query(lm.Lead)

    # --- view scoping ---
    if view == "mine":
        query = query.filter(lm.Lead.owner_id == user.id, lm.Lead.excluded_from_sales.is_(False))
    elif view == "unassigned":
        query = query.filter(lm.Lead.owner_id.is_(None), lm.Lead.excluded_from_sales.is_(False))
    elif view == "followups":
        now = datetime.now(timezone.utc)
        query = query.filter(
            lm.Lead.excluded_from_sales.is_(False),
            or_(lm.Lead.next_action_at.is_not(None) & (lm.Lead.next_action_at <= now),
                lm.Lead.id.in_(select(lm.LeadTask.lead_id).where(
                    lm.LeadTask.status == "open", lm.LeadTask.due_at.is_not(None),
                    lm.LeadTask.due_at <= now))))
    elif view == "all":
        query = query.filter(lm.Lead.excluded_from_sales.is_(False))
        if not is_manager:
            query = query.filter(lm.Lead.owner_id == user.id)  # reps: "all" == their whole book
    elif view == "excluded":
        if not is_manager:
            raise HTTPException(403, "Only a manager can view the out-of-scope pool")
        query = query.filter(lm.Lead.excluded_from_sales.is_(True))

    # --- filters ---
    if status:
        query = query.filter(lm.Lead.status == status)
    if track:
        query = query.filter(lm.Lead.track == track)
    # Company-scoped filters go through a subquery rather than a join, so several
    # of them at once never alias the same table twice.
    if category:
        query = query.filter(lm.Lead.company_id.in_(
            select(lm.Company.id).where(lm.Company.category_primary == category)))
    if hub_city:
        query = query.filter(lm.Lead.company_id.in_(
            select(lm.Company.id).where(func.lower(lm.Company.hub_city) == hub_city.lower())))
    if owner_email and is_manager:
        ouid = session.scalar(select(models.User.id).where(models.User.email == owner_email.lower()))
        query = query.filter(lm.Lead.owner_id == ouid)
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(lm.Lead.company_id.in_(
            select(lm.Company.id).where(or_(func.lower(lm.Company.name).like(like),
                                            func.lower(lm.Company.hub_city).like(like)))))

    total = query.count()
    if sort == "next_action":
        query = query.order_by(lm.Lead.next_action_at.asc().nullslast(), lm.Lead.id.asc())
    elif sort == "company":
        query = query.order_by(lm.Lead.id.asc())
    elif sort == "status":
        query = query.order_by(lm.Lead.status.asc(), lm.Lead.id.asc())
    elif sort == "recent":
        query = query.order_by(lm.Lead.updated_at.desc(), lm.Lead.id.desc())
    else:  # priority
        query = query.order_by(lm.Lead.priority_rank.asc().nullslast(),
                               lm.Lead.next_action_at.asc().nullslast(), lm.Lead.id.asc())

    rows = query.offset(offset).limit(limit).all()
    return {"total": total, "offset": offset, "limit": limit,
            "items": [_lead_row(session, l) for l in rows]}


# ---------------------------------------------------------------------------
# GET /api/sales/leads/{id} — full record: company, contacts, timeline, tasks, script
# ---------------------------------------------------------------------------
def _script_out(session, category_key: str, track: str) -> dict | None:
    tmpl = session.execute(
        select(lm.LeadScriptTemplate)
        .where(lm.LeadScriptTemplate.track == track, lm.LeadScriptTemplate.is_active.is_(True))
        .where(or_(lm.LeadScriptTemplate.category_key == category_key,
                   lm.LeadScriptTemplate.category_key.is_(None)))
        .order_by(lm.LeadScriptTemplate.category_key.desc().nullslast())
    ).scalars().first()
    if not tmpl:
        return None
    return {
        "name": tmpl.name, "version": tmpl.version,
        "opener": tmpl.opener or [], "pitch": tmpl.pitch,
        "discovery_questions": tmpl.discovery_questions or [],
        "qualification_checklist": tmpl.qualification_checklist or [],
        "objection_handling": tmpl.objection_handling or {}, "cta": tmpl.cta,
        "do_not_say": tmpl.do_not_say,
    }


@router.get("/leads/{lead_id}")
def lead_detail(
    lead_id: int, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales),
):
    lead = session.get(lm.Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    is_manager = (user.role or "").strip().lower() == "sales_manager"
    if lead.excluded_from_sales and not is_manager:
        raise HTTPException(404, "Lead not found")  # don't leak excluded rows to reps
    activities = session.query(lm.LeadActivity).filter(
        lm.LeadActivity.lead_id == lead_id).order_by(lm.LeadActivity.created_at.desc()).all()
    tasks = session.query(lm.LeadTask).filter(lm.LeadTask.lead_id == lead_id).order_by(
        lm.LeadTask.due_at.asc().nullslast()).all()
    history = session.query(lm.LeadStatusHistory).filter(
        lm.LeadStatusHistory.lead_id == lead_id).order_by(
        lm.LeadStatusHistory.changed_at.desc()).limit(50).all()
    co = lead.company
    out = _lead_row(session, lead)
    out.update({
        "company": _company_out(co),
        "contacts": [_contact_out(c) for c in (co.contacts if co else [])],
        "activities": [_activity_out(a) for a in activities],
        "tasks": [_task_out(t) for t in tasks],
        "history": [_history_out(h) for h in history],
        "script": _script_out(session, co.category_primary if co else "", lead.track),
        "qualified_at": _iso(lead.qualified_at),
        "disqualify_reason": lead.disqualify_reason,
        "nurture_until": _iso(lead.nurture_until),
        "source_note": lead.source_note,
    })
    return out


# ---------------------------------------------------------------------------
# Status transition helper (writes the audit row) — used by /status and /activity
# ---------------------------------------------------------------------------
def _apply_status(session, lead: lm.Lead, to_status: str, note: str, actor: models.User) -> None:
    if to_status not in lm.STATUSES:
        raise HTTPException(422, f"unknown status '{to_status}'")
    from_status = lead.status
    if to_status == from_status:
        return
    lead.status = to_status
    lead.status_changed_at = datetime.now(timezone.utc)
    if to_status == "qualified" and lead.qualified_at is None:
        lead.qualified_at = lead.status_changed_at
        lead.qualified_by = actor.id
    if to_status == "not_interested":
        lead.disqualify_reason = note or lead.disqualify_reason
    session.add(lm.LeadStatusHistory(
        lead_id=lead.id, from_status=from_status, to_status=to_status,
        changed_by=actor.id, changed_by_email=actor.email, note=note or ""))


@router.post("/leads/{lead_id}/status")
def update_status(
    lead_id: int, payload: LeadStatusIn, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales),
):
    lead = session.get(lm.Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    _apply_status(session, lead, payload.status, payload.note, user)
    session.commit()
    return {"ok": True, "id": lead.id, "status": lead.status,
            "status_label": STATUS_LABELS.get(lead.status, lead.status)}


# ---------------------------------------------------------------------------
# POST /api/sales/leads/{id}/activity — log a touchpoint (append-only)
# ---------------------------------------------------------------------------
@router.post("/leads/{lead_id}/activity", status_code=201)
def add_activity(
    lead_id: int, payload: ActivityIn, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales),
):
    lead = session.get(lm.Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    kind = payload.kind if payload.kind in lm.ACTIVITY_KINDS else "note"
    if payload.outcome and payload.outcome not in lm.ACTIVITY_OUTCOMES:
        raise HTTPException(422, f"unknown outcome '{payload.outcome}'")

    act = lm.LeadActivity(
        lead_id=lead.id, contact_id=payload.contact_id, kind=kind,
        direction=payload.direction if payload.direction in ("outbound", "inbound") else "outbound",
        outcome=payload.outcome, duration_seconds=payload.duration_seconds,
        summary=payload.summary, pain_point=payload.pain_point,
        objection=payload.objection, competitor=payload.competitor,
        next_action_at=_parse_dt(payload.next_action_at),
        created_by=user.id, created_by_email=user.email,
    )
    session.add(act)

    # A logged touchpoint is, by definition, contact — bump the workload counters.
    now = datetime.now(timezone.utc)
    if act.direction == "outbound" and kind in OUTBOUND_KINDS:
        lead.last_contacted_at = now
        lead.followup_count = (lead.followup_count or 0) + 1
    # A follow-up captured on the activity writes through to the lead pointer so
    # the followups tile needs no join.
    if act.next_action_at is not None:
        lead.next_action_at = act.next_action_at
        if payload.next_action_note:
            lead.next_action_note = payload.next_action_note
    if payload.set_status:
        _apply_status(session, lead, payload.set_status, payload.summary[:1000], user)
    session.commit()
    return {"ok": True, "activity_id": act.id, "lead_id": lead.id,
            "status": lead.status, "next_action_at": _iso(lead.next_action_at)}


# ---------------------------------------------------------------------------
# Tasks (follow-ups)
# ---------------------------------------------------------------------------
@router.post("/leads/{lead_id}/task", status_code=201)
def add_task(
    lead_id: int, payload: TaskIn, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales),
):
    lead = session.get(lm.Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    assigned_id = user.id
    if payload.assigned_to_email and payload.assigned_to_email.lower() != user.email.lower():
        if (user.role or "").strip().lower() != "sales_manager":
            raise HTTPException(403, "Only a manager can route a task to another rep")
        assigned_id = session.scalar(
            select(models.User.id).where(models.User.email == payload.assigned_to_email.lower())) or user.id
    task = lm.LeadTask(
        lead_id=lead.id, title=payload.title, due_at=_parse_dt(payload.due_at),
        status="open", assigned_to=assigned_id, created_by=user.id)
    session.add(task)
    # a due date also becomes the lead's next-action pointer unless one is later
    if task.due_at and (lead.next_action_at is None or task.due_at < lead.next_action_at):
        lead.next_action_at = task.due_at
    session.commit()
    return {"ok": True, "task": _task_out(task)}


@router.post("/tasks/{task_id}/complete")
def complete_task(
    task_id: int, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales),
):
    task = session.get(lm.LeadTask, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    task.status = "done"
    task.completed_at = datetime.now(timezone.utc)
    session.commit()
    return {"ok": True, "task": _task_out(task)}


# ---------------------------------------------------------------------------
# Next-step pointer
# ---------------------------------------------------------------------------
@router.post("/leads/{lead_id}/next-step")
def set_next_step(
    lead_id: int, payload: NextStepIn, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales),
):
    lead = session.get(lm.Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    lead.next_action_at = _parse_dt(payload.next_action_at)
    lead.next_action_note = payload.next_action_note
    session.commit()
    return {"ok": True, "next_action_at": _iso(lead.next_action_at),
            "next_action_note": lead.next_action_note}


# ---------------------------------------------------------------------------
# Claim / assign / unassign
# ---------------------------------------------------------------------------
@router.post("/leads/assign")
def assign_leads(
    payload: AssignIn, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales),
):
    if not payload.lead_ids:
        raise HTTPException(422, "lead_ids required")
    is_manager = (user.role or "").strip().lower() == "sales_manager"
    # owner_email=None => claim to self; owner_email="" => unassign to the pool
    # (manager only); any other value => assign to that rep (manager only).
    sentinel = payload.owner_email
    if sentinel is None:
        target_id = user.id
        owner_email = ""
    else:
        owner_email = sentinel.strip().lower()
        if owner_email == "":
            if not is_manager:
                raise HTTPException(403, "Only a manager can unassign leads")
            target_id = None
        else:
            if not is_manager and owner_email != user.email.lower():
                raise HTTPException(403, "Only a manager can assign leads to someone else")
            target_id = session.scalar(select(models.User.id).where(models.User.email == owner_email))
            if not target_id:
                raise HTTPException(404, f"No user with email {owner_email}")

    changed = 0
    for lid in payload.lead_ids:
        lead = session.get(lm.Lead, lid)
        if lead is None:
            continue
        lead.owner_id = target_id
        label = owner_email or ("self" if target_id == user.id else "pool")
        session.add(lm.LeadStatusHistory(
            lead_id=lead.id, from_status=lead.status, to_status=lead.status,
            changed_by=user.id, changed_by_email=user.email, note=f"assigned -> {label}"))
        changed += 1
    session.commit()
    return {"ok": True, "assigned": changed, "owner_id": target_id}


# ---------------------------------------------------------------------------
# CSV export (manager only) — the current filtered queue, no row limits
# ---------------------------------------------------------------------------
def _csv_escape(v) -> str:
    s = "" if v is None else str(v)
    if any(ch in s for ch in (",", '"', "\n")):
        s = '"' + s.replace('"', '""') + '"'
    return s


@router.get("/export")
def export_csv(
    status: str | None = Query(None),
    track: str | None = Query(None),
    category: str | None = Query(None),
    view: str = Query("all", pattern="^(mine|unassigned|all|excluded)$"),
    session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales_manager),
):
    query = session.query(lm.Lead)
    if view == "excluded":
        query = query.filter(lm.Lead.excluded_from_sales.is_(True))
    else:
        query = query.filter(lm.Lead.excluded_from_sales.is_(False))
        if view == "mine":
            query = query.filter(lm.Lead.owner_id == user.id)
        elif view == "unassigned":
            query = query.filter(lm.Lead.owner_id.is_(None))
    if status:
        query = query.filter(lm.Lead.status == status)
    if track:
        query = query.filter(lm.Lead.track == track)
    if category:
        query = query.filter(lm.Lead.company_id.in_(
            select(lm.Company.id).where(lm.Company.category_primary == category)))
    leads = query.order_by(lm.Lead.id.asc()).all()

    header = ["lead_id", "company", "hub_city", "category", "track", "status",
              "owner_email", "priority_rank", "followup_count", "last_contacted_at",
              "next_action_at", "next_action_note", "phone", "email", "website",
              "source"]
    lines = [",".join(header)]
    for lead in leads:
        co = lead.company
        con = next((c for c in (co.contacts if co else [])
                    if c.phone_primary or c.email), (co.contacts[0] if co and co.contacts else None))
        row = [lead.id, co.name if co else "", co.hub_city if co else "",
               co.category_primary if co else "", lead.track,
               STATUS_LABELS.get(lead.status, lead.status), _owner_email(lead),
               lead.priority_rank, lead.followup_count, _iso(lead.last_contacted_at),
               _iso(lead.next_action_at), lead.next_action_note,
               con.phone_primary if con else "", con.email if con else "",
               co.website if co else "", lead.source]
        lines.append(",".join(_csv_escape(x) for x in row))
    csv_body = "\n".join(lines)
    fname = f"rfqclub_internal_{datetime.now(timezone.utc):%Y%m%d_%H%M}.csv"
    return Response(content=csv_body.encode("utf-8-sig"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ---------------------------------------------------------------------------
# Team (manager-only) — the inside-sales user directory. This is the ONLY way
# accounts gain sales/sales_manager access now: the public /role endpoint refuses
# those roles, so whoever the manager creates here is exactly who can get in.
# Every create/reset sets must_change_password (except a manager resetting their
# own), so the person picks their own secret on first sign-in.
# ---------------------------------------------------------------------------
def _team_out(u: models.User) -> dict:
    return {
        "id": u.id, "email": u.email, "name": u.name or "",
        "role": (u.role or "").strip().lower(),
        "is_active": bool(getattr(u, "is_active", True)),
        "must_change_password": bool(getattr(u, "must_change_password", False)),
        "last_login": _iso(u.last_login), "created_at": _iso(u.created_at),
    }


def _password_ok(pw: str) -> bool:
    return bool(pw) and len(pw) >= 8 and any(c.isdigit() for c in pw) and any(c.isalpha() for c in pw)


def _active_manager_count(session: Session) -> int:
    return session.scalar(
        select(func.count()).select_from(models.User).where(
            models.User.role == "sales_manager", models.User.is_active.is_(True))) or 0


def _get_sales_user(session: Session, email: str) -> models.User:
    u = session.query(models.User).filter(models.User.email == (email or "").strip().lower()).first()
    if not u:
        raise HTTPException(404, "No such user")
    if (u.role or "").strip().lower() not in ("sales", "sales_manager"):
        raise HTTPException(403, "Only inside-sales accounts can be managed here")
    return u


@router.get("/team")
def list_team(session: Session = Depends(db.get_db),
              user: models.User = Depends(require_sales_manager)):
    rows = session.query(models.User).filter(
        models.User.role.in_(("sales", "sales_manager"))).order_by(models.User.created_at.desc()).all()
    return {"count": len(rows), "items": [_team_out(u) for u in rows]}


@router.post("/team/user", status_code=201)
def create_team_user(
    payload: TeamCreateIn, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales_manager),
):
    email = (payload.email or "").strip().lower()
    if not email or "@" not in email or len(email) > 254:
        raise HTTPException(400, "Enter a valid email address")
    role = (payload.role or "sales").strip().lower()
    if role not in ("sales", "sales_manager"):
        raise HTTPException(422, "role must be 'sales' or 'sales_manager'")
    if not _password_ok(payload.password):
        raise HTTPException(422, "Password must be at least 8 characters and include letters and numbers")
    if session.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(409, "An account with this email already exists")
    u = models.User(
        email=email, name=(payload.name or "").strip(), role=role,
        password_hash=security.hash_password(payload.password),
        must_change_password=True, is_active=True)
    session.add(u)
    session.commit()
    return {"ok": True, "user": _team_out(u)}


@router.post("/team/password")
def reset_team_password(
    payload: TeamPasswordIn, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales_manager),
):
    u = _get_sales_user(session, payload.email)
    if not _password_ok(payload.password):
        raise HTTPException(422, "Password must be at least 8 characters and include letters and numbers")
    u.password_hash = security.hash_password(payload.password)
    is_self = u.email == (user.email or "").strip().lower()
    # A manager resetting someone else's password hands them a temp secret they
    # must rotate; resetting your own keeps you signed in without a forced change.
    u.must_change_password = not is_self
    session.commit()
    return {"ok": True, "email": u.email, "must_change_password": u.must_change_password}


@router.post("/team/status")
def set_team_status(
    payload: TeamStatusIn, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales_manager),
):
    u = _get_sales_user(session, payload.email)
    is_self = u.email == (user.email or "").strip().lower()
    if not payload.is_active:
        if is_self:
            raise HTTPException(400, "You cannot deactivate your own account")
        if (u.role or "").strip().lower() == "sales_manager" and _active_manager_count(session) <= 1:
            raise HTTPException(400, "Cannot deactivate the last active manager")
        # release their whole book back to the pool so leads aren't stranded
        session.query(lm.Lead).filter(lm.Lead.owner_id == u.id).update({"owner_id": None})
    u.is_active = payload.is_active
    session.commit()
    return {"ok": True, "user": _team_out(u)}


@router.post("/team/role")
def set_team_role(
    payload: TeamRoleIn, session: Session = Depends(db.get_db),
    user: models.User = Depends(require_sales_manager),
):
    u = _get_sales_user(session, payload.email)
    role = (payload.role or "").strip().lower()
    if role not in ("sales", "sales_manager"):
        raise HTTPException(422, "role must be 'sales' or 'sales_manager'")
    if (u.role or "").strip().lower() == "sales_manager" and role != "sales_manager" \
            and _active_manager_count(session) <= 1:
        raise HTTPException(400, "Cannot demote the last active manager")
    u.role = role
    session.commit()
    return {"ok": True, "user": _team_out(u)}
