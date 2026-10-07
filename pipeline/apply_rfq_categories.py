"""Apply the RFQClub category registry to every lead/company/contact workbook.

Adds six columns to each lead-bearing sheet. Original source columns are never
modified, renamed or reordered -- the new columns are appended.

  RFQClub Category      primary tag (single)   -> filter on this
  RFQClub Tags          full tag list, ';' separated
  Category Tier         Tier 1 researched focus / Tier 2 legacy vertical
  Category Confidence   High / Medium / Low
  Tag Source            Keyword evidence / Legacy vertical / Researched override
  Category Rationale    which signals fired

A `Category (Researched)` column, written by the enrichment appliers when research
proved what a company actually makes, overrides everything below it. That column
exists because the harvested `Category` value is inherited from the cluster a
company was found in, not observed about the company - the keyword pass had been
tagging pump makers and a coin mint as "Foundry & Casting" off that guess, and
there was no way to write down a verdict that research had already reached.

Two extra sheets are written to BnS_Contacts_Database.xlsx:
  Category Registry     the taxonomy with its research axes
  Category Coverage     per-category counts + the demand-side adjacency view

Usage:  python apply_rfq_categories.py [--dry]
"""
from __future__ import annotations

import collections
import shutil
import sys
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rfq_categories as rc
from pipeline_paths import data

# The workbooks are data, not code: they stay outside the repo (see
# pipeline_paths.py) because they hold real phone numbers and emails.
BNS = data("BnS_Contacts_Database.xlsx")
EXPANSION = data("Swaniki_Expansion_Database.xlsx")
BOARD = data("Swaniki_Outreach_Board.xlsx")

NEW_COLS = [
    "RFQClub Category",
    "RFQClub Tags",
    "Category Tier",
    "Category Confidence",
    "Tag Source",
    "Category Rationale",
]

# Column a human/research verdict is written in. Read-only for the tagger.
OVERRIDE_COL = "Category (Researched)"
# Row values carry the tier *label* (rc.classify returns TIER_LABEL[tier]), so
# the override has to resolve through the same mapping.
LABEL_TIER = {cat["label"]: rc.TIER_LABEL[cat["tier"]]
              for cat in rc.CATEGORIES.values()}

HDR_FILL = PatternFill("solid", fgColor="1F2A44")
HDR_FONT = Font(bold=True, color="FFFFFF", size=10)

TIER_FILL = {
    "Tier 1 - Researched Focus": PatternFill("solid", fgColor="E8F0FE"),
    "Tier 2 - Legacy Vertical": PatternFill("solid", fgColor="F1F3F5"),
}

# Which sheets get categorized, and how to find the identifying columns.
#   key_col      -> company name
#   text cols    -> extra signal sources
#   legacy col   -> original category, used as fallback prior
SHEET_SPECS = {
    BNS: [
        ("All Contacts", dict(key="Company", legacy="Category",
                              signals=["Address", "Website"])),
        ("Unique Companies", dict(key="Company", legacy="Primary Category",
                                  signals=[])),
    ],
    EXPANSION: [
        ("Expansion Contacts", dict(key="Company", legacy="Category",
                                    signals=["Address", "Website"])),
    ],
    BOARD: [
        ("Outreach Board", dict(key="Company", legacy="Category",
                                signals=["Hub / City"])),
        ("Priority 100", dict(key="Company", legacy="Category", signals=[])),
    ],
}


def header_map(ws) -> dict[str, int]:
    return {
        (c.value or "").strip(): i
        for i, c in enumerate(next(ws.iter_rows(min_row=1, max_row=1)), start=1)
    }


def classify_sheet(ws, spec: dict, cache: dict) -> tuple[int, list]:
    """Classify every row on one sheet, using a shared per-company cache."""
    hm = header_map(ws)
    key_c = hm.get(spec["key"])
    leg_c = hm.get(spec["legacy"]) if spec["legacy"] else None
    ov_c = hm.get(OVERRIDE_COL)
    sig_c = [hm[s] for s in spec["signals"] if s in hm]
    if not key_c:
        raise SystemExit(f"[{ws.title}] column {spec['key']!r} not found")

    out = []
    bad_override = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[key_c - 1] is None:
            continue
        company = row[key_c - 1]
        legacy = row[leg_c - 1] if leg_c and row[leg_c - 1] else ""
        legacy = str(legacy).strip()
        if company not in cache:
            parts = [str(row[c - 1]) for c in sig_c
                     if c <= len(row) and row[c - 1]]
            cache[company] = rc.classify(
                company=str(company),
                address=" ".join(parts),
                website=" ".join(parts),
                legacy_category=legacy,
            )
        res = cache[company]
        source = ("Legacy vertical"
                  if res["rationale"].startswith("No keyword")
                  else "Keyword evidence")
        primary = res["primary_label"] or "Uncategorised"
        tags_label = res["tags_label"]
        tier = res["tier"]
        confidence = res["confidence"]
        rationale = res["rationale"]

        # A researched sector beats every signal the classifier has. Tags are
        # kept as secondary evidence, with the proven label moved to the front.
        ov = str(row[ov_c - 1] or "").strip() if ov_c and ov_c <= len(row) else ""
        if ov:
            if ov not in LABEL_TIER:
                bad_override.append((company, ov))     # never silently tag
            else:
                primary = ov
                tier = LABEL_TIER[ov]
                confidence = "High"
                source = "Researched override"
                rationale = ("Researched override - sector confirmed by research, "
                             "see Data Source")
                rest = [t for t in (tags_label or "").split("; ") if t and t != ov]
                tags_label = "; ".join([ov] + rest)
        out.append((
            primary,
            tags_label,
            tier,
            confidence,
            source,
            rationale,
            tier,
        ))
    if bad_override:
        print(f"  !! {ws.title}: {len(bad_override)} researched label(s) not in the "
              f"registry, ignored: {bad_override[:3]}")
    return len(out), out


def append_columns(ws, values: list) -> None:
    if NEW_COLS[0] in header_map(ws):
        # idempotent: clear the previously written block, then rewrite
        hm = header_map(ws)
        start = hm[NEW_COLS[0]]
        for r in range(2, ws.max_row + 1):
            for i in range(len(NEW_COLS)):
                ws.cell(row=r, column=start + i).value = None
    else:
        start = ws.max_column + 1
        for i, name in enumerate(NEW_COLS):
            c = ws.cell(row=1, column=start + i, value=name)
            c.fill = HDR_FILL
            c.font = HDR_FONT
            c.alignment = Alignment(vertical="center", wrap_text=True)

    tier_idx = NEW_COLS.index("Category Tier")
    for i, rec in enumerate(values, start=2):
        for j, v in enumerate(rec[:len(NEW_COLS)]):
            cell = ws.cell(row=i, column=start + j, value=v)
            cell.alignment = Alignment(vertical="top", wrap_text=(j == 5))
            fill = TIER_FILL.get(rec[tier_idx])
            if fill and j == tier_idx:
                cell.fill = fill


def build_registry_sheet(wb) -> None:
    name = "Category Registry"
    if name in wb.sheetnames:
        del wb[name]
    ws = wb.create_sheet(name)
    cols = ["Key", "Label", "Tier", "Spec Standardization", "Repeat Frequency",
            "Buyer Urgency", "Winning Edge", "Keyword Count"]
    ws.append(cols)
    for c in ws[1]:
        c.fill = HDR_FILL
        c.font = HDR_FONT
    for row in rc.registry_rows():
        ws.append([row["key"], row["label"], row["tier"],
                   row["spec_standardization"], row["repeat_frequency"],
                   row["buyer_urgency"], row["winning_edge"], row["keywords"]])
    widths = [14, 26, 26, 38, 24, 16, 62, 14]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def build_coverage_sheet(wb, stats: dict) -> None:
    name = "Category Coverage"
    if name in wb.sheetnames:
        del wb[name]
    ws = wb.create_sheet(name)
    ws.append(["RFQClub Category", "Tier", "Companies (primary)", "Share",
               "Companies (any tag)", "Tag Source = Keyword",
               "High", "Medium", "Low"])
    for c in ws[1]:
        c.fill = HDR_FILL
        c.font = HDR_FONT

    n = stats["total"] or 1
    for key, cat in rc.CATEGORIES.items():
        s = stats["by_category"].get(key, {})
        ws.append([
            cat["label"], rc.TIER_LABEL[cat["tier"]],
            s.get("primary", 0), f"{100 * s.get('primary', 0) / n:.1f}%",
            s.get("any", 0), s.get("keyword", 0),
            s.get("High", 0), s.get("Medium", 0), s.get("Low", 0),
        ])

    ws.append([])
    ws.append(["DEMAND-SIDE ADJACENCY (lead is a BUYER for the adjacent Tier 1 category)"])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True, size=11)
    ws.append(["From category", "Adjacent Tier 1 category", "Companies", "Why it matters"])
    for c in ws[ws.max_row]:
        c.font = Font(bold=True)
    for src, dst, n, why in stats["adjacency"]:
        ws.append([rc.CATEGORIES[src]["label"], rc.CATEGORIES[dst]["label"], n, why])

    ws.append([])
    ws.append(["TIER 1 GAP ANALYSIS"])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True, size=11)
    ws.append(["Tier 1 category", "Companies (primary)", "Verdict"])
    for c in ws[ws.max_row]:
        c.font = Font(bold=True)
    for key in ("packaging", "jobwork", "fasteners"):
        got = stats["by_category"].get(key, {}).get("primary", 0)
        verdict = ("NO COVERAGE - needs fresh lead-gen" if got < 25
                   else "PARTIAL - harvest deeper" if got < 100
                   else "COVERED")
        ws.append([rc.CATEGORIES[key]["label"], got, verdict])

    widths = [30, 26, 20, 10, 22, 22, 10, 10, 10]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def main() -> None:
    dry = "--dry" in sys.argv
    stats = {
        "total": 0,
        "by_category": collections.defaultdict(collections.Counter),
        "adjacency": [],
    }
    cache: dict = {}

    for path, specs in SHEET_SPECS.items():
        if not path.exists():
            print(f"  !! missing {path.name}")
            continue
        if not dry:
            shutil.copy2(path, path.with_suffix(".pre_category.bak.xlsx"))
        wb = openpyxl.load_workbook(path)
        print(f"\n{path.name}")
        for sheet, spec in specs:
            if sheet not in wb.sheetnames:
                print(f"  -- {sheet}: absent, skipped")
                continue
            ws = wb[sheet]
            # Unique Companies has no Address/Website, so seed its cache from
            # the contact-level rollup computed on 'All Contacts'.
            count, values = classify_sheet(ws, spec, cache)
            append_columns(ws, values)
            print(f"  ++ {sheet}: {count} rows tagged")
            # Coverage stats are scoped to 'Unique Companies' only -- the
            # deduplicated company list. The other lead sheets overlap it, so
            # counting them too would inflate every figure.
            if sheet == "Unique Companies":
                for v in values:
                    stats["total"] += 1
                    lbl = v[0]
                    for key, cat in rc.CATEGORIES.items():
                        if cat["label"] == lbl:
                            c = stats["by_category"][key]
                            c["primary"] += 1
                            c["any"] += 1
                            c[v[3]] += 1
                            if v[4] == "Keyword evidence":
                                c["keyword"] += 1
                            break
                    for t in v[1].split("; "):
                        for key, cat in rc.CATEGORIES.items():
                            if cat["label"] == t:
                                stats["by_category"][key]["any"] += 1
                                break
        if path == BNS:
            adj = collections.Counter()
            for company, res in cache.items():
                for src, dst, why in res["adjacency"]:
                    adj[(src, dst, why)] += 1
            stats["adjacency"] = [(s, d, n, w) for (s, d, w), n in adj.most_common()]
            build_registry_sheet(wb)
            build_coverage_sheet(wb, stats)
            print("  ++ Category Registry + Category Coverage sheets written")
        if not dry:
            wb.save(path)
        wb.close()

    print("\n" + "=" * 62)
    print(f"Dry run - no files written." if dry else "Done.")
    print("=" * 62)


if __name__ == "__main__":
    main()
