"""Part 7 daily worklist: which harvested leads still need research.

Reads Swaniki_Expansion_Database.xlsx, takes the rows the p7 registry sweep
appended that are still Valid Lead (i.e. not registry-dead), removes the ones an
enrichment batch has already researched, and prints / writes the remaining
targets biggest paid-up capital first.

`--sectors` answers a different question. The harvest copies the sector of
whichever cluster a company was found in onto `Category`, so a pump maker or a
coin mint can arrive labelled "Foundry and Casting". Those rows are already
contact-researched and dialable, so the normal queue never shows them - yet a rep
is calling them on a guess. This lists the live, callable rows whose harvested
sector has no support in the company's own name, biggest paid-up first, for a
verdict that `apply_exp_enrichment.py` writes into `Category (Researched)`.

Read-only except for the worklist file it writes (p7_active.json).

Usage:  python p7_worklist.py [--all] [--sectors]   (--all keeps researched rows in)
"""
import argparse, glob, json, os, re
import openpyxl

from pipeline_paths import ENRICH_DIR, data, out

XLSX = str(data("Swaniki_Expansion_Database.xlsx"))
OUT = str(out("p7_active.json"))
OUT_SECTOR = str(out("p7_sector.json"))

CHANNEL_COLS = ("Contact Number 1", "Contact Number 2", "Email", "WhatsApp", "Website")
# A harvested sector that its own words do not support is one to go and check.
SECTOR_TOKEN = {
    "Foundry and Casting": r"foundr|cast|mould|mold|smelt|steel|iron|alloy|forge|precis",
    "Automotive Parts": r"auto|motor|vehicle|automobile|parts|component|engineering",
    "Metal Sheet Work": r"sheet|metal|fabricat|steel|pipe|tube|structur|works",
    "Electrical Panels": r"elec|panel|switchgear|switch|power|energy|electr",
    "CNC Job Work": r"cnc|machin|job|works|engineering|precision|tool",
    "Packaging": r"pack|paper|board|print|carton|box|film|plastic|sack|bag",
    "Fasteners / Hardware": r"fasten|bolt|nut|screw|hardware|fittings|rivet|stamp",
}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def researched():
    """Companies an enrichment batch has already looked at (found or not)."""
    done = set()
    for p in sorted(glob.glob(os.path.join(str(ENRICH_DIR), "p7_exp_*.json"))):
        for rec in json.load(open(p, encoding="utf-8")):
            done.add(norm(rec["company"]))
    return done


def sector_queue():
    """Live + callable rows whose harvested sector is only a cluster guess."""
    ws = openpyxl.load_workbook(XLSX, read_only=True)["Expansion Contacts"]
    it = ws.iter_rows(values_only=True)
    ix = {h: i for i, h in enumerate(str(x or "") for x in next(it))}
    rows = []
    for r in it:
        name = str(r[ix["Company"]] or "").strip()
        if not name:
            continue
        status = str(r[ix["Lead Status"]] or "").strip().lower()
        if status.startswith(("dead", "out of scope")):
            continue                                    # already retired
        if ix.get("Category (Researched)") is not None and str(
                r[ix["Category (Researched)"]] or "").strip():
            continue                                    # verdict already recorded
        if not any(str(r[ix[c]] or "").strip() for c in CHANNEL_COLS
                   if ix.get(c) is not None):
            continue                                    # not dialable, not urgent
        guess = str(r[ix["Category"]] or "").strip()
        pat = SECTOR_TOKEN.get(guess)
        if pat is None:                                 # unknown label: check it too
            unproven = True
        else:
            unproven = not re.search(pat, name, re.I)
        if not unproven:
            continue
        m = re.search(r"paidup INR ([0-9]+)", str(r[ix["Data Source"]] or ""))
        rows.append({"paidup": int(m.group(1)) if m else 0, "company": name,
                     "harvested_category": guess,
                     "tagged_as": str(r[ix["RFQClub Category"]] or ""),
                     "city": str(r[ix["Hub / City"]] or ""),
                     "cin": str(r[ix["CIN"]] or ""),
                     "cluster": str(r[ix["Discovered From"]] or "")[:60]})
    rows.sort(key=lambda x: -x["paidup"])
    json.dump(rows, open(OUT_SECTOR, "w", encoding="utf-8"), indent=1)
    return rows


def main(show_all=False):
    ws = openpyxl.load_workbook(XLSX, read_only=True)["Expansion Contacts"]
    it = ws.iter_rows(values_only=True)
    ix = {h: i for i, h in enumerate(str(x or "") for x in next(it))}
    rows, skipped = [], 0
    for r in it:
        src = str(r[ix["Data Source"]] or "")
        if not src.startswith("p7-"):
            continue
        if str(r[ix["Lead Status"]] or "").lower().startswith("dead"):
            continue                                    # registry-dead: never work it
        name = str(r[ix["Company"]] or "")
        if not show_all and norm(name) in researched():
            skipped += 1
            continue
        m = re.search(r"paidup INR ([0-9]+)", src)
        rows.append({"paidup": int(m.group(1)) if m else 0, "company": name,
                     "category": str(r[ix["Category"]] or ""),
                     "city": str(r[ix["Hub / City"]] or ""),
                     "cin": str(r[ix["CIN"]] or ""),
                     "conf": str(r[ix["Lead Confidence"]] or "")})
    rows.sort(key=lambda x: -x["paidup"])
    json.dump(rows, open(OUT, "w", encoding="utf-8"), indent=1)

    print("p7 rows still to research: %d  (%d already covered by an enrichment "
          "batch - pass --all to see them)" % (len(rows), skipped))
    print("wrote %s" % os.path.basename(OUT))
    print("\n%-11s %-50s %-22s %-11s %s"
          % ("Paid-up INR", "Company", "Category", "City", "Conf"))
    for x in rows[:30]:
        print("%-11d %-50s %-22s %-11s %s"
              % (x["paidup"], x["company"][:50], x["category"][:22],
                 x["city"][:11], x["conf"]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true",
                    help="include companies an enrichment batch already checked")
    ap.add_argument("--sectors", action="store_true",
                    help="list live callable rows whose harvested sector is unproven")
    a = ap.parse_args()
    if a.sectors:
        q = sector_queue()
        print("rows to sector-verify (live, dialable, no researched verdict): %d"
              % len(q))
        print("wrote %s" % os.path.basename(OUT_SECTOR))
        print("\n%-11s %-44s %-22s %-22s %s"
              % ("Paid-up INR", "Company", "Harvested as", "Tagged as", "City"))
        for x in q[:30]:
            print("%-11d %-44s %-22s %-22s %s"
                  % (x["paidup"], x["company"][:44], x["harvested_category"][:22],
                     x["tagged_as"][:22], x["city"][:16]))
    else:
        main(a.all)
