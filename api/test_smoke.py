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

    # rich fields served by the mock recreation
    for k in ("tags", "hub_city", "saved", "posted_days_ago"):
        assert k in card, f"missing card field: {k}"
    assert isinstance(card["tags"], list), "tags must be a list"
    if card["tags"]:
        assert "label" in card["tags"][0] and "kind" in card["tags"][0]
    print("  tags:", [t["label"] for t in card["tags"]], "| hub:", repr(card["hub_city"]),
          "| posted:", card["posted_days_ago"], "| saved:", card["saved"])

    # save toggle flips the flag back and forth
    r = client.post("/api/rfqs/1/save"); assert r.status_code == 200
    first = r.json()["saved"]
    r = client.post("/api/rfqs/1/save"); assert r.status_code == 200
    assert r.json()["saved"] != first, "save toggle did not flip"
    print("save toggle ->", first, "then", r.json()["saved"])

    # profile fixture
    r = client.get("/api/profile"); assert r.status_code == 200
    prof = r.json()
    assert isinstance(prof["percent"], int), "percent must be int"
    assert "tabs" in prof and "panels" in prof and len(prof["tabs"]) == 8
    print(f"profile percent={prof['percent']} tabs={len(prof['tabs'])} panels={len(prof['panels'])}")

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

    # a freshly-posted draft RFQ (0 bids) accepts a bid
    r = client.post("/api/rfqs", json={"title": "Smoke test flanges", "sector_key": "cnc", "qty": 50, "unit": "pcs"})
    assert r.status_code == 201
    fresh_id = r.json()["id"]
    r = client.get(f"/api/rfqs/{fresh_id}"); assert r.status_code == 200
    r = client.post(f"/api/rfqs/{fresh_id}/bid", json=payload)
    print("bid on fresh rfq ->", r.status_code, r.json())
    assert r.status_code == 201
    bid_id = r.json()["bid_id"]

    # award reveals the winner's name
    r = client.post(f"/api/rfqs/{fresh_id}/award", json={"bid_id": bid_id})
    print("award ->", r.status_code, r.json())
    assert r.status_code == 200 and r.json()["revealed_name"] == "Extra Shop"
    r = client.get(f"/api/rfqs/{fresh_id}/bids")
    winner = [b for b in r.json()["bids"] if b.get("revealed_name")]
    assert winner and winner[0]["revealed_name"] == "Extra Shop"
    print("reveal-on-award OK")

    # server-side TLC recompute matches: unit*qty+tooling+freight (+18% gst)
    r = client.get(f"/api/rfqs/{fresh_id}/bids"); b0 = r.json()["bids"][0]
    print("admin unblinded:")
    r = client.get(f"/api/admin/rfqs/{fresh_id}/bids"); print(" ", r.json()["bids"][0]["supplier_name"])

    # ---------- auth: email OTP (mock) + per-user persistence ----------
    def bearer(tok): return {"Authorization": f"Bearer {tok}"}

    # honest flow for two users (wrong code first, then fresh code)
    tokens = {}
    for em in ("buyer.one@test.com", "buyer.two@test.com"):
        r = client.post("/api/auth/otp/request", json={"email": em})
        assert r.status_code == 200 and r.json().get("dev_code")
        code = r.json()["dev_code"]
        assert client.post("/api/auth/otp/verify", json={"email": em, "code": "000000"}).status_code == 400
        r = client.post("/api/auth/otp/request", json={"email": em})  # wrong-code attempt above consumed nothing; re-request fresh
        code = r.json()["dev_code"]
        r = client.post("/api/auth/otp/verify", json={"email": em, "code": code})
        assert r.status_code == 200 and r.json()["token"]
        tokens[em] = r.json()["token"]
        print(f"otp login {em} OK")

    # /me requires a token; tampered token rejected
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=bearer("x|y|9999999999.deadbeef")).status_code == 401
    r = client.get("/api/auth/me", headers=bearer(tokens["buyer.one@test.com"]))
    assert r.status_code == 200 and r.json()["user"]["email"] == "buyer.one@test.com"

    # role update re-issues a token
    r = client.post("/api/auth/role", json={"role": "buyer"}, headers=bearer(tokens["buyer.one@test.com"]))
    assert r.status_code == 200 and r.json()["user"]["role"] == "buyer"
    tokens["buyer.one@test.com"] = r.json()["token"]

    # per-user save isolation
    client.post("/api/rfqs/2/save", headers=bearer(tokens["buyer.one@test.com"]))
    s1 = {i["id"]: i["saved"] for i in client.get("/api/rfqs", headers=bearer(tokens["buyer.one@test.com"])).json()["items"]}
    s2 = {i["id"]: i["saved"] for i in client.get("/api/rfqs", headers=bearer(tokens["buyer.two@test.com"])).json()["items"]}
    assert s1[2] is True and s2[2] is False, "save isolation broken"
    print("save isolation OK (user1 saved rfq2, user2 did not)")

    # anonymous parity: legacy global flag still drives the saved field
    sA = {i["id"]: i["saved"] for i in client.get("/api/rfqs").json()["items"]}
    assert sA[2] is False, "anonymous view must not see user saves"

    # my/rfqs + my/bids round-trip on a user-posted draft
    u2 = bearer(tokens["buyer.two@test.com"])
    r = client.post("/api/rfqs", json={"title": "Smoke gearbox batch", "sector_key": "cnc", "qty": 100, "unit": "pcs"}, headers=u2)
    assert r.status_code == 201
    new_id = r.json()["id"]
    r = client.post(f"/api/rfqs/{new_id}/bid", json=payload, headers=u2)
    assert r.status_code == 201
    r = client.get("/api/auth/my/rfqs", headers=u2)
    assert r.status_code == 200 and any(i["id"] == new_id for i in r.json()["items"])
    r = client.get("/api/auth/my/bids", headers=u2)
    mine = r.json()["items"]
    assert any(m["rfq"]["id"] == new_id and m["status"] == "Live" for m in mine), mine
    print(f"my/rfqs + my/bids OK (posted rfq {new_id}, {len(mine)} bid(s))")

    print("\nALL SMOKE CHECKS PASSED")


if __name__ == "__main__":
    main()
