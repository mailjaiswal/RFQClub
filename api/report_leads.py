"""Lead database analysis: how good is our data, really?

Aggregate-only report over `company` / `contact` / `lead`. Never prints row
dumps, so it is safe to run against production. Read-only - it cannot mutate
anything.

Usage:
    python report_leads.py              # everything
    python report_leads.py --json       # machine-readable, for dashboards
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

API = Path(__file__).resolve().parent
_ROOT = API
while _ROOT != _ROOT.parent and not (_ROOT / "rfq_categories.py").exists():
    _ROOT = _ROOT.parent
sys.path.insert(0, str(_ROOT))
sys.path.insert(0, str(API))

import db  # noqa: E402
import lead_models as lm  # noqa: E402
import rfq_categories as rc  # noqa: E402

# --------------------------------------------------------------------- helpers


def pct(n, d):
    return 0.0 if not d else round(100.0 * n / d, 1)


def bar(n, d, width=28):
    filled = 0 if not d else int(round(width * n / d))
    return "#" * filled + "." * (width - filled)


def title(text):
    print("\n" + "=" * 74)
    print(text)
    print("=" * 74)


def subsection(text):
    print("\n" + text)
    print("-" * 74)


# ------------------------------------------------------------------- data load


def load():
    s = db.SessionLocal()
    try:
        comps = s.query(lm.Company).all()
        cons = s.query(lm.Contact).all()
        leads = s.query(lm.Lead).all()
        cats = {c.key: c for c in s.query(lm.Category).all()}
        users = {u.id: u.email for u in s.query(__import__("models").User).all()}
    finally:
        s.close()
    return comps, cons, leads, cats, users


# ------------------------------------------------------------------- enrichment


def company_fill(comps):
    """Field-by-field fill rate across the company table."""
    checks = [
        ("website", lambda c: bool(c.website)),
        ("gmb_link", lambda c: bool(c.gmb_link)),
        ("linkedin_url", lambda c: bool(c.linkedin_url)),
        ("country", lambda c: bool(c.country)),
        ("hub_city", lambda c: bool(c.hub_city)),
        ("address", lambda c: bool(c.address)),
        ("what_they_do (parsed)", lambda c: bool(c.what_they_do)),
        ("size_band", lambda c: bool(c.size_band)),
        ("category_primary", lambda c: bool(c.category_primary)),
        ("category_tags (any)", lambda c: bool(c.category_tags)),
        ("adjacency (cross-sell)", lambda c: bool(c.adjacency)),
        ("cin or gst", lambda c: bool(c.cin or c.gst)),
        ("review_rating", lambda c: c.review_rating is not None),
        ("review_count", lambda c: c.review_count is not None),
    ]
    n = len(comps)
    rows = []
    for label, fn in checks:
        hit = sum(1 for c in comps if fn(c))
        rows.append((label, hit, pct(hit, n)))
    return rows, checks, n


def contact_fill(cons):
    checks = [
        ("full_name", lambda c: bool(c.full_name)),
        ("designation", lambda c: bool(c.designation)),
        ("decision_maker", lambda c: bool(c.decision_maker)),
        ("phone_primary", lambda c: bool(c.phone_primary)),
        ("phone_secondary", lambda c: bool(c.phone_secondary)),
        ("email", lambda c: bool(c.email)),
        ("email_verified", lambda c: bool(c.email_verified)),
        ("whatsapp", lambda c: bool(c.whatsapp)),
        ("preferred_channel", lambda c: bool(c.preferred_channel)),
        ("is_primary", lambda c: bool(c.is_primary)),
        ("do_not_call", lambda c: bool(c.do_not_call)),
    ]
    n = len(cons)
    rows = []
    for label, fn in checks:
        hit = sum(1 for c in cons if fn(c))
        rows.append((label, hit, pct(hit, n)))
    return rows, n


def has_channel(c):
    return bool(c.phone_primary or c.email or c.whatsapp)


def enrichment_score(c, cons_by_co):
    """Count of distinct data points we hold about one company, out of 12."""
    pts = 0
    pts += bool(c.website)
    pts += bool(c.address)
    pts += bool(c.hub_city)
    pts += bool(c.country)
    pts += bool(c.what_they_do)
    pts += bool(c.size_band)
    pts += bool(c.category_primary)
    pts += bool(c.adjacency)
    pts += bool(c.cin or c.gst)
    pts += c.review_rating is not None
    cs = cons_by_co.get(c.id, [])
    pts += bool(cs)                      # we know at least one person
    pts += any(has_channel(x) for x in cs)  # we can actually reach them
    return pts


# ------------------------------------------------------------------ call tiers


def call_readiness(comps, cons, leads):
    """Data-quality tiers. This is the 'how many good leads' answer.

    NOTE: the CRM pipeline stage `qualified` means a rep ran discovery and won.
    Nothing is at that stage yet - nobody has dialled. These tiers describe how
    good the DATA is, which is what determines whether a lead is worth dialling.
    """
    cons_by_co = defaultdict(list)
    for c in cons:
        cons_by_co[c.company_id].append(c)
    co_by_id = {c.id: c for c in comps}

    tiers = Counter()
    detail = defaultdict(Counter)

    for l in leads:
        co = co_by_id.get(l.company_id)
        if co is None:
            tiers["orphan"] += 1
            continue
        cs = cons_by_co.get(l.company_id, [])
        reachable = any(has_channel(x) for x in cs)
        named = any(x.full_name for x in cs)
        dm = any(x.decision_maker for x in cs)

        if l.excluded_from_sales:
            tiers["D"] += 1
            detail["D"][l.exclusion_reason or "no reason"] += 1
        elif l.status == "incorrect":
            tiers["E"] += 1
        elif reachable and named and dm:
            tiers["A"] += 1
        elif reachable:
            tiers["B"] += 1
            if named:
                detail["B"]["reachable, named, but no decision-maker"] += 1
            else:
                detail["B"]["reachable, but no person named"] += 1
        else:
            tiers["C"] += 1
            if named:
                detail["C"]["named person, but no channel"] += 1
            else:
                detail["C"]["name only - nothing to dial"] += 1

    return tiers, detail, cons_by_co


# ------------------------------------------------------------------- main body


def run(as_json=False):
    comps, cons, leads, cats, users = load()
    out = {}

    title("LEAD DATABASE ANALYSIS")

    # ---------------------------------------------------------------- headline
    subsection("1. HEADLINE")
    by_source = Counter(c.source_system or "?" for c in comps)
    print("  companies           %5d" % len(comps))
    print("  contacts            %5d" % len(cons))
    print("  leads               %5d" % len(leads))
    print("  categories          %5d" % len(cats))
    print("  distinct owners     %5d" % len({l.owner_id for l in leads if l.owner_id}))
    for src, n in by_source.most_common():
        print("    %-24s %5d (%s%% of companies)" % (src[:24], n, pct(n, len(comps))))
    out["headline"] = {
        "companies": len(comps), "contacts": len(cons), "leads": len(leads),
        "by_source": dict(by_source),
    }

    # ------------------------------------------------------- pipeline reality
    subsection("2. PIPELINE - what has actually happened so far")
    st = Counter(l.status for l in leads)
    tr = Counter(l.track for l in leads)
    print("  stored stage:")
    for s in lm.STATUSES:
        if st.get(s):
            print("    %-24s %5d  %s" % (s, st[s], bar(st[s], len(leads))))
    print("  (all 9 stages are legitimate; only 2 are populated because no "
          "\n   rep has dialled yet - the pipeline is at its starting line)")
    print("\n  track:")
    for t, n in tr.most_common():
        print("    %-24s %5d  %s" % (t, n, bar(n, len(leads))))

    excl = [l for l in leads if l.excluded_from_sales]
    print("\n  excluded from sales pool: %d" % len(excl))
    for r, n in Counter(l.exclusion_reason or "?" for l in excl).most_common():
        print("    %-44s %5d" % (r[:44], n))
    dead = sum(1 for l in leads if l.status == "incorrect")
    print("  dead data (status=incorrect): %d" % dead)
    print("  owned by a rep:              %d" % sum(1 for l in leads if l.owner_id))

    out["pipeline"] = {
        "stages": dict(st), "tracks": dict(tr),
        "excluded": len(excl), "excluded_reasons": dict(Counter(
            l.exclusion_reason or "?" for l in excl)),
        "dead": dead, "owned": sum(1 for l in leads if l.owner_id),
    }

    # --------------------------------------------------------- call readiness
    subsection("3. CALL-READINESS - how many leads are actually worth dialling")
    print("""
  Tier A  call-ready        reachable + named person + decision-maker
  Tier B  call-ready        reachable, but weak person record
  Tier C  enrichment needed  valid lead, but nothing to dial
  Tier D  out of scope       retained, hidden behind manager toggle
  Tier E  dead data          source said 'nothing found'""")
    tiers, detail, cons_by_co = call_readiness(comps, cons, leads)
    total = len(leads)
    active = tiers["A"] + tiers["B"] + tiers["C"]
    print("\n  %-5s %-26s %6s   %s" % ("tier", "meaning", "count", "share of all leads"))
    print("  " + "-" * 70)
    labels = {"A": "call-ready (best)", "B": "call-ready (weak)",
              "C": "needs enrichment", "D": "out of scope", "E": "dead data"}
    for t in "ABCDE":
        n = tiers.get(t, 0)
        print("  %-5s %-26s %6d   %4.1f%%  %s"
              % (t, labels[t], n, pct(n, total), bar(n, total)))
        for why, wn in detail.get(t, Counter()).most_common(3):
            print("            %s: %d" % (why, wn))
    print("\n  ACTIVE pool (A+B+C):            %5d  %s"
          % (active, bar(active, total)))
    print("  Callable RIGHT NOW (A+B):       %5d  %s  <- the real number"
          % (tiers["A"] + tiers["B"], bar(tiers["A"] + tiers["B"], total)))
    print("  Blocked only by missing data (C): %5d" % tiers["C"])
    print("  Removed from consideration (D+E): %5d" % (tiers["D"] + tiers["E"]))

    out["call_readiness"] = {
        "A": tiers["A"], "B": tiers["B"], "C": tiers["C"],
        "D": tiers["D"], "E": tiers["E"],
        "active": active, "callable_now": tiers["A"] + tiers["B"],
    }

    # -------------------------------------------------------------- enrichment
    subsection("4. ENRICHMENT - how complete is the record, field by field")
    cf, checks, nco = company_fill(comps)
    print("  COMPANY fields (%d companies)" % nco)
    print("  %-24s %6s   %s" % ("field", "filled", "%"))
    for label, hit, p in cf:
        print("  %-24s %6d   %5.1f%%  %s" % (label, hit, p, bar(hit, nco)))
    caf, ncn = contact_fill(cons)
    print("\n  CONTACT fields (%d contacts)" % ncn)
    print("  %-24s %6s   %s" % ("field", "filled", "%"))
    for label, hit, p in caf:
        print("  %-24s %6d   %5.1f%%  %s" % (label, hit, p, bar(hit, ncn)))

    out["fill_rates"] = {
        "company": {l: h for l, h, _ in cf},
        "contact": {l: h for l, h, _ in caf},
    }

    # ------------------------------------------------------- emptiness / hollow
    subsection("5. EMPTY & HOLLOW - what has to be worked before it is usable")
    no_con = sum(1 for c in comps if not cons_by_co.get(c.id))
    no_ch = sum(1 for c in comps
                if cons_by_co.get(c.id) and not any(
                    has_channel(x) for x in cons_by_co[c.id]))
    no_person = sum(1 for c in comps
                    if not any(x.full_name for x in cons_by_co.get(c.id, [])))
    hollow = sum(1 for c in comps if not c.website and not c.address
                 and not cons_by_co.get(c.id))
    scores = [enrichment_score(c, cons_by_co) for c in comps]
    buckets = [("9-12  strong", lambda s: s >= 9),
               ("6-8   workable", lambda s: 6 <= s <= 8),
               ("3-5   thin", lambda s: 3 <= s <= 5),
               ("0-2   hollow", lambda s: s <= 2)]
    print("  companies with ZERO contacts:        %5d  %s"
          % (no_con, bar(no_con, nco)))
    print("  contacts exist, but no phone/email:  %5d" % no_ch)
    print("  companies with NO person named:      %5d  %s"
          % (no_person, bar(no_person, nco)))
    print("  hollow (no website, no address, no contact): %5d" % hollow)
    print("  contacts with no channel at all:     %5d" % sum(
        1 for c in cons if not has_channel(c)))

    print("\n  enrichment score (0-12 distinct facts held):")
    for label, fn in buckets:
        n = sum(1 for s in scores if fn(s))
        print("    %-18s %5d  %4.1f%%  %s"
              % (label, n, pct(n, nco), bar(n, nco)))
    print("    %-18s %5.1f  (mean score)" % ("MEAN", sum(scores) / max(len(scores), 1)))

    out["emptiness"] = {
        "no_contact_at_all": no_con, "contact_without_channel": no_ch,
        "no_person_named": no_person, "hollow": hollow,
        "score_buckets": {l: sum(1 for s in scores if fn(s)) for l, fn in buckets},
        "mean_score": round(sum(scores) / max(len(scores), 1), 2),
    }

    # ---------------------------------------------------------------- categories
    subsection("6. CATEGORY & TIER distribution")
    by_cat = Counter(c.category_primary or "(uncategorised)" for c in comps)
    active_ids = {l.company_id for l in leads
                  if not l.excluded_from_sales and l.status != "incorrect"}
    callable_ids = set()
    for l in leads:
        if l.company_id in active_ids and any(
                has_channel(x) for x in cons_by_co.get(l.company_id, [])):
            callable_ids.add(l.company_id)

    print("  %-22s %6s %8s %8s   tier" % ("category", "total", "active", "callable"))
    print("  " + "-" * 62)
    for key, n in by_cat.most_common():
        c = cats.get(key)
        tier = "T%d" % c.tier if c else "?"
        act = sum(1 for x in comps
                  if (x.category_primary or "(uncategorised)") == key
                  and x.id in active_ids)
        call = sum(1 for x in comps
                   if (x.category_primary or "(uncategorised)") == key
                   and x.id in callable_ids)
        print("  %-22s %6d %8d %8d   %s"
              % ((c.label[:22] if c else key[:22]), n, act, call, tier))

    t1 = [k for k, c in cats.items() if c.tier == 1]
    t1_n = sum(1 for c in comps if c.category_primary in t1)
    print("\n  Tier 1 (researched focus) companies: %d (%s%%)" % (t1_n, pct(t1_n, nco)))
    conf = Counter(c.category_confidence or "(none)" for c in comps)
    print("  category confidence:")
    for k, n in conf.most_common():
        print("    %-24s %5d  %s" % (k[:24], n, bar(n, nco)))

    out["categories"] = {
        "by_category": dict(by_cat),
        "tier1_companies": t1_n,
        "confidence": dict(conf),
    }

    # ------------------------------------------------------------------ priority
    subsection("7. PRIORITY")
    pr = [l for l in leads if l.priority_rank is not None]
    print("  leads carrying a Priority 100 rank: %d" % len(pr))
    if pr:
        print("  rank range: %d - %d" % (
            min(l.priority_rank for l in pr), max(l.priority_rank for l in pr)))
    high = 0
    for l in pr:
        co = next((c for c in comps if c.id == l.company_id), None)
        if co and co.category_tier == 1:
            high += 1
    print("  of those, Tier 1 category:          %d" % high)
    out["priority"] = {"ranked": len(pr), "tier1": high}

    # ------------------------------------------------------------------ verdict
    subsection("8. VERDICT")
    callable_n = tiers["A"] + tiers["B"]
    print("  of %d leads:" % total)
    print("    %4d (%4.1f%%)  dialable today" % (callable_n, pct(callable_n, total)))
    print("    %4d (%4.1f%%)  fixable with enrichment" % (tiers["C"], pct(tiers["C"], total)))
    print("    %4d (%4.1f%%)  deliberately out of scope" % (tiers["D"], pct(tiers["D"], total)))
    print("    %4d (%4.1f%%)  dead data" % (tiers["E"], pct(tiers["E"], total)))
    print("\n  The single biggest lever is the %d companies with no person "
          "named:\n  each one found converts a Tier C into a dialable Tier A/B."
          % no_person)

    if as_json:
        print(json.dumps(out, indent=2, default=str))
    return out


def main():
    ap = argparse.ArgumentParser(description="Lead database analysis report")
    ap.add_argument("--json", action="store_true", help="print JSON at the end")
    a = ap.parse_args()
    db.init_db()
    run(as_json=a.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())