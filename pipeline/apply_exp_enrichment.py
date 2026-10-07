"""Apply contact-enrichment batches to Swaniki_Expansion_Database.xlsx.

The BnS applier (apply_enrichment.py) targets the main workbook; the newer
registry harvests live in the expansion workbook, so this is the same job for
that sheet with stricter rules:

  - FILL-BLANK-ONLY. A cell that already holds a value is never overwritten.
  - Data Source is an append-only provenance chain: the harvest line stays and
    the contact source is appended, so every value remains traceable.
  - Lead Confidence may rise, never fall.
  - Only the fields present in the batch record are touched.
  - `found: 0` records write no channel at all - the applier refuses phone/email/
    website even if the batch carries them - and only mark that the public web was
    searched on this date, so the next pass does not repeat the same dead end.
  - `out_of_scope: <reason>` demotes the row's Lead Status to `Out of scope - ...`
    so `import_leads` hides it from the rep queue. Research passes had been writing
    "DROP - ..." flags for years and they did nothing: the flag only ever reached
    the Data Source text, so the row stayed `Valid Lead` and kept being dialled.
    The write is guarded - it may only replace `Valid Lead`/blank, never a
    `Dead - ...` status (which is a stronger, registry-confirmed claim) and never
    resurrect a row a human has already retired.
  - `category: <registry label>` records a sector that research PROVED, in the new
    `Category (Researched)` column, which `apply_rfq_categories.py` treats as an
    override. Without it a verdict only exists in the Data Source text: the
    harvested `Category` value is inherited from whichever cluster the company was
    found in, and the keyword pass then tags from that guess - so pump makers and a
    coin mint were reaching reps as "Foundry & Casting". The label must be one of
    the registry's own, or the write is refused: a typo would create a category the
    importer cannot map to a track. It is fill-blank-only too - a second pass that
    disagrees is reported, never silently applied.

Usage:  python apply_exp_enrichment.py [--dry] [batch.json ...]
"""
import glob, json, os, re, sys, datetime, argparse
from copy import copy
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rfq_categories as rc            # the single source of valid labels
from pipeline_paths import ENRICH_DIR, data

XLSX = str(data("Swaniki_Expansion_Database.xlsx"))
SHEET = "Expansion Contacts"

FIELD_MAP = {  # batch key -> sheet column
    "website": "Website", "phone1": "Contact Number 1", "phone2": "Contact Number 2",
    "whatsapp": "WhatsApp", "email": "Email", "address": "Address",
    "city": "Hub / City", "gmb": "GMB Link", "name": "Name",
    "designation": "Designation",
}
CHANNEL_FIELDS = ("website", "phone1", "phone2", "whatsapp", "email")
# Lead Status values an `out_of_scope` verdict is allowed to replace. Anything
# else ("Dead - ...", a human's own note) is left exactly as found.
REPLACEABLE_STATUS = ("", "valid lead", "new lead", "ambiguous")
# Researched-sector override column, created on first use.
OVERRIDE_COL = "Category (Researched)"
REGISTRY_LABELS = {c["label"] for c in rc.CATEGORIES.values()}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def main(paths, dry=False):
    records = []
    for p in paths:
        records += json.load(open(p, encoding="utf-8"))
    by_company = {norm(r["company"]): r for r in records}

    wb = openpyxl.load_workbook(XLSX)
    ws = wb[SHEET]
    col = {c.value: i + 1 for i, c in enumerate(ws[1])}
    if OVERRIDE_COL not in col:                    # created even in a dry run:
        c = ws.cell(row=1, column=ws.max_column + 1, value=OVERRIDE_COL)
        src = ws.cell(row=1, column=col["Company"])  # nothing is saved unless
        c.font, c.fill, c.alignment = copy(src.font), copy(src.fill), copy(src.alignment)
        col[OVERRIDE_COL] = c.column                # the caller runs --dry=false
    today = datetime.date.today().isoformat()

    matched, wrote_channel, appended_ds, raised, demoted = {}, 0, 0, 0, 0
    categorized = 0
    blocked = []
    for r in range(2, ws.max_row + 1):
        key = norm(ws.cell(row=r, column=col["Company"]).value or "")
        rec = by_company.get(key)
        if not rec:
            continue
        matched[key] = r
        got = False
        reachable = bool(rec.get("found", 1))
        for jk, hdr in FIELD_MAP.items():
            val = str(rec.get(jk) or "").strip()
            if not val or hdr not in col:
                continue
            # A found:0 record must never smuggle a channel in: an unverified or
            # deliberately withheld number/email makes the row 'rep-callable' and
            # burns a call. Address / person / Maps link are still fine to keep.
            if not reachable and jk in CHANNEL_FIELDS:
                continue
            cell = ws.cell(row=r, column=col[hdr])
            if cell.value not in (None, ""):          # never overwrite
                continue
            if not dry:
                cell.value = val
            if jk in CHANNEL_FIELDS:
                got = True
            wrote_channel += 1

        oos = str(rec.get("out_of_scope") or "").strip()
        if oos and "Lead Status" in col:
            cell = ws.cell(row=r, column=col["Lead Status"])
            cur = str(cell.value or "").strip()
            if cur.lower() in REPLACEABLE_STATUS:
                demoted += 1
                if not dry:
                    cell.value = "Out of scope - " + oos
            elif cur.lower().startswith(("dead", "out of scope")):
                pass                      # already retired, keep the stronger claim
            else:
                blocked.append((rec["company"], cur))

        # Researched sector. Validated against the registry so a bad label can
        # never reach the tagger, and fill-blank-only so two passes that
        # disagree surface as a conflict instead of silently flipping the row.
        cat = str(rec.get("category") or "").strip()
        cat_line = ""
        if cat:
            if cat not in REGISTRY_LABELS:
                blocked.append((rec["company"], "category %r is not a registry label"
                                % cat))
            else:
                cur = str(ws.cell(row=r, column=col[OVERRIDE_COL]).value or "").strip()
                if cur and cur != cat:
                    blocked.append((rec["company"],
                                    "already researched as %r, batch says %r" % (cur, cat)))
                elif not cur:
                    categorized += 1
                    if not dry:
                        ws.cell(row=r, column=col[OVERRIDE_COL], value=cat)
                    cat_line = "category (researched %s): %s" % (today, cat)

        old_ds = str(ws.cell(row=r, column=col["Data Source"]).value or "")
        src = str(rec.get("source") or "").strip()
        add = []
        if cat_line and cat_line not in old_ds:
            add.append(cat_line)
        if src and norm(src) not in norm(old_ds):
            add.append("contact %s: %s" % (today, src))
        if rec.get("flag") and rec["flag"] not in old_ds:
            add.append(rec["flag"])
        if not rec.get("found", 1) and "no public contact found" not in old_ds:
            add.append("no public contact found (checked %s)" % today)
        if add:
            appended_ds += 1
            if not dry:
                ws.cell(row=r, column=col["Data Source"],
                        value=(old_ds + " | " if old_ds else "") + " | ".join(add))

        want = rec.get("conf")
        cur = ws.cell(row=r, column=col["Lead Confidence"]).value
        if want and (cur in (None, "") or int(want) > int(cur)):
            raised += 1
            if not dry:
                ws.cell(row=r, column=col["Lead Confidence"], value=int(want))
        if got and not dry:
            ws.cell(row=r, column=col["Enriched Date"], value=today)
            v = str(ws.cell(row=r, column=col["Verified"]).value or "")
            if "public web" not in v.lower():
                ws.cell(row=r, column=col["Verified"],
                        value=(v + " + " if v else "") + "public web (site/listing)")

    miss = [r["company"] for r in records if norm(r["company"]) not in matched]
    print("batch records : %d | matched : %d | not in sheet : %d"
          % (len(records), len(matched), len(miss)))
    print("values written: %d (fill-blank only) | Data Source appended: %d "
          "| confidence raised: %d | out of scope: %d | researched categories: %d"
          % (wrote_channel, appended_ds, raised, demoted, categorized))
    if blocked:
        print("NOT applied (unrecognised status / disputed or invalid category):",
              blocked)
    if miss:
        print("NOT matched:", miss)
    if dry:
        print("\nDRY RUN - workbook unchanged")
        return
    wb.save(XLSX)
    print("\nsaved", os.path.basename(XLSX))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("paths", nargs="*")
    a = ap.parse_args()
    default = sorted(glob.glob(os.path.join(str(ENRICH_DIR), "p7_exp_*.json")))
    main(a.paths or default, dry=a.dry)
