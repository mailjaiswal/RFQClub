"""Part 7 apply: append the harvested registry peers (p7_harvest.json) into
Swaniki_Expansion_Database.xlsx as Level-1 rows.

Honours the standing pipeline rules:
  - APPEND-ONLY, never overwrites an existing cell.
  - Deduped against expansion rows AND the whole main DB, by normalised company
    name and by CIN, so a re-run adds nothing.
  - Honest provenance: Level / Hop / Discovered From / Data Source carry the
    directory, the seed it pivoted from, the registry status and paid-up capital.
  - Registry-dead entities are kept but flagged (Lead Status "Dead - <status>",
    pink fill) exactly like the earlier batches.

One thing earlier batches could not do: ZaubaCorp's directory table wraps company
names mid-word ("PRIVATE LIMIT ED"). `fix_wrap` repairs those breaks by
re-joining adjacent tokens ONLY when the joined form is a word that already occurs
in our own databases - so the cleanup can never invent a name.
"""
import json, re, sys, argparse, datetime, openpyxl
from openpyxl.styles import PatternFill

from pipeline_paths import DATA_DIR, data

XLSX = str(data("Swaniki_Expansion_Database.xlsx"))
MAIN = str(data("BnS_Contacts_Database.xlsx"))
# the raw harvest is written by the sweep step before this runs, so it may not
# exist yet - point at it, never insist on it
RAW_PATH = str(DATA_DIR / "p7_harvest.json")
SHEET = "Expansion Contacts"
DEAD = ("strike", "struck", "striking", "liquidat", "amalgamat", "dissolve", "cirp")
# Odd-but-alive registry states: not dead, but the legal form changed, so a rep
# must not send a quotation addressed to a company that no longer exists as one.
CAUTION = ("converted to llp", "dormant")
LEGAL = re.compile(
    r"\b(PRIVATE\s+LIMITED|PVT\.?\s*LTD\.?|PVT|LTD\.?|LIMITED|LLP|CO|COMPANY)\b", re.I)


def norm(name):
    n = (name or "").upper()
    n = LEGAL.sub(" ", n)
    n = re.sub(r"[^A-Z0-9 ]", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def known_words():
    """Every ALL-CAPS token that appears in a company name we already hold.
    Used purely to decide whether two broken tokens can be safely rejoined."""
    words = set()
    for path, sheets in ((XLSX, (SHEET,)),
                         (MAIN, ("All Contacts", "Unique Companies"))):
        wb = openpyxl.load_workbook(path, read_only=True)
        for sh in sheets:
            if sh not in wb.sheetnames:
                continue
            ws = wb[sh]
            it = ws.iter_rows(values_only=True)
            hdr = [str(h or "") for h in next(it)]
            ci = hdr.index("Company") if "Company" in hdr else None
            if ci is None:
                continue
            for row in it:
                for tok in re.findall(r"[A-Z]{2,}", str(row[ci] or "")):
                    words.add(tok)
        wb.close()
    return words


def fix_wrap(name, words):
    """Rejoin 'LIMIT ED' -> 'LIMITED' when the merged token is a real word here."""
    out, i, toks = [], 0, name.split()
    while i < len(toks):
        if (i + 1 < len(toks) and toks[i].isalpha() and toks[i + 1].isalpha()
                and len(toks[i]) > 1 and len(toks[i + 1]) <= 4
                and toks[i] + toks[i + 1] in words
                and not toks[i].endswith(".") and toks[i + 1].isupper()):
            out.append(toks[i] + toks[i + 1])
            i += 2
            continue
        out.append(toks[i])
        i += 1
    return " ".join(out)


def confidence(status, paidup):
    if any(d in status.lower() for d in DEAD):
        return 40
    try:
        # ZaubaCorp prints paid-up with thousands separators; a bare int() would
        # raise, land in the except arm and silently degrade the row to 55.
        p = int(str(paidup or 0).replace(",", "").strip())
    except ValueError:
        p = 0
    if p >= 100_000_000:      # >= INR 10 crore
        return 70
    if p >= 10_000_000:       # >= INR 1 crore
        return 65
    if p >= 1_000_000:        # >= INR 10 lakh
        return 60
    return 55


def main(dry=False, raw_path=RAW_PATH):
    raw = json.load(open(raw_path, encoding="utf-8"))
    dirs, rows = raw["meta"]["directories"], raw["rows"]
    words = known_words()

    wb = openpyxl.load_workbook(XLSX)
    ws = wb[SHEET]
    col = {h: i + 1 for i, h in enumerate([c.value for c in ws[1]])}

    exp_names, exp_cins = set(), set()
    for r in range(2, ws.max_row + 1):
        co = str(ws.cell(row=r, column=col["Company"]).value or "").strip()
        cin = str(ws.cell(row=r, column=col["CIN"]).value or "").strip().upper()
        if co:
            exp_names.add(norm(co))
        if cin:
            exp_cins.add(cin)

    main_names = set()
    mb = openpyxl.load_workbook(MAIN, read_only=True)
    for sh in ("Unique Companies", "All Contacts"):
        if sh not in mb.sheetnames:
            continue
        s = mb[sh]
        it = s.iter_rows(values_only=True)
        hdr = [str(h or "") for h in next(it)]
        ci = hdr.index("Company") if "Company" in hdr else None
        if ci is None:
            continue
        for row in it:
            v = str(row[ci] or "").strip()
            if v:
                main_names.add(norm(v))
    mb.close()

    seen = exp_names | main_names
    next_idx = ws.max_row - 1
    added, fixed, dead, skip_name, skip_cin = [], 0, 0, 0, 0
    today = datetime.date.today().isoformat()

    for key, meta in dirs.items():
        seed, category, url = meta["seed"], meta["category"], meta["url"]
        level, hop = meta.get("level", raw["meta"].get("level", 1)), meta.get("hop", 1)
        nic, city = key.split("/")
        for row in rows.get(key, []):
            raw_name = row["company"].strip()
            name = fix_wrap(raw_name, words)
            if name != raw_name:
                fixed += 1
            cin = (row.get("cin") or "").strip().upper()
            status = (row.get("status") or "").strip()
            if norm(name) in seen:
                skip_name += 1
                continue
            if cin and cin in exp_cins:
                skip_cin += 1
                continue
            seen.add(norm(name))
            if cin:
                exp_cins.add(cin)

            is_dead = any(d in status.lower() for d in DEAD)
            dead += 1 if is_dead else 0
            conf = confidence(status, row.get("paidup"))
            src = ("p7-L%d: ZaubaCorp %s x %s (seed: %s) | status %s | "
                   "paidup INR %s | %s"
                   % (level, nic, city, seed, status or "?",
                      row.get("paidup") or "?", url))
            for warn in CAUTION:
                if warn in status.lower():
                    src += " | REVIEW: registry status '%s' - verify the legal "\
                           "form before addressing an enquiry" % status

            next_idx += 1
            r = next_idx + 1
            vals = {
                "#": next_idx, "Category": category, "Company": name,
                "Country (inferred)": "India", "Country Confidence": 100,
                "Verified": "MCA (CIN)" + (" - " + status if is_dead else ""),
                "Hub / City": row.get("city", ""),
                "Outreach Status": "Not Contacted", "Data Source": src,
                "Enriched Date": today,
                "Lead Status": ("Dead - " + status) if is_dead else "Valid Lead",
                "Lead Confidence": conf, "CIN": cin,
                "Level": level, "Discovered From": seed, "Hop": hop,
            }
            if dry:
                added.append((name, category, status, conf))
                continue
            for cname, cval in vals.items():
                if cname in col and cval not in (None, ""):
                    ws.cell(row=r, column=col[cname], value=cval)
            if is_dead:
                fill = PatternFill("solid", fgColor="FBD5D5")
                for c in range(1, ws.max_column + 1):
                    ws.cell(row=r, column=c).fill = fill
            added.append((name, category, status, conf))

    print(f"p7 harvest: {sum(len(v) for v in rows.values())} registry rows read | "
          f"{fixed} name wrap-breaks repaired")
    print(f"  NEW to append : {len(added)}  ({dead} registry-dead, flagged)")
    print(f"  skipped        : {skip_name} name-dupes, {skip_cin} cin-dupes")
    if dry:
        print("\nDRY RUN - workbook unchanged. First 12 appends:")
        for a in added[:12]:
            print("   ", a)
        return
    wb.save(XLSX)
    print(f"\nExpansion sheet now has {ws.max_row - 1} data rows.")
    from collections import Counter
    print("by category:", dict(Counter(a[1] for a in added).most_common()))
    print("by confidence:", dict(sorted(Counter(a[3] for a in added).items())))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--raw", default=RAW_PATH,
                    help="harvest JSON (default p7_harvest.json; use "
                         "p7_harvest2.json for the next daily sweep)")
    a = ap.parse_args()
    main(dry=a.dry, raw_path=a.raw)
