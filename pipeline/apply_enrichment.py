"""Apply manual web-search enrichment batches (JSON in ./enrichment/) to the DB.
Each batch record fills ONLY the fields it provides (blank = leave untouched).
Re-runnable: skips companies already having a Website/phone so you never re-do work.

  - `out_of_scope: <reason>` retires a row that research proved is not workable -
    a name fragment with no channel, a company that cannot be resolved to a real
    unit. It writes `Lead Status`, which the importer turns into "hidden from the
    rep queue, retained in the database". Without it the only honest verdict
    available was the `Nothing found` text in Data Source, and such rows kept
    showing up in the shared pool as dialable leads with no name and no sector.
    Guarded: it may replace a live-looking status only, never `Dead - ...` (a
    stronger, registry-confirmed claim) and never a row already retired.

Usage:  python apply_enrichment.py [--dry] [batch.json ...]
"""
import os, re, glob, json, datetime, argparse
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

from pipeline_paths import ENRICH_DIR as _ENRICH, data

XLSX = str(data("BnS_Contacts_Database.xlsx"))
ENRICH_DIR = str(_ENRICH)
SHEET = "All Contacts"
STATUS_COL = "Lead Status"
# statuses an `out_of_scope` verdict is allowed to replace - all of them mean
# "nobody has worked this row yet"
RETIRABLE = ("", "valid lead", "nothing found", "not contacted",
             "new", "open", "in progress")

FIELD_MAP = {  # json key -> column header
    "website": "Website",
    "phone1": "Contact Number 1",
    "phone2": "Contact Number 2",
    "whatsapp": "WhatsApp",
    "address": "Address",
    "city": "Hub / City",
    "email": "Email",
    "gmb": "GMB Link",
    "reviews": "Total count of reviews",
    "rating": "Review Rating",
    "source": "Data Source",
}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def main(paths=None, dry=False):
    records = []
    for path in (paths or sorted(glob.glob(os.path.join(ENRICH_DIR, "*.json")))):
        records += json.loads(open(path, encoding="utf-8").read())
    by_company = {}
    for r in records:
        by_company[norm(r.get("company", ""))] = r

    wb = openpyxl.load_workbook(XLSX)
    ws = wb[SHEET]
    hdr = [c.value for c in ws[1]]
    col = {h: i + 1 for i, h in enumerate(hdr)}

    # ensure extra columns exist
    for extra in ("Email", "Data Source", "Enriched Date", "WhatsApp"):
        if extra not in col:
            idx = ws.max_column + 1
            cell = ws.cell(row=1, column=idx, value=extra)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="375623")
            cell.alignment = Alignment(horizontal="center", vertical="center")
            col[extra] = idx

    company_col = col["Company"]
    updated = retired = 0
    blocked = []
    matched_names = set()
    today = datetime.date.today().isoformat()
    for r in range(2, ws.max_row + 1):
        d = by_company.get(norm(ws.cell(row=r, column=company_col).value or ""))
        if not d:
            continue
        matched_names.add(norm(d.get("company", "")))
        for jk, hdr_name in FIELD_MAP.items():
            val = (d.get(jk) or "").strip()
            if hdr_name in col:
                if val == "«clear»":
                    ws.cell(row=r, column=col[hdr_name]).value = None
                elif val:
                    ws.cell(row=r, column=col[hdr_name], value=val)
        # retirement is the one write that changes a row's fate, so it is guarded
        oos = str(d.get("out_of_scope") or "").strip()
        if oos:
            cell = ws.cell(row=r, column=col[STATUS_COL])
            cur = str(cell.value or "").strip()
            if cur.lower().startswith(("dead", "out of scope")):
                blocked.append((d.get("company"), "already retired as %r" % cur))
            elif cur.lower() not in RETIRABLE:
                blocked.append((d.get("company"),
                                "status %r is a rep's call, not ours to retire" % cur))
            else:
                retired += 1
                if not dry:
                    cell.value = "Out of scope - " + oos
        ws.cell(row=r, column=col["Enriched Date"], value=today)
        if oos and not dry:
            # keep the evidence that led to the retirement readable on the row
            ds = str(ws.cell(row=r, column=col["Data Source"]).value or "")
            line = "retired %s: %s" % (today, oos)
            if line not in ds:
                ws.cell(row=r, column=col["Data Source"],
                        value=(ds + " | " if ds else "") + line)
        updated += 1

    if not dry:
        wb.save(XLSX)
    not_matched = [r["company"] for r in records if norm(r.get("company", "")) not in matched_names]
    print(f"Batch records: {len(records)} | rows updated: {updated}"
          f" | retired out of scope: {retired}")
    for nm, why in blocked:
        print("   BLOCKED %s: %s" % (nm, why))
    if not_matched:
        print("NOT matched (company name not in sheet):", not_matched)
    if dry:
        print("DRY RUN - workbook unchanged")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("paths", nargs="*")
    a = ap.parse_args()
    main(a.paths or None, dry=a.dry)
