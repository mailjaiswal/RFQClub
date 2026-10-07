"""Integrity test for the inside-sales lead import (Phase 1).

Run:  python test_lead_import.py

Unlike test_smoke.py this asserts *data invariants* rather than HTTP shape.
It re-runs `import_leads.run()` to prove the import is idempotent and does not
touch marketplace tables; everything else only reads.
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

    # One company may legitimately carry both a supplier and a buyer lead, but only
    # when it really operates on both sides. `track` is derived from the category's
    # default_track, so a re-tag silently produces a SECOND queue row for a company
    # nobody worked - the same lead shows up twice in the shared pool and the copy
    # no rep claimed just ages there. The importer retargets/prunes those instead.
    multi = (select(lm.Lead.company_id)
             .where(lm.Lead.excluded_from_sales.is_(False))
             .group_by(lm.Lead.company_id)
             .having(func.count() > 1).subquery())
    dual_ids = [r[0] for r in s.execute(select(multi.c.company_id)).all()]
    if dual_ids:
        FAILS.append("%d companies are queue-visible more than once" % len(dual_ids))
        for name, in s.execute(select(lm.Company.name)
                               .where(lm.Company.id.in_(dual_ids))).all():
            print("      %s" % name[:66])
    print("  companies with >1 queue-visible lead: %d %s"
          % (len(dual_ids), "OK" if not dual_ids else "!!!"))

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
    # The invariant is "the importer does not write marketplace tables", not a
    # fixed row count: test_smoke.py posts RFQs/bids against this same database,
    # so absolute numbers drift with every run. Snapshot, re-run the (idempotent)
    # import, and compare.
    tables = ("rfq", "bid", "supplier", "user")
    before = {t: _q(s, select(text("count(*)")).select_from(text(t))) for t in tables}
    s.commit()                      # release the read snapshot before writing
    import import_leads             # noqa: E402 - after db/init in this flow
    st = import_leads.run(dry=False, expansion=True, note="integrity re-run")
    s.expire_all()
    print("  re-run: companies+%d leads+%d contacts+%d dupes=%d"
          % (st["companies_created"], st["leads_created"], st["contacts_created"],
             st["duplicates_skipped"]))
    if st["companies_created"] or st["leads_created"]:
        FAILS.append("import is not idempotent: created %d companies / %d leads "
                     "on a re-run" % (st["companies_created"], st["leads_created"]))
    for t in tables:
        got = _q(s, select(text("count(*)")).select_from(text(t)))
        ok = got == before[t]
        if not ok:
            FAILS.append("marketplace regression: %s went %d -> %d during the "
                         "lead import" % (t, before[t], got))
        print("  %-10s %5d (was %d) %s" % (t, got, before[t], "OK" if ok else "!!!"))

    # --------------------------------------------------- dead companies hidden
    head("8. REGISTRY-DEAD COMPANIES ARE OUT OF THE REP QUEUE")
    # Every harvested row carries the MCA status in its provenance string, so a
    # strike-off / amalgamated / liquidation / dissolution / CIRP company must
    # never sit in a rep's queue as if it were callable.
    for marker in ("strike off", "amalgamat", "liquidat", "dissolve", "cirp"):
        n = _q(s, select(func.count()).select_from(lm.Lead).where(
            lm.Lead.excluded_from_sales.is_(False),
            lm.Lead.source_note.ilike("%%status %s%%" % marker)))
        if n:
            FAILS.append("%d lead(s) with MCA status '%s' are still visible to "
                         "sales" % (n, marker))
        print("    %-12s %5d visible to sales  %s"
              % (marker, n, "OK" if not n else "!!!"))
    hidden = _q(s, select(func.count()).select_from(lm.Lead).where(
        lm.Lead.excluded_from_sales.is_(True),
        lm.Lead.disqualify_reason.like("MCA status:%")))
    print("  registry-dead retained + hidden: %d" % hidden)
    if hidden == 0:
        FAILS.append("no registry-dead lead is flagged hidden - the dead-status "
                     "mapping is not being applied")

    # ------------------------------------------------------ every row landed
    head("9. EVERY WORKBOOK ROW REACHED THE DATABASE")
    # Volume checks cannot see a dropped row. When the importer's row loop was
    # rewritten it started the sheet row at 2 but bounded the loop on
    # len(rows), so the LAST row of every sheet was skipped: one harvested
    # company never reached the hosted database while every counter still
    # reported a healthy run. Assert name-by-name coverage instead.
    import import_leads as il
    have = {r[0] for r in s.execute(select(lm.Company.name_norm))}
    for path, sheet in ((Path(il.config.SOURCE_XLSX), "All Contacts"),
                        (_ROOT / "Swaniki_Expansion_Database.xlsx",
                         "Expansion Contacts")):
        hdr, rows = il.read_sheet(Path(path), sheet)
        if not rows:
            continue
        missing = sorted({il.norm_name(r["Company"]) for r in rows
                          if r.get("Company")
                          and il.norm_name(r["Company"]) not in have})
        print("  %-34s rows=%-5d not in DB: %-3d %s"
              % (Path(path).name, len(rows), len(missing),
                 "OK" if not missing else "!!!"))
        if missing:
            FAILS.append("%d workbook company row(s) from %s never became a "
                         "company (e.g. %s) - the importer is dropping rows"
                         % (len(missing), Path(path).name, missing[:3]))


if __name__ == "__main__":
    sys.exit(main())