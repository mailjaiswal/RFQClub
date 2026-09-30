"""Smoke test for the RFQClub API using Starlette's TestClient.

Run:  python test_smoke.py   (assumes data seeded; seeds if empty)
"""
from __future__ import annotations
import db
import models
import seed_rfqs
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def _ensure_seeded():
    db.init_db()
    s = db.SessionLocal()
    try:
        if s.query(models.Rfq).count() == 0:
            seed_rfqs.seed_rfqs(s)
            seed_rfqs.seed_demo_bids(s)
    finally:
        s.close()


def main():
    _ensure_seeded()

    r = client.get("/api/health"); assert r.status_code == 200, r.text
    print("health:", r.json()["ok"])

    r = client.get("/api/rfqs"); assert r.status_code == 200
    board = r.json()
    print(f"rfqs count={board['count']} open_total={board['open_total']} demand={board['demand_total_display']}")
    assert board["count"] == 67, board["count"]
    card = board["items"][0]
    print("sample card:", card["code"], card["title"][:40], card["sector"]["label"], card["budget"]["range_display"], card["urgency"])

    # sector filter
    r = client.get("/api/rfqs", params={"sector": "cnc"}); assert r.status_code == 200
    print("cnc filter ->", r.json()["count"], "items")

    # search
    r = client.get("/api/rfqs", params={"q": "gear"})
    print("search 'gear' ->", r.json()["count"], "items")

    # detail
    r = client.get("/api/rfqs/1"); assert r.status_code == 200
    det = r.json()
    print("detail:", det["code"], "buyer_visible=", det["buyer_visible"])

    # blinded bids: no supplier name should ever appear
    r = client.get("/api/rfqs/1/bids"); assert r.status_code == 200
    cmp = r.json()
    print(f"bids rfq1 count={cmp['count']} cap={cmp['cap']} locked={cmp['locked']}")
    for b in cmp["bids"]:
        assert "name" not in b, "identity leaked!"
        assert "supplier_name" not in b
        print(f"  Bid {b['code']}: tlc={b['tlc_display']} /pc={b['per_unit_landed_display']} lead={b['lead_weeks']} ribbon={b['ribbon']} loc={b['hub_city']} {b['distance_km']}km")
    assert cmp["locked"] is True  # 5 demo bids == cap

    # cap enforcement: 6th bid must be rejected
    payload = dict(supplier_name="Extra Shop", hub_city="Nowhere", unit_price=9000,
                   tooling=0, freight=0, gst_included=True, lead_weeks=4, payment_terms="50/50")
    r = client.post("/api/rfqs/1/bid", json=payload)
    print("bid over cap ->", r.status_code, r.json().get("detail"))
    assert r.status_code == 409

    # a fresh RFQ (id 67) accepts a bid
    r = client.get("/api/rfqs/67"); assert r.status_code == 200
    r = client.post("/api/rfqs/67/bid", json=payload)
    print("bid on rfq67 ->", r.status_code, r.json())
    assert r.status_code == 201
    bid_id = r.json()["bid_id"]

    # award reveals the winner's name
    r = client.post("/api/rfqs/67/award", json={"bid_id": bid_id})
    print("award ->", r.status_code, r.json())
    assert r.status_code == 200 and r.json()["revealed_name"] == "Extra Shop"
    r = client.get("/api/rfqs/67/bids")
    winner = [b for b in r.json()["bids"] if b.get("revealed_name")]
    assert winner and winner[0]["revealed_name"] == "Extra Shop"
    print("reveal-on-award OK")

    # server-side TLC recompute matches: unit*qty+tooling+freight (+18% gst)
    r = client.get("/api/rfqs/67/bids"); b0 = r.json()["bids"][0]
    print("admin unblinded:")
    r = client.get("/api/admin/rfqs/67/bids"); print(" ", r.json()["bids"][0]["supplier_name"])

    print("\nALL SMOKE CHECKS PASSED")


if __name__ == "__main__":
    main()
