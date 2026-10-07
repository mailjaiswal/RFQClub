"""Remove the second-track relics a re-tag leaves behind, so two databases seeded
from one workbook actually hold the same leads.

The importer refuses to delete a stale lead unless it is still in its starting
status (`import_leads._untouched`). That rule rightly protects a rep's history, but
it also spares rows the IMPORTER itself moved: a company re-tagged into a new
vertical keeps its old-track lead, the importer writes the new status onto that
orphan, the status is no longer `new`, and the row ages there forever - invisible
to reps because it is excluded from sales, but present, so a database built before
the fix and one built after it stop matching.

This tool deletes exactly that case and nothing else: a workbook-sourced lead that
is unowned, unscheduled, carries no activity / task / status-history row, is not
the company's only lead, and sits on a track its own category no longer uses.
Dry by default - it reports first, and only `--apply` writes.

Usage:
    python prune_relic_leads.py            # what would go
    python prune_relic_leads.py --apply    # remove them
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "api"))

import config                # noqa: E402
import db                      # noqa: E402
import lead_models as lm       # noqa: E402
import rfq_categories as rc    # noqa: E402
from sqlalchemy import func, select  # noqa: E402

WORKBOOK_SOURCES = ("bns", "expansion")


def _untouched(session, lead) -> bool:
    """No rep has ever had this row: nothing to lose by removing it."""
    if lead.source not in WORKBOOK_SOURCES or lead.owner_id is not None:
        return False
    if lead.next_action_at or lead.wants_call_back_at or lead.last_contacted_at:
        return False
    if lead.followup_count:
        return False
    for model in (lm.LeadActivity, lm.LeadTask, lm.LeadStatusHistory):
        if session.scalar(select(func.count()).select_from(model)
                          .where(model.lead_id == lead.id)):
            return False
    return True


def expected_track(company) -> str:
    return rc.CATEGORIES.get(company.category_primary or "", {}).get(
        "default_track", "supplier")


def find_relics(session):
    """(relic, survivor) pairs, one per stale second-track lead."""
    multi = session.execute(
        select(lm.Lead.company_id, func.count()).group_by(lm.Lead.company_id)
        .having(func.count() > 1)).all()
    out = []
    for cid, _n in multi:
        company = session.get(lm.Company, cid)
        leads = session.scalars(select(lm.Lead).where(
            lm.Lead.company_id == cid).order_by(lm.Lead.id)).all()
        want = expected_track(company)
        keep = [l for l in leads if l.track == want]
        stale = [l for l in leads if l.track != want]
        if len(keep) != 1 or not stale:
            # no single surviving lead, or every row is off-track: not our call
            print("  skip %s (%r): %d leads, expected track %r not held exactly once"
                  % (cid, company.name, len(leads), want))
            continue
        for l in stale:
            if _untouched(session, l):
                out.append((l, keep[0], company))
            else:
                print("  keep %s on %s: a rep has worked this row"
                      % (l.id, l.track))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="delete the relics (default only reports them)")
    a = ap.parse_args()

    session = db.SessionLocal()
    print("TARGET =", "HOSTED" if config.DATABASE_URL.startswith("postgres")
          else "LOCAL SQLITE")
    total = session.scalar(select(func.count()).select_from(lm.Lead))
    relics = find_relics(session)
    if not relics:
        print("no second-track relics: %d leads, one per company where the track "
              "matches its category" % total)
        return 0
    for relic, keep, company in relics:
        print("  %s  %-9s status=%-10s excluded=%s  -> keep lead %s (%s)"
              % ((company.name or "")[:44], relic.track, relic.status,
                 relic.excluded_from_sales, keep.id, keep.track))
    if not a.apply:
        print("\n%d relic(s) found - nothing deleted (pass --apply)" % len(relics))
        return 1
    for relic, _keep, _company in relics:
        session.delete(relic)
    session.commit()
    left = session.scalar(select(func.count()).select_from(lm.Lead))
    print("removed %d relic(s): leads %d -> %d, committed"
          % (len(relics), total, left))
    return 0


if __name__ == "__main__":
    sys.exit(main())
