"""RFQClub FastAPI app.

Public (supplier/board) endpoints serve published RFQs and accept bids.
Buyer compare endpoint is blinded: it returns bidder codes, landed cost, lead,
terms, capability tags and hub city + distance, but never the supplier's name
until the RFQ is awarded (award flips revealed=True).
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

import config
import db
import bootstrap
import models
import sectors
import util
import profile_data
from auth import router as auth_router, optional_user, require_user
from schemas import BidCreate, RfqCreate, AwardIn

app = FastAPI(title="RFQClub API", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=config.CORS_ORIGIN_REGEX or None,
    allow_methods=["*"], allow_headers=["*"],
)
app.include_router(auth_router)


@app.on_event("startup")
def _startup():
    db.init_db()
    # Fresh hosted DB (Neon) boots empty — rebuild the demo board once.
    bootstrap.ensure_seeded()


# ---------- serialization ----------
def _sector(key: str) -> dict:
    c = sectors.colors(key)
    return {"key": key, "label": c["label"], "base": c["base"], "soft": c["soft"]}


def _budget(rfq: models.Rfq) -> dict:
    return {
        "status": rfq.budget_status or "Open",
        "currency": rfq.currency or "₹",
        "low": rfq.budget_low,
        "high": rfq.budget_high,
        "low_display": util.format_inr(rfq.budget_low, rfq.currency),
        "high_display": util.format_inr(rfq.budget_high, rfq.currency) if rfq.budget_high else None,
        "range_display": (
            f"{util.format_inr(rfq.budget_low, rfq.currency)}"
            if rfq.budget_low is not None and rfq.budget_high in (None, rfq.budget_low)
            else f"{util.format_inr(rfq.budget_low, rfq.currency)}–{util.format_inr(rfq.budget_high, rfq.currency)}"
        ) if rfq.budget_low is not None else "Open budget",
        "per_unit": rfq.unit or "pc",
    }


def _posted_days(created_at: datetime | None) -> int | None:
    if not created_at:
        return None
    now = datetime.now(timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return max(0, (now - created_at).days)


def _saved_ids(session, user: models.User | None) -> set[int] | None:
    """Per-user watchlist ids; None => fall back to the legacy global flag."""
    if user is None:
        return None
    return {s.rfq_id for s in session.query(models.SaveItem).filter(models.SaveItem.user_id == user.id)}


def _card(rfq: models.Rfq, saved_ids: set[int] | None = None) -> dict:
    return {
        "id": rfq.id,
        "code": rfq.code,
        "title": rfq.title,
        "sector": _sector(rfq.sector_key),
        "material": rfq.material,
        "qty": rfq.qty,
        "unit": rfq.unit,
        "budget": _budget(rfq),
        "est_total": rfq.est_total,
        "est_total_display": util.format_inr(rfq.est_total, rfq.currency),
        "closes_at": rfq.closes_at.isoformat() if rfq.closes_at else None,
        "closes_in_days": rfq.closes_in_days,
        "urgency": util.urgency(rfq.closes_in_days),
        "is_open": util.is_open(rfq.closes_at),
        "bid_count": rfq.bid_count or 0,
        "routing_cap": rfq.routing_cap,
        "status": rfq.status,
        "tags": rfq.tags or [],
        "hub_city": rfq.hub_city or "",
        "saved": (rfq.id in saved_ids) if saved_ids is not None else bool(rfq.saved),
        "posted_days_ago": _posted_days(rfq.created_at),
    }


def _detail(rfq: models.Rfq, saved_ids: set[int] | None = None) -> dict:
    d = _card(rfq, saved_ids)
    d.update({
        "process": rfq.process,
        "description": rfq.description,
        "attachments": rfq.attachments or [],
        "clarify": rfq.clarify or [],
        "spec_notes": rfq.spec_notes,
        "buyer_visible": False,
        "buyer_note": "Buyer contact visible to verified members",
    })
    return d


def _blinded_bid(bid: models.Bid, rfq_qty: float | None) -> dict:
    sup = bid.supplier
    rupees = util.cents_to_rupees(bid.tlc_cents)
    per_pc = round(rupees / rfq_qty, 2) if rfq_qty else None
    return {
        "code": bid.bidder_code,
        "bid_id": bid.id,
        "unit_price": bid.unit_price,
        "unit_price_display": util.format_inr(bid.unit_price, "₹"),
        "tooling": bid.tooling,
        "freight": bid.freight,
        "gst_included": bid.gst_included,
        "lead_weeks": bid.lead_weeks,
        "payment_terms": bid.payment_terms,
        "validity_days": bid.validity_days,
        "exception_flag": bid.exception_flag,
        "exception_note": bid.exception_note,
        "tlc_cents": bid.tlc_cents,
        "tlc_rupees": rupees,
        "tlc_display": util.format_inr(rupees, "₹"),
        "per_unit_landed_display": util.format_inr(per_pc, "₹") if per_pc else None,
        # location + distance are allowed; supplier identity is not
        "hub_city": sup.hub_city if sup else "",
        "distance_km": sup.distance_km if sup else None,
        "capability_tags": (sup.capability_tags if sup else []) or [],
        "certifications": (sup.certifications if sup else []) or [],
        "verified": bool(sup.kyc_verified) if sup else False,
    }


def _award_of(db: Session, rfq_id: int):
    return db.query(models.Award).filter(models.Award.rfq_id == rfq_id).first()


# ---------- read endpoints ----------
@app.get("/api/health")
def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}


@app.post("/api/admin/seed")
def admin_seed(key: str = Query("")):
    """Idempotent seed trigger for deploy smoke checks — runs the same
    empty-table bootstrap as startup. Guarded by the AUTH_SECRET admin key."""
    if not key or key != config.AUTH_SECRET:
        raise HTTPException(status_code=403, detail="bad admin key")
    return {"ok": True, "seeded": bootstrap.ensure_seeded()}


@app.get("/api/sectors")
def get_sectors():
    return sectors.SECTORS


@app.get("/api/profile")
def get_profile():
    """Representative supplier profile (single demo record, pre-auth)."""
    return profile_data.PROFILE


@app.get("/api/rfqs")
def list_rfqs(
    sector: str | None = Query(None),
    q: str | None = Query(None),
    sort: str = Query("deadline", pattern="^(deadline|value|bidcount)$"),
    status: str = Query("published"),
    db: Session = Depends(db.get_db),
    user: models.User | None = Depends(optional_user),
):
    query = db.query(models.Rfq)
    if status:
        query = query.filter(models.Rfq.status == status)
    if sector:
        query = query.filter(models.Rfq.sector_key == sector)
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(func.lower(models.Rfq.title).like(like) | func.lower(models.Rfq.material).like(like))
    if sort == "value":
        query = query.order_by(models.Rfq.est_total.desc().nullslast())
    elif sort == "bidcount":
        query = query.order_by(models.Rfq.bid_count.desc())
    else:
        query = query.order_by(models.Rfq.closes_at.asc().nullslast())
    rows = query.all()
    counts = db.query(func.count(models.Rfq.id)).filter(models.Rfq.status == "published").scalar()
    total_demand = db.query(func.sum(models.Rfq.est_total)).filter(models.Rfq.status == "published").scalar() or 0
    sids = _saved_ids(db, user)
    return {
        "count": len(rows),
        "open_total": counts,
        "demand_total": total_demand,
        "demand_total_display": util.format_inr(total_demand, "₹"),
        "items": [_card(r, sids) for r in rows],
    }


@app.get("/api/rfqs/{rfq_id}")
def get_rfq(rfq_id: int, db: Session = Depends(db.get_db), user: models.User | None = Depends(optional_user)):
    rfq = db.get(models.Rfq, rfq_id)
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    return _detail(rfq, _saved_ids(db, user))


@app.get("/api/rfqs/{rfq_id}/bids")
def list_bids(rfq_id: int, db: Session = Depends(db.get_db)):
    """Blinded comparison for the buyer. Identity hidden until award."""
    rfq = db.get(models.Rfq, rfq_id)
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    award = _award_of(db, rfq_id)
    revealed = bool(award and award.revealed)
    bids = db.query(models.Bid).filter(models.Bid.rfq_id == rfq_id).order_by(models.Bid.tlc_cents.asc()).all()
    items = []
    for b in bids:
        row = _blinded_bid(b, rfq.qty)
        if revealed:  # reveal the winner only
            if award and award.bid_id == b.id and b.supplier:
                row["revealed_name"] = b.supplier.name
        items.append(row)
    # ribbons
    if items:
        lowest = min(items, key=lambda x: x["tlc_cents"])
        non_exc = [x for x in items if not x["exception_flag"]]
        best_value = min(non_exc, key=lambda x: x["tlc_cents"]) if non_exc else lowest
        leads = [x["lead_weeks"] for x in items if x["lead_weeks"] is not None]
        fastest = min(items, key=lambda x: (x["lead_weeks"] if x["lead_weeks"] is not None else 10_000)) if leads else None
        for x in items:
            x["ribbon"] = None
        for target, label in ((best_value, "best_value"), (lowest, "lowest_cost"), (fastest, "fastest")):
            if target is not None and not target["ribbon"]:
                if not (label == "lowest_cost" and lowest["exception_flag"]):
                    target["ribbon"] = label
        for x in items:
            if x["exception_flag"]:
                x["ribbon"] = "exception"
    return {
        "rfq": _card(rfq),
        "count": len(items),
        "cap": rfq.routing_cap,
        "locked": len(items) >= rfq.routing_cap,
        "revealed": revealed,
        "awarded_bid_id": award.bid_id if award else None,
        "bids": items,
    }


@app.get("/api/admin/rfqs/{rfq_id}/bids")
def admin_bids(rfq_id: int, db: Session = Depends(db.get_db)):
    """Unblinded list for the operator/concierge."""
    bids = db.query(models.Bid).filter(models.Bid.rfq_id == rfq_id).all()
    out = []
    for b in bids:
        s = b.supplier
        out.append({
            "bid_id": b.id, "bidder_code": b.bidder_code,
            "supplier_id": b.supplier_id, "supplier_name": s.name if s else "",
            "hub_city": s.hub_city if s else "", "unit_price": b.unit_price,
            "tooling": b.tooling, "freight": b.freight, "gst_included": b.gst_included,
            "tlc_cents": b.tlc_cents, "tlc_rupees": util.cents_to_rupees(b.tlc_cents),
            "lead_weeks": b.lead_weeks, "payment_terms": b.payment_terms,
            "exception_flag": b.exception_flag, "source": b.source,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        })
    return {"rfq_id": rfq_id, "count": len(out), "bids": out}


# ---------- write endpoints ----------
@app.post("/api/rfqs/{rfq_id}/save")
def toggle_save(rfq_id: int, db: Session = Depends(db.get_db), user: models.User | None = Depends(optional_user)):
    """Toggle the watchlist flag. Per-user SaveItem when signed in; legacy global flag otherwise."""
    rfq = db.get(models.Rfq, rfq_id)
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    if user is not None:
        item = db.query(models.SaveItem).filter(models.SaveItem.user_id == user.id, models.SaveItem.rfq_id == rfq_id).first()
        if item:
            db.delete(item)
            db.commit()
            return {"ok": True, "saved": False}
        db.add(models.SaveItem(user_id=user.id, rfq_id=rfq_id))
        db.commit()
        return {"ok": True, "saved": True}
    rfq.saved = not bool(rfq.saved)
    db.commit()
    return {"ok": True, "saved": rfq.saved}


@app.post("/api/rfqs/{rfq_id}/bid", status_code=201)
def create_bid(rfq_id: int, payload: BidCreate, db: Session = Depends(db.get_db), user: models.User | None = Depends(optional_user)):
    rfq = db.get(models.Rfq, rfq_id)
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    if not util.is_open(rfq.closes_at):
        raise HTTPException(410, "RFQ has closed")
    if rfq.status == "awarded" or _award_of(db, rfq_id):
        raise HTTPException(410, "This RFQ has been awarded — bidding is closed")
    existing = db.query(func.count(models.Bid.id)).filter(models.Bid.rfq_id == rfq_id).scalar()
    if existing >= rfq.routing_cap:
        raise HTTPException(409, f"Routing cap reached ({rfq.routing_cap} bids) — RFQ locked")

    supplier = None
    if payload.supplier_id:
        supplier = db.get(models.Supplier, payload.supplier_id)
    if supplier is None:
        supplier = models.Supplier(
            name=payload.supplier_name or "Unnamed shop",
            hub_city=payload.hub_city, distance_km=payload.distance_km,
            capability_tags=payload.capability_tags, kyc_verified=False,
        )
        db.add(supplier)
        db.flush()

    code = chr(ord("A") + existing)
    bid = models.Bid(
        rfq_id=rfq_id, supplier_id=supplier.id, bidder_code=code, user_id=user.id if user else None,
        unit_price=payload.unit_price, tooling=payload.tooling, freight=payload.freight,
        gst_included=payload.gst_included, lead_weeks=payload.lead_weeks,
        payment_terms=payload.payment_terms, validity_days=payload.validity_days,
        exception_flag=payload.exception_flag, exception_note=payload.exception_note,
        notes=payload.notes, source=payload.source,
    )
    bid.tlc_cents = bid.compute_tlc_cents(rfq.qty)
    db.add(bid)
    rfq.bid_count = existing + 1
    db.commit()
    return {"ok": True, "bid_id": bid.id, "bidder_code": code,
            "tlc_rupees": util.cents_to_rupees(bid.tlc_cents),
            "tlc_display": util.format_inr(util.cents_to_rupees(bid.tlc_cents), "₹")}


@app.post("/api/rfqs", status_code=201)
def create_rfq(payload: RfqCreate, db: Session = Depends(db.get_db), user: models.User | None = Depends(optional_user)):
    """Self-serve / concierge-created RFQ. Lands as a draft unless published."""
    now = datetime.now(timezone.utc)
    rfq = models.Rfq(
        title=payload.title, sector_key=payload.sector_key or sectors.classify(payload.process, payload.title, payload.material),
        process=payload.process, material=payload.material, qty=payload.qty, unit=payload.unit,
        budget_low=payload.budget_low, budget_high=payload.budget_high, currency=payload.currency,
        budget_status="Priced" if payload.budget_low is not None else "Open",
        est_total=(round(((payload.budget_low + (payload.budget_high or payload.budget_low)) / 2) * payload.qty, 2)
                   if (payload.qty and payload.budget_low is not None) else None),
        closes_in_days=payload.closes_in_days,
        closes_at=(now + timedelta(days=payload.closes_in_days)) if payload.closes_in_days is not None else None,
        description=payload.description, clarify=payload.clarify, routing_cap=payload.routing_cap,
        status="draft", user_id=user.id if user else None,
    )
    db.add(rfq)
    db.commit()
    return {"ok": True, "id": rfq.id, "code": rfq.code, "status": rfq.status}


@app.post("/api/rfqs/{rfq_id}/award")
def award(rfq_id: int, payload: AwardIn, db: Session = Depends(db.get_db)):
    rfq = db.get(models.Rfq, rfq_id)
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    bid = db.get(models.Bid, payload.bid_id)
    if not bid or bid.rfq_id != rfq_id:
        raise HTTPException(400, "bid does not belong to this rfq")
    aw = db.query(models.Award).filter(models.Award.rfq_id == rfq_id).first()
    if aw:
        aw.bid_id = bid.id
        aw.revealed = True
    else:
        db.add(models.Award(rfq_id=rfq_id, bid_id=bid.id, revealed=True))
    rfq.status = "awarded"
    db.commit()
    name = bid.supplier.name if bid.supplier else ""
    return {"ok": True, "rfq_id": rfq_id, "awarded_bid_id": bid.id, "revealed_name": name,
            "tlc_display": util.format_inr(util.cents_to_rupees(bid.tlc_cents), "₹")}


# ---------- signed-in user views ----------
@app.get("/api/auth/my/rfqs")
def my_rfqs(db: Session = Depends(db.get_db), user: models.User = Depends(require_user)):
    """RFQs this user posted (any status), most recent first."""
    rows = (
        db.query(models.Rfq).filter(models.Rfq.user_id == user.id)
        .order_by(models.Rfq.created_at.desc(), models.Rfq.id.desc()).all()
    )
    sids = _saved_ids(db, user)
    return {"count": len(rows), "items": [_card(r, sids) for r in rows]}


@app.get("/api/auth/my/bids")
def my_bids(db: Session = Depends(db.get_db), user: models.User = Depends(require_user)):
    """Bids this user submitted, with the blinded-comparison context back."""
    bids = (
        db.query(models.Bid).filter(models.Bid.user_id == user.id)
        .order_by(models.Bid.created_at.desc(), models.Bid.id.desc()).all()
    )
    out = []
    for b in bids:
        rfq = db.get(models.Rfq, b.rfq_id)
        aw = _award_of(db, b.rfq_id)
        out.append({
            "bid_id": b.id, "bidder_code": b.bidder_code,
            "rfq": _card(rfq) if rfq else None,
            "tlc_rupees": util.cents_to_rupees(b.tlc_cents),
            "tlc_display": util.format_inr(util.cents_to_rupees(b.tlc_cents), rfq.currency if rfq else "₹"),
            "unit_price": b.unit_price, "lead_weeks": b.lead_weeks,
            "status": "Won" if aw and aw.bid_id == b.id else ("Lost" if aw else ("Live" if rfq and util.is_open(rfq.closes_at) else "Closed")),
            "created_at": b.created_at.isoformat() if b.created_at else None,
        })
    return {"count": len(out), "items": out}
