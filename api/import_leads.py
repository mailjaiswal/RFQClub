"""Excel -> database importer for the inside-sales lead system.

Reads the tagged workbooks produced by `apply_rfq_categories.py` and upserts
them into `company` / `contact` / `lead`, writing one `import_batch` audit row.

IDEMPOTENCY is the hard requirement. The importer upserts on `company.name_norm`
and satisfies `UNIQUE(company_id, track)` on lead, so re-running is safe and
must report 0 created rows on a second pass. It never deletes: the 269
Non-Indian / Foreign / Ambiguous leads are retained and flagged
`excluded_from_sales` rather than dropped (confirmed 2026-10-05).

Usage:
    python import_leads.py --dry                # report only, writes nothing
    python import_leads.py                      # run it
    python import_leads.py --no-expansion       # BnS workbook only
    python import_leads.py --batch-note "..."
"""
from __future__ import annotations

import argparse
import re
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

import openpyxl  # noqa: E402

import config  # noqa: E402
import db  # noqa: E402
import lead_models as lm  # noqa: E402
from db import SessionLocal  # noqa: E402
from sqlalchemy import func, select  # noqa: E402
from sqlalchemy.exc import (  # noqa: E402
    InterfaceError, InternalError, OperationalError,
)

import rfq_categories as rc  # noqa: E402

# --------------------------------------------------------------------------
# Reference data
# --------------------------------------------------------------------------

COUNTRIES = [
    "India", "Germany", "United States of America", "United States", "USA",
    "United Kingdom", "Japan", "China", "Taiwan", "Italy", "Spain", "France",
    "Netherlands", "Poland", "Turkey", "Mexico", "Brazil", "Canada",
    "Australia", "South Korea", "Malaysia", "Singapore", "Thailand",
]
DASHES = "\u2013\u2014\u2012\u2015\uFFFD\\-"
SIZE_BAND = re.compile(
    r"(?:~|under\s+|over\s+|up\s+to\s+)?(\d{1,4}(?:,\d{3})?\s*"
    r"(?:[-+]\s*\d{0,4})?)\s*(?:staff|employees|people|persons|workers|team)\b",
    re.I)

DECISION_MAKER_TITLES = (
    "managing director", "md", "general manager", "gm", "director",
    "vice president", "vp", "head", "ceo", "cfo", "coo", "cto",
    "proprietor", "partner", "president", "founder", "owner",
    "general sales manager", "national sales manager", "plant manager",
    "purchase manager", "procurement manager", "sourcing manager",
    "purchase head", "commercial manager",
)
NON_DECISION_TITLES = ("assistant", "deputy", "intern", "trainee",
                       "coordinator", "executive", "secretary")

COL_ROLES = (
    ("md", "primary", "secondary", "email", "phone", "whatsapp", "linkedin"),
    ("full_name", "designation", "decision_maker", "email", "phone_primary",
     "whatsapp", ""),
)


def norm_name(s) -> str:
    """Company dedupe key: lowercase, punctuation stripped, whitespace collapsed.

    Deliberately conservative - it folds legal-form punctuation ("Pvt. Ltd." ->
    "pvt ltd") but keeps distinct companies distinct.
    """
    if not s:
        return ""
    t = str(s).lower().replace("\ufffd", " ")
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def clean_text(s) -> str:
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s).replace("\ufffd", " ")).strip()


def parse_address(addr) -> tuple[str, str]:
    """(what_they_do, size_band) from the free-text address column."""
    t = clean_text(addr)
    if not t:
        return "", ""
    size = ""
    m = SIZE_BAND.search(t)
    if m:
        size = m.group(1).replace(",", "").replace(" ", "")

    low = t.lower()
    cut = -1
    for c in COUNTRIES:
        i = low.rfind(c.lower())
        if i > cut:
            cut = i + len(c)
    if cut < 0 or cut >= len(t):
        return "", size
    tail = t[cut:]
    tail = re.sub(r"^[\s" + DASHES + r"({\[]+", "", tail).strip()
    tail = re.sub(r"^[,;:]+\s*", "", tail)
    if len(tail) < 8:
        return "", size
    if tail.count("(") > tail.count(")"):
        tail = tail.rsplit("(", 1)[0].strip()
    elif tail.count(")") > tail.count("("):
        tail = tail.rsplit(")", 1)[0].strip()
    return tail.strip().rstrip(",;:- ").strip(), size


def is_decision_maker(designation) -> bool:
    d = clean_text(designation).lower()
    if not d:
        return False
    if any(bad in d for bad in NON_DECISION_TITLES):
        return False
    return any(t in d for t in DECISION_MAKER_TITLES)


def best_channel(phone, whatsapp, email) -> str:
    if phone:
        return "Phone"
    if whatsapp:
        return "WhatsApp"
    if email:
        return "Email"
    return ""


def labels_to_keys(labels) -> list[str]:
    """'Job Work / Machining; Sheet Metal' -> ['jobwork', 'sheet_metal']."""
    out = []
    for lab in labels:
        lab = clean_text(lab)
        for key, cat in rc.CATEGORIES.items():
            if cat["label"] == lab:
                out.append(key)
                break
    return out


def adjacency_for(tags: list[str]) -> list[dict]:
    """Demand-side adjacency, recomputed from the tag list.

    The workbook stores tags but not adjacency, so it is derived here from the
    same DEMAND_ADJACENCY rules the classifier used.
    """
    out = []
    for src, pairs in rc.DEMAND_ADJACENCY.items():
        if src not in tags:
            continue
        for dst, why in pairs:
            if dst not in tags:
                out.append({
                    "from": src,
                    "to": dst,
                    "why": why,
                    "from_label": rc.CATEGORIES[src]["label"],
                    "to_label": rc.CATEGORIES[dst]["label"],
                })
    return out


# --------------------------------------------------------------------------
# Workbook reading
# --------------------------------------------------------------------------

def read_sheet(path: Path, sheet: str) -> tuple[list[str], list[dict]]:
    if not path.exists():
        return [], []
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if sheet not in wb.sheetnames:
        wb.close()
        return [], []
    ws = wb[sheet]
    it = ws.iter_rows(values_only=True)
    hdr = [clean_text(h) for h in next(it, ())]
    rows = []
    for r in it:
        if r is None or all(v is None for v in r):
            continue
        rows.append({hdr[i]: r[i] for i in range(min(len(hdr), len(r)))})
    wb.close()
    return hdr, rows


def read_priority() -> dict[str, tuple[int, float]]:
    """Company name -> (rank, score) from the outreach board's Priority 100."""
    p = _ROOT / "Swaniki_Outreach_Board.xlsx"
    _, rows = read_sheet(p, "Priority 100")
    out = {}
    for r in rows:
        name = clean_text(r.get("Company"))
        if not name:
            continue
        try:
            rank = int(r.get("Rank") or 0)
            score = float(r.get("Score") or 0)
        except (TypeError, ValueError):
            continue
        if rank:
            out[norm_name(name)] = (rank, score)
    return out


# --------------------------------------------------------------------------
# Core import
# --------------------------------------------------------------------------

def upsert_company(session, rec: dict, stats: dict, ref: str, system: str = "") -> lm.Company | None:
    name = clean_text(rec.get("Company"))
    nn = norm_name(name)
    if not nn:
        stats["rows_rejected"] += 1
        stats["rejected_detail"].append({"ref": ref, "reason": "no company name"})
        return None

    what, band = parse_address(rec.get("Address"))
    tags = labels_to_keys(clean_text(rec.get("RFQClub Tags")).split(";"))
    primary = clean_text(rec.get("RFQClub Category"))
    primary_key = ""
    for key, cat in rc.CATEGORIES.items():
        if cat["label"] == primary:
            primary_key = key
            break
    tier_txt = clean_text(rec.get("Category Tier"))
    tier = 1 if tier_txt.startswith("Tier 1") else 2

    vals = dict(
        name=name,
        what_they_do=what,
        size_band=band,
        website=clean_text(rec.get("Website")),
        gmb_link=clean_text(rec.get("GMB Link")),
        country=clean_text(rec.get("Country (inferred)")),
        country_confidence=clean_text(rec.get("Country Confidence")),
        hub_city=clean_text(rec.get("Hub / City")),
        address=clean_text(rec.get("Address")),
        category_primary=primary_key,
        category_tags=tags,
        category_tier=tier,
        category_confidence=clean_text(rec.get("Category Confidence")),
        category_source=clean_text(rec.get("Tag Source")),
        category_rationale=clean_text(rec.get("Category Rationale")),
        legacy_category=clean_text(rec.get("Category") or rec.get("Primary Category")),
        adjacency=adjacency_for(tags),
        cin=clean_text(rec.get("CIN")),
        source_system=(system or "").strip() or "unknown",
        source_note=clean_text(rec.get("Data Source")),
        source_row_ref=ref,
    )
    try:
        vals["review_count"] = int(rec.get("Total count of reviews") or 0) or None
    except (TypeError, ValueError):
        vals["review_count"] = None
    try:
        vals["review_rating"] = float(rec.get("Review Rating") or 0) or None
    except (TypeError, ValueError):
        vals["review_rating"] = None

    existing = session.scalar(select(lm.Company).where(lm.Company.name_norm == nn))
    if existing is None:
        vals["name_norm"] = nn
        existing = lm.Company(**vals)
        session.add(existing)
        stats["companies_created"] += 1
    else:
        # Non-empty incoming value wins; blanks never overwrite real data.
        for k, v in vals.items():
            if v not in (None, "", []):
                setattr(existing, k, v)
        stats["companies_updated"] += 1
    return existing


def upsert_contact(session, company: lm.Company, rec: dict, stats: dict, ref: str):
    con_name, phone, email, wa = (clean_text(rec.get(k)) for k in
                                  ("Name", "Contact Number 1", "Email", "WhatsApp"))
    phone2 = clean_text(rec.get("Contact Number 2"))
    full = con_name
    if not any((full, phone, phone2, email, wa)):
        # NOT a rejection: the company and its lead are still created. This
        # sheet is company-grain (the Expansion effort has no named contact yet),
        # so the person is simply pending enrichment.
        stats["contacts_skipped_no_person"] += 1
        return

    con = session.scalar(
        select(lm.Contact).where(
            lm.Contact.company_id == company.id,
            lm.Contact.full_name == full,
            lm.Contact.phone_primary == phone,
        ))
    if con is not None:
        stats["duplicates_skipped"] += 1
        return

    desig = clean_text(rec.get("Designation"))
    con = lm.Contact(
        company_id=company.id,
        full_name=full,
        designation=desig,
        decision_maker=is_decision_maker(desig),
        email=email,
        phone_primary=phone,
        phone_secondary=phone2,
        whatsapp=wa,
        preferred_channel=best_channel(phone, wa, email),
        source_row_ref=ref,
    )
    session.add(con)
    stats["contacts_created"] += 1


def _untouched(session, lead: lm.Lead) -> bool:
    """True only for a lead no rep has ever touched.

    A lead is an artifact, not a work record, when it is still in the starting
    status, has no owner, carries no scheduling, and nothing in the activity,
    task or status-history tables points at it. Only such rows may be moved or
    removed by the importer - everything else belongs to a rep's history.
    """
    if lead.status != lm.DEFAULT_STATUS or lead.owner_id is not None:
        return False
    if lead.next_action_at or lead.wants_call_back_at or lead.last_contacted_at:
        return False
    for model in (lm.LeadActivity, lm.LeadTask, lm.LeadStatusHistory):
        if session.scalar(select(func.count()).select_from(model)
                          .where(model.lead_id == lead.id)):
            return False
    return True


def _adopt_stale_lead(session, company: lm.Company, track: str, stats: dict):
    """Reuse this company's existing lead instead of inserting a second one.

    A lead's `track` comes from its category's default_track, so when a re-tag
    moves a company between verticals the previous run's lead is left on a stale
    track and a plain insert would give the same company two queue entries - one
    of which no rep will ever claim. Two rows per company is legitimate only for
    a marketplace participant that both bids and posts, never for a workbook
    re-classification.
    """
    others = session.scalars(
        select(lm.Lead).where(lm.Lead.company_id == company.id,
                              lm.Lead.track != track).order_by(lm.Lead.id)
    ).all()
    if not others:
        return None

    worked = next((l for l in others if not _untouched(session, l)), None)
    if worked is not None:
        # A rep has put history on this lead. Do not rewrite its track and do not
        # add a competing row; just let the existing one carry the reconcile.
        stats["lead_track_conflicts"] += 1
        return worked

    lead, surplus = others[0], others[1:]
    lead.track = track
    stats["leads_retargeted"] += 1
    for extra in surplus:
        # Proven untouched above, so no activity/task/history references it.
        session.delete(extra)
        stats["lead_dupes_removed"] += 1
    return lead


# Only rows the workbook import itself created may be pruned. A lead planted by
# any other path is somebody's decision and is never touched here.
WORKBOOK_SOURCES = ("bns", "expansion")


def _prune_stale_tracks(session, company: lm.Company, keep: lm.Lead, track: str,
                        stats: dict) -> None:
    """Remove leftover second-track rows for one company.

    Reached when the company already has a lead on the correct track: any *other*
    untouched, import-created row for the same company is a relic of an earlier
    category that has since been re-tagged, not a marketplace dual-role. Leaving
    it means the same company shows up twice in the shared pool and the copy nobody
    claimed simply ages there.
    """
    for l in session.scalars(
            select(lm.Lead).where(lm.Lead.company_id == company.id,
                                  lm.Lead.id != keep.id)).all():
        if l.track == track or l.source not in WORKBOOK_SOURCES:
            continue
        if not _untouched(session, l):
            continue
        session.delete(l)
        stats["lead_dupes_removed"] += 1


def upsert_lead(session, company: lm.Company, rec: dict, stats: dict, priority: dict, system: str = ""):
    track = rc.CATEGORIES.get(company.category_primary, {}).get(
        "default_track", "supplier")
    src = clean_text(rec.get("Lead Status")).lower()
    status, excluded, excl_reason, disq_reason = lm.map_source_status(src)
    lead = session.scalar(select(lm.Lead).where(
        lm.Lead.company_id == company.id, lm.Lead.track == track))
    if lead is None:
        lead = _adopt_stale_lead(session, company, track, stats)
    if lead is not None:
        # Reconcile only TOWARDS the source of truth: a row the workbook has since
        # marked registry-dead or out-of-scope must not keep sitting in the rep
        # queue from an earlier import. Never widen, never touch a lead a rep has
        # already worked, so re-running the import stays a no-op.
        if excluded and not lead.excluded_from_sales:
            lead.excluded_from_sales = True
            lead.exclusion_reason = excl_reason
            if lead.status == lm.DEFAULT_STATUS:
                lead.status = status
            if disq_reason and not lead.disqualify_reason:
                lead.disqualify_reason = disq_reason
            stats["leads_reconciled"] += 1
        _prune_stale_tracks(session, company, lead, track, stats)
        stats["duplicates_skipped"] += 1
        return lead

    rank_score = priority.get(norm_name(company.name))
    lead = lm.Lead(
        company_id=company.id,
        track=track,
        status=status,
        excluded_from_sales=excluded,
        source=(system or "bns"),
        source_note=clean_text(rec.get("Data Source")),
    )
    # `exclusion_reason` means "hidden from the rep queue"; `disqualify_reason`
    # means "this lead is dead". They are different states and must not share a
    # column, otherwise a bad-data lead reads as out-of-geography. A registry-dead
    # row legitimately carries both.
    if excl_reason:
        lead.exclusion_reason = excl_reason
    if disq_reason:
        lead.disqualify_reason = disq_reason
    if rank_score:
        lead.priority_rank, lead.priority_score = rank_score
    session.add(lead)
    stats["leads_created"] += 1
    if excluded:
        stats["excluded_from_sales"] += 1
    return lead


def _blank_stats() -> dict:
    return {
        "rows_read": 0, "companies_created": 0, "companies_updated": 0,
        "contacts_created": 0, "contacts_skipped_no_person": 0,
        "leads_created": 0, "duplicates_skipped": 0,
        "leads_reconciled": 0,
        "leads_retargeted": 0, "lead_dupes_removed": 0, "lead_track_conflicts": 0,
        "rows_rejected": 0, "rejected_detail": [], "excluded_from_sales": 0,
    }


def run(dry: bool = False, expansion: bool = True, note: str = "") -> dict:
    db.init_db()
    session = SessionLocal()
    stats = _blank_stats()
    batches: list[lm.ImportBatch] = []
    try:
        sources = [(config.SOURCE_XLSX, "All Contacts", "bns")]
        if expansion:
            sources.append((_ROOT / "Swaniki_Expansion_Database.xlsx",
                            "Expansion Contacts", "expansion"))

        for path, sheet, system in sources:
            hdr, rows = read_sheet(Path(path), sheet)
            if not rows:
                print("  -- %s / %s: no rows, skipped" % (Path(path).name, sheet))
                continue
            stats["rows_read"] += len(rows)
            priority = read_priority()
            st = _blank_stats()
            st["rows_read"] = len(rows)
            # Remote DBs drop long transactions: running this against hosted
            # Neon from a desk machine is a multi-minute bulk load over a WAN,
            # and `pool_pre_ping` only validates a connection at *checkout*, not
            # mid-transaction - so one pooler kill used to abort the entire pass.
            # Keep each transaction short, remember the last durably committed
            # row, and on a connection-layer failure reconnect and resume from
            # that boundary. Idempotent upserts make re-doing the torn chunk free.
            CHUNK = 100 if db.sqlite_only else 50
            MAX_RESUMES = 40
            resumes = 0
            # `idx` indexes rows[]; the sheet row number is idx+2 (row 1 is the
            # header). Keeping the two apart matters: bounding the loop by
            # len(rows) while starting the sheet row at 2 silently skips the
            # LAST row of every sheet - which is exactly how one harvested
            # company failed to reach the hosted database.
            n = len(rows)
            safe_idx = -1                 # last durably committed row index
            idx = 0
            while idx < n:
                i = idx + 2               # sheet row, for the provenance ref
                try:
                    rec = rows[idx]
                    ref = "%s!%s:%d" % (system, sheet, i)
                    company = upsert_company(session, rec, st, ref, system=system)
                    if company is not None:
                        session.flush()  # need company.id before contacts/lead
                        upsert_contact(session, company, rec, st, ref)
                        upsert_lead(session, company, rec, st, priority,
                                    system=system)
                    if not dry and (i % CHUNK) == 0:
                        session.commit()
                        safe_idx = idx      # everything up to here is durable
                        # A hosted load from a desk machine takes tens of
                        # minutes, and the per-source line only prints at the
                        # end of the sheet - so without a heartbeat an import
                        # that is merely slow looks exactly like one that is
                        # hung. Say which row we are on.
                        if i % (CHUNK * 10) == 0:
                            print("  ... %s row %d/%d" % (system, i, n + 1),
                                  flush=True)
                    idx += 1
                except (OperationalError, InterfaceError, InternalError) as e:
                    resumes += 1
                    # Only a remote DB loses a connection mid-transaction. On
                    # local SQLite an OperationalError means "database is
                    # locked" or bad SQL, and resuming would silently loop
                    # around the same failure 40 times instead of reporting it.
                    if db.sqlite_only or resumes > MAX_RESUMES:
                        raise SystemExit(
                            "database failed at row %d of %s (%s: %s) - after %d "
                            "resume(s); re-run import_leads.py, it is idempotent"
                            % (i, system, type(e).__name__, e, resumes))
                    session.rollback()
                    session.close()
                    db.engine.dispose()      # drop every dead pooled handle
                    session = SessionLocal()
                    if dry:
                        # a dry pass keeps ONE open transaction, so a drop loses
                        # every dedupe learnt so far; restarting mid-sheet would
                        # report double-counted creates. Restart the source.
                        st = _blank_stats()
                        st["rows_read"] = len(rows)
                        safe_idx, idx = -1, 0
                        print("  !! connection dropped - restarting %s (dry run "
                              "has no durable state)" % system)
                    else:
                        print("  !! connection dropped at row %d - resuming from %d"
                              % (i, safe_idx + 3))
                        idx = safe_idx + 1
            if not dry:
                session.commit()
            else:
                session.flush()
            for k, v in st.items():
                if k not in ("rejected_detail",):
                    stats[k] += v
                else:
                    stats[k].extend(v[:50])
            batches.append(lm.ImportBatch(
                source_file=Path(path).name, sheet=sheet,
                rows_read=st["rows_read"],
                companies_created=st["companies_created"],
                companies_updated=st["companies_updated"],
                contacts_created=st["contacts_created"],
                leads_created=st["leads_created"],
                duplicates_skipped=st["duplicates_skipped"],
                rows_rejected=st["rows_rejected"],
                rejected_detail=(st["rejected_detail"][:50] + [
                    {"count": st["contacts_skipped_no_person"],
                     "reason": "company-grain row, decision-maker pending enrichment"}
                ] if st["contacts_skipped_no_person"] else []),
                excluded_from_sales=st["excluded_from_sales"],
                dry_run=dry, run_by="cli:" + (note or "phase1"),
            ))
            print("  %-14s %-20s rows=%-5d companies+%d  contacts+%d  leads+%d  dupes=%d"
                  % (system, sheet, st["rows_read"], st["companies_created"],
                     st["contacts_created"], st["leads_created"],
                     st["duplicates_skipped"]))
            if st["leads_reconciled"]:
                print("  %-14s   -> %d existing lead(s) hidden because the workbook "
                      "now marks them dead / out of scope"
                      % ("", st["leads_reconciled"]))

        if dry:
            session.rollback()
        else:
            for b in batches:
                session.add(b)
            session.commit()
            stats["batch_ids"] = [b.id for b in batches]
    finally:
        session.close()
    return stats


def report(session) -> None:
    from sqlalchemy import func

    def count(*where):
        q = select(func.count()).select_from(lm.Lead)
        for w in where:
            q = q.where(w)
        return session.scalar(q) or 0

    n_comp = session.scalar(select(func.count()).select_from(lm.Company)) or 0
    n_con = session.scalar(select(func.count()).select_from(lm.Contact)) or 0
    print("\n  companies=%d  contacts=%d  leads=%d" % (n_comp, n_con, count()))

    print("\n  leads by stage:")
    for s in lm.STATUSES:
        print("    %-20s %5d" % (s, count(lm.Lead.status == s)))

    print("\n  leads by track:")
    for t in lm.TRACKS:
        print("    %-20s %5d" % (t, count(lm.Lead.track == t)))

    excl = count(lm.Lead.excluded_from_sales.is_(True))
    print("\n  excluded from sales  %5d  (retained, hidden from rep queue)" % excl)

    # A lead is callable only if its company has a reachable contact.
    callable_leads = count(
        lm.Lead.excluded_from_sales.is_(False),
        lm.Lead.company_id.in_(
            select(lm.Company.id).join(lm.Contact).where(
                (lm.Contact.phone_primary != "") | (lm.Contact.email != "")
                | (lm.Contact.whatsapp != "")).distinct()
        ),
    )
    print("  rep-callable leads   %5d  (valid + reachable contact)" % callable_leads)

    print("\n  tier-1 leads by category (excluded hidden):")
    for key in ("packaging", "jobwork", "fasteners"):
        c = session.scalar(
            select(func.count())
            .select_from(lm.Lead)
            .join(lm.Company, lm.Lead.company_id == lm.Company.id)
            .where(lm.Company.category_primary == key)
            .where(lm.Lead.excluded_from_sales.is_(False))) or 0
        print("    %-12s %5d" % (key, c))

    print("\n  companies by primary category (excluded hidden):")
    rows = session.execute(
        select(lm.Company.category_primary, func.count())
        .select_from(lm.Company)
        .join(lm.Lead, lm.Lead.company_id == lm.Company.id)
        .where(lm.Lead.excluded_from_sales.is_(False))
        .group_by(lm.Company.category_primary)
        .order_by(func.count().desc())).all()
    for key, n in rows:
        label = rc.CATEGORIES[key]["label"] if key in rc.CATEGORIES else (key or "?")
        print("    %-12s %5d  %s" % (key or "?", n, label))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--no-expansion", action="store_true")
    ap.add_argument("--batch-note", default="")
    a = ap.parse_args()

    print("import_leads  dry=%s  expansion=%s" % (a.dry, not a.no_expansion))
    stats = run(dry=a.dry, expansion=not a.no_expansion, note=a.batch_note)

    print("\n  rows_read            %5d" % stats["rows_read"])
    print("  companies_created    %5d" % stats["companies_created"])
    print("  companies_updated    %5d" % stats["companies_updated"])
    print("  contacts_created     %5d" % stats["contacts_created"])
    print("  pending a person     %5d  (company+lead created, no contact yet)"
          % stats["contacts_skipped_no_person"])
    print("  leads_created        %5d" % stats["leads_created"])
    print("  duplicates_skipped   %5d" % stats["duplicates_skipped"])
    print("  rows_rejected        %5d" % stats["rows_rejected"])
    print("  excluded_from_sales  %5d" % stats["excluded_from_sales"])
    print("  leads_reconciled     %5d  (existing leads tightened from the workbook)"
          % stats["leads_reconciled"])
    if stats["leads_retargeted"] or stats["lead_dupes_removed"] \
            or stats["lead_track_conflicts"]:
        print("  leads_retargeted     %5d  (category re-tag moved them to the new "
              "track instead of duplicating)" % stats["leads_retargeted"])
        print("  duplicate rows cut   %5d  (untouched second-lead artifacts)"
              % stats["lead_dupes_removed"])
        print("  track conflicts      %5d  (a worked lead was left alone)"
              % stats["lead_track_conflicts"])

    if not a.dry:
        session = SessionLocal()
        try:
            report(session)
        finally:
            session.close()
    print("\n%s" % ("DRY RUN - database unchanged" if a.dry else "committed"))


if __name__ == "__main__":
    main()
