"""Integrity test for the inside-sales lead import (Phase 1).

Run:  python test_lead_import.py

Unlike test_smoke.py this asserts *data invariants* rather than HTTP shape.
It is idempotent-safe: it only reads. Re-run import_leads.py at any time and
this must stay green.
"""
from __future__ import annotations
import sys
from pathlib import Path

API = Path(__file__).resolve().parent
_ROOT = API
while _ROOT != _ROOT.parent and not (_ROOT / "rfq_categories.py").exists():
    _ROOT = _ROOT.parent
if not (_ROOT / "rfq_categories.py").exists():
    raise SystemExit("rfq_categories.py not found above %s" % API)
sys.path.insert(0, str(_ROOT))
sys.path.insert(0, str(API))

import db  # noqa: E402
import lead_models as lm  # noqa: E402
import rfq_categories as rc  # noqa: E402
from sqlalchemy import func, select, text  # noqa: E402

FAILS: list[str] = []


def main() -> int:
    db.init_db()
    s = db.SessionLocal()
    try:
        _run(s)
    finally:
        s.close()

    print("=" * 70)
    if FAILS:
        print("PHASE 1 INTEGRITY: FAIL")
        for f in FAILS:
            print("  !!", f)
        print("=" * 70)
        return 1
    print("PHASE 1 INTEGRITY: PASS - all checks green")
    print("=" * 70)
    return 0


def _q(s, stmt):
    return s.scalar(stmt) or 0


def _run(s) -> None:
    def head(title: str) -> None:
        print("\n" + "=" * 70)
        print(title)
        print("=" * 70)

    # ---------------------------------------------------------------- volumes
    head("1. VOLUMES + REFERENTIAL INTEGRITY")
    n_comp = _q(s, select(func.count()).select_from(lm.Company))
    n_con = _q(s, select(func.count()).select_from(lm.Contact))
    n_lead = _q(s, select(func.count()).select_from(lm.Lead))
    n_batch = _q(s, select(func.count()).select_from(lm.ImportBatch))
    print("  companies %d | contacts %d | leads %d | batches %d"
          % (n_comp, n_con, n_lead, n_batch))

    for label, got, lo in (("companies", n_comp, 2900), ("contacts", n_con, 2000),
                           ("leads", n_lead, 2900)):
        ok = got >= lo
        if not ok:
            FAILS.append("%s %d < expected minimum %d" % (label, got, lo))
        print("    %-10s %5d  min %d  %s" % (label, got, lo, "OK" if ok else "LOW"))

    orphan = _q(s, select(func.count()).select_from(lm.Lead)
                .where(~lm.Lead.company_id.in_(select(lm.Company.id))))
    if orphan:
        FAILS.append("orphan leads (no company): %d" % orphan)
    print("  orphan leads (no company): %d %s" % (orphan, "OK" if not orphan else "!!!"))

    dupes = s.execute(
        select(lm.Lead.company_id, lm.Lead.track, func.count())
        .group_by(lm.Lead.company_id, lm.Lead.track)
        .having(func.count() > 1)).all()
    if dupes:
        FAILS.append("duplicate (company, track) leads: %d pairs" % len(dupes))
    print("  duplicate (company,track) leads: %d %s"
          % (len(dupes), "OK" if not dupes else "!!!"))

    n_ctx = _q(s, select(func.count()).select_from(lm.Contact)
               .where(~lm.Contact.company_id.in_(select(lm.Company.id))))
    if n_ctx:
        FAILS.append("orphan contacts: %d" % n_ctx)
    print("  orphan contacts:                 %d %s"
          % (n_ctx, "OK" if not n_ctx else "!!!"))

    # -------------------------------------------------------------- exclusion
    head("2. EXCLUSION - retained in DB, hidden from the rep queue")
    excl = _q(s, select(func.count()).select_from(lm.Lead)
              .where(lm.Lead.excluded_from_sales.is_(True)))
    for reason, n in s.execute(
            select(lm.Lead.exclusion_reason, func.count())
            .where(lm.Lead.excluded_from_sales.is_(True))
            .group_by(lm.Lead.exclusion_reason)
            .order_by(func.count().desc())).all():
        print("    %-56s %5d" % ((reason or "?")[:56], n))
    print("  excluded total: %d" % excl)

    # Every excluded row must carry a reason...
    no_reason = _q(s, select(func.count()).select_from(lm.Lead)
                   .where(lm.Lead.excluded_from_sales.is_(True),
                          lm.Lead.exclusion_reason == ""))
    if no_reason:
        FAILS.append("%d excluded leads have no exclusion_reason" % no_reason)
    # ...and ONLY excluded rows may carry one. A disqualified (bad-data) lead
    # reading as "out of geography" is a data bug, not a cosmetic one.
    stray = _q(s, select(func.count()).select_from(lm.Lead)
               .where(lm.Lead.exclusion_reason != "",
                      lm.Lead.excluded_from_sales.is_(False)))
    if stray:
        FAILS.append("%d non-excluded leads carry an exclusion_reason" % stray)
    print("  excluded w/o reason: %d | non-excluded w/ reason: %d  %s"
          % (no_reason, stray, "OK" if not (no_reason or stray) else "!!!"))

    # --------------------------------------------------------- stage mapping
    head("3. STAGE + TRACK VOCABULARY")
    illegal = _q(s, select(func.count()).select_from(lm.Lead)
                 .where(~lm.Lead.status.in_(lm.STATUSES)))
    bad_track = _q(s, select(func.count()).select_from(lm.Lead)
                   .where(~lm.Lead.track.in_(lm.TRACKS)))
    if illegal:
        FAILS.append("%d leads use a status outside STATUSES" % illegal)
    if bad_track:
        FAILS.append("%d leads use a track outside TRACKS" % bad_track)
    for st, n in s.execute(select(lm.Lead.status, func.count())
                           .group_by(lm.Lead.status)
                           .order_by(func.count().desc())).all():
        print("    %-20s %5d" % (st, n))
    for t, n in s.execute(select(lm.Lead.track, func.count())
                          .group_by(lm.Lead.track)).all():
        print("    track %-15s %5d" % (t, n))
    print("  illegal status: %d | illegal track: %d  %s"
          % (illegal, bad_track, "OK" if not (illegal or bad_track) else "!!!"))

    # ------------------------------------------------------- category quality
    head("4. CATEGORY INTEGRITY")
    keys = list(rc.CATEGORIES)
    bad_cat = _q(s, select(func.count()).select_from(lm.Company)
                 .where(~lm.Company.category_primary.in_(keys + [""])))
    if bad_cat:
        FAILS.append("%d companies carry an unknown category_primary" % bad_cat)
    print("  unknown category_primary: %d %s"
          % (bad_cat, "OK" if not bad_cat else "!!!"))

    # A blank primary is only legitimate when the classifier itself said
    # 'Uncategorised' AND the source flagged the row as bad data. Those leads
    # must already be parked in `incorrect` - never left in a rep's queue.
    blank = _q(s, select(func.count()).select_from(lm.Company)
               .where(lm.Company.category_primary == ""))
    leaky = _q(s, select(func.count()).select_from(lm.Company)
               .join(lm.Lead, lm.Lead.company_id == lm.Company.id)
               .where(lm.Company.category_primary == "",
                      lm.Lead.status != "incorrect"))
    if leaky:
        FAILS.append("%d uncategorised companies are still in a calling stage" % leaky)
    print("  blank category_primary: %d (of which callable: %d) %s"
          % (blank, leaky, "OK" if not leaky else "!!!"))
    for (name,) in s.execute(select(lm.Company.name)
                             .where(lm.Company.category_primary == "")).all():
        print("      %s" % name[:66])

    bad_tag = 0
    for (tags,) in s.execute(select(lm.Company.category_tags)).all():
        for t in (tags or []):
            if t not in rc.CATEGORIES:
                bad_tag += 1
    if bad_tag:
        FAILS.append("%d companies carry an unknown tag" % bad_tag)
    print("  unknown tags: %d %s" % (bad_tag, "OK" if not bad_tag else "!!!"))

    # ---------------------------------------------------- enrichment signals
    head("5. ENRICHMENT + OWNERSHIP SIGNALS")
    wd = _q(s, select(func.count()).select_from(lm.Company)
            .where(lm.Company.what_they_do != ""))
    adv = sum(1 for (a,) in s.execute(select(lm.Company.adjacency)).all() if a)
    dm = _q(s, select(func.count()).select_from(lm.Contact)
            .where(lm.Contact.decision_maker.is_(True)))
    no_con = _q(s, select(func.count()).select_from(lm.Company)
                .where(~lm.Company.id.in_(select(lm.Contact.company_id))))
    prio = _q(s, select(func.count()).select_from(lm.Lead)
              .where(lm.Lead.priority_rank.isnot(None)))
    print("  what_they_do populated   %5d (%.0f%% of companies)" % (wd, 100 * wd / max(n_comp, 1)))
    print("  adjacency populated      %5d (cross-sell tags)" % adv)
    print("  decision_maker contacts  %5d (%.0f%% of contacts)" % (dm, 100 * dm / max(n_con, 1)))
    print("  companies awaiting a contact %4d (enrichment backlog)" % no_con)
    print("  leads with priority_rank %5d (from Priority 100 board)" % prio)
    if prio == 0:
        FAILS.append("Priority 100 scores did not carry into the DB")

    # The headline number the sales team will be measured on: valid leads that
    # a rep can actually reach right now.
    callable_leads = _q(s, select(func.count()).select_from(lm.Lead).where(
        lm.Lead.excluded_from_sales.is_(False),
        lm.Lead.company_id.in_(
            select(lm.Company.id).join(lm.Contact).where(
                (lm.Contact.phone_primary != "") | (lm.Contact.email != "")
                | (lm.Contact.whatsapp != "")).distinct())))
    print("\n  REP-CALLABLE LEADS      %5d  (not excluded + reachable contact)" % callable_leads)

    # ------------------------------------------------------------ audit trail
    head("6. IMPORT BATCH AUDIT TRAIL")
    if n_batch == 0:
        FAILS.append("no import_batch rows - import is not auditable")
    for r in s.execute(
            select(lm.ImportBatch.id, lm.ImportBatch.source_file, lm.ImportBatch.sheet,
                   lm.ImportBatch.rows_read, lm.ImportBatch.companies_created,
                   lm.ImportBatch.contacts_created, lm.ImportBatch.leads_created,
                   lm.ImportBatch.run_by, lm.ImportBatch.dry_run)
            .order_by(lm.ImportBatch.id)).all():
        print("  #%d %-30s %-18s rows=%-5d co=%-5d ct=%-5d ld=%-5d %s%s"
              % (r[0], r[1][:30], r[2][:18], r[3], r[4], r[5], r[6], r[7],
                 " [dry]" if r[8] else ""))

    # ------------------------------------------------- marketplace regression
    head("7. MARKETPLACE DATA UNTOUCHED BY THE LEAD IMPORT")
    for table, expected in (("rfq", 67), ("bid", 330), ("supplier", 5), ("user", 3)):
        got = _q(s, select(text("count(*)")).select_from(text(table)))
        ok = got == expected
        if not ok:
            FAILS.append("marketplace regression: %s = %d, expected %d"
                         % (table, got, expected))
        print("  %-10s %5d (expected %d) %s" % (table, got, expected, "OK" if ok else "!!!"))


if __name__ == "__main__":
    sys.exit(main())