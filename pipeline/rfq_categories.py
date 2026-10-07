"""RFQClub category registry + lead classifier.

Single source of truth for lead categorization. Extensible: to add a category,
append one entry to CATEGORIES below. Nothing else needs to change.

Two tiers
---------
Tier 1 = researched focus categories. Carry the commercial research axes
         (spec standardization / repeat frequency / buyer urgency / winning edge)
         that decide build-vs-defer priority for the category.
Tier 2 = legacy verticals harvested from the BnS source database. Retained so no
         lead is ever lost, and so Tier 1 coverage gaps stay measurable.

A lead gets a PRIMARY tag (highest-ranked registry match) plus a full TAG LIST.
Original source columns are never modified by the applier.

default_track
-------------
Every category declares which side of the marketplace its companies land on,
which seeds `lead.track` at import. Note that all three Tier 1 categories
default to `buyer`, because the research behind them is written from the demand
side -- each winning edge describes a company that HAS a requirement and wants
quotes ("send me one drawing", "upload one BoM", "fill one form and compare four
converters"). Tier 2 defaults to `supplier` where the harvested companies are
manufacturers with capacity to bid.

A job shop is genuinely both, which is why `lead` is UNIQUE(company_id, track)
rather than one row per company: a single company can carry both tracks off one
shared company overview.
"""
from __future__ import annotations

import re
import unicodedata

# --------------------------------------------------------------------------
# Tier 1 - researched focus categories
# --------------------------------------------------------------------------

TIER1 = 1
TIER2 = 2

CATEGORIES: dict[str, dict] = {
    # ---------------- Tier 1 ----------------
    "packaging": {
        "label": "B2B Packaging",
        "tier": TIER1,
        "default_track": "buyer",
        "spec_standardization": "High (Clear parameters: Ply, GSM, Dim.)",
        "repeat_frequency": "Monthly / Bi-weekly",
        "buyer_urgency": "High",
        "winning_edge": "Standard input form makes comparing 4 box converters instant.",
        "color": "#B5651D",
        "keywords": [
            "packaging", "packager", "package design", "packaging machine",
            "carton", "cartons", "corrugated", "corrugation", "corrugate",
            "flexo", "flexographic", "kraft", "sleeve board", "paper tube",
            "lamination", "laminating", "shrink wrap", "shrink film", "stretch film",
            "blister pack", "flow wrap", "vacuum packing", "pouch", "pouches",
            "label printing", "labelling", "labeling", "self adhesive label",
            "bottle", "bottling", "bottle filler", "bottle cap", "cap closure",
            "closure system", "fillers and capper", "jar", "jarred",
            "coaster", "coasters", "divider", "insert", "non woven", "nonwoven",
            "non-woven", "tissue paper", "roll stock", "die cut", "die-cut",
            "window envelope", "mailer", "can sleeve", "aluminium can",
            "container", "tub", "tray", "crate", "wooden box", "wood box",
            "packing box", "box convert", "carton plant", "printing press",
            "offset printer", "screen printing", "paper mill", "board mill",
        ],
        "weak_keywords": [
            "packaging", "box", "printing", "paper", "board", "bottling", "closure",
        ],
        "excludes": ["3d print", "3d printing", "printing press plate"],
    },
    "jobwork": {
        "label": "Job Work / Machining",
        "tier": TIER1,
        "default_track": "buyer",
        "spec_standardization": "Technical (Drawings, Tolerances)",
        "repeat_frequency": "Project-based / Weekly",
        "buyer_urgency": "Medium-High",
        "winning_edge": "Direct drawing attachment + structured cost breakdown (material vs. machining).",
        "color": "#3F4397",
        "keywords": [
            "job work", "jobwork", "contract manufacturing", "contract manufacturer",
            "cnc", "cnc machining", "vmc", "vmc machining", "machining", "machinist",
            "turned parts", "turning", "milling", "lathing", "lathe",
            "precision machining", "precision engineering", "precision works",
            "tool room", "toolroom", "tool making", "tooling", "tool room and",
            "mould", "molds", "moulds", "injection mould", "die casting die",
            "dies and", "punch and die", "stamping die",
            "wire edm", "edm", "deep hole drilling", "broaching", "hobbing",
            "surface grinding", "grinding machine", "boring", "cnc turning centre",
            "job shop", "subcontract", "sub contract", "fabrication", "fabricator",
            "fabricated", "metal fabrication", "sheet metal fabrication",
            "laser cutting", "plasma cutting", "press brake", "bending",
            "weldment", "welded", "assembly work", "contract manufacturing services",
            "smt assembly", "pcb assembly", "electronics manufacturing",
            "rapid prototyping", "prototype machining",
            "engineering works", "workshop", "machine shop", "foundry job",
        ],
        "weak_keywords": [
            # 'parts' and 'components' were dropped here on purpose: they pulled
            # in AUTOTECH COMPONENTS / BEERIDE COMPONENTS as job-work evidence
            # with no machining signal at all.
            "engineering", "precision", "tool", "tooling", "die", "assembly",
            "works", "workholding", "component manufacturing",
        ],
        "excludes": [],
    },
    "fasteners": {
        "label": "Fasteners / Hardware",
        "tier": TIER1,
        "default_track": "buyer",
        "spec_standardization": "Multi-item BoMs (Spreadsheet-heavy)",
        "repeat_frequency": "Regular / Recurring",
        "buyer_urgency": "High",
        "winning_edge": "Auto-parsing Excel/PDF BoMs into side-by-side vendor line rates.",
        "color": "#7A4B12",
        "keywords": [
            "fastener", "fasteners", "fastening", "bolts and nuts", "bolt", "bolts",
            "nuts", "screw", "screws", "screwing", "washer", "washers",
            "threaded rod", "threading", "rivet", "rivets", "riveting",
            "studs", "stud", "anchor fastener", "self tapping", "self-tapping",
            "machine screw", "wood screw", "socket head", "hex bolt", "hex nut",
            "hardware", "ironmongery", "fittings", "pipe fitting", "flange",
            "flanges", "gasket", "gaskets", "o-ring", "o ring", "oring",
            "hose clamp", "clamps", "circlip", "circlips", "snap ring",
            "dowel pin", "clevis pin", "turnbuckle", "shackle", "cable gland",
            "spring", "springs", "wire spring", "compression spring",
            "metal stamping", "stamped part", "progressive die", "cold forging",
            "cold headed", "cold header", "metal form", "roll pin", "keys and pins",
            "ball bearing", "roller bearing", "bearing", "bearings", "bush",
            "bushes", "bronze bush", "grease nipple", "seals and gaskets",
        ],
        "weak_keywords": [
            "fastener", "fasteners", "hardware", "bearing", "industrial hardware",
            "metal parts", "metal stampings", "industrial components", "industrial supplies",
        ],
        "excludes": [],
    },
    # ---------------- Tier 2 - legacy verticals ----------------
    "automotive": {
        "label": "Automotive Parts",
        "tier": TIER2,
        "default_track": "supplier",
        "spec_standardization": "Medium (Part numbers, grades)",
        "repeat_frequency": "Program-based (monthly)",
        "buyer_urgency": "Medium",
        "winning_edge": "Reusable: keeps legacy coverage measurable vs Tier 1.",
        "color": "#1E6C78",
        "keywords": [
            "automotive", "automobile", "auto parts", "auto component",
            "car parts", "vehicle parts", "brake disc", "brake drum", "brake pad",
            "clutch", "clutch kit", "gearbox", "transmission", "spur gear",
            "crankshaft", "camshaft", "connecting rod", "suspension",
            "engine part", "auto accessory", "car accessory", "4x4",
            "tractor part", "two wheeler", "motorcycle part", "tyre", "tires",
            "wheel hub", "hub assembly", "bumper", "radiator", "exhaust",
            "land rover", "jeep", "defender", "commercial vehicle",
            "automotive component", "oem supplier",
        ],
        "weak_keywords": ["auto", "car", "vehicle", "motor", "truck", "bus"],
        "excludes": [],
    },
    "electrical": {
        "label": "Electrical Panels",
        "tier": TIER2,
        "default_track": "supplier",
        "spec_standardization": "Medium (SLD, ratings)",
        "repeat_frequency": "Project-based",
        "buyer_urgency": "Medium",
        "winning_edge": "Reusable: keeps legacy coverage measurable vs Tier 1.",
        "color": "#9A6414",
        "keywords": [
            "electrical panel", "control panel", "switchgear", "panel board",
            "distribution board", "busbar", "bus duct", "busway", "mcc",
            "pcc", "lt panel", "ht panel", "vfd", "variable frequency drive",
            "plc panel", "control cabinet", "control system", "electrical enclosure",
            "panel board manufacturer", "wiring harness", "cable tray", "junction box",
            "transformer", "switch board", "motor starter", "soft starter",
            "electric enclosure", "automation", "industrial automation",
            "panel solution", "power panel", "capacitor panel",
        ],
        "weak_keywords": ["electric", "electrical", "panel", "power", "control"],
        "excludes": ["solar panel", "panel solar"],
    },
    "food_mfg": {
        "label": "Food Manufacturing",
        "tier": TIER2,
        "default_track": "buyer",
        "spec_standardization": "Low-Medium (Recipe + pack spec)",
        "repeat_frequency": "Recurring (monthly)",
        "buyer_urgency": "Medium",
        "winning_edge": "Reusable: keeps legacy coverage measurable vs Tier 1.",
        "color": "#2E6E46",
        "keywords": [
            "food", "foods", "food manufacturing", "food processing", "beverage",
            "dairy", "dairy products", "cheese", "bakery", "baking",
            "snacks", "confectionery", "chocolate", "ice cream", "frozen food",
            "milling", "flour", "rice mill", "spices", "spice", "edible oil",
            "juice", "soft drink", "water bottling", "brewery", "brewing",
            "cattle feed", "animal feed", "poultry", "feed mill",
            "farm produce", "cold storage", "frozen", "canned food",
            "restaurant", "catering", "supermarket", "grocery", "organic food",
        ],
        "weak_keywords": ["farm", "agriculture", "produce", "organic", "nutrition"],
        "excludes": ["food grade tooling"],
    },
    "foundry": {
        "label": "Foundry & Casting",
        "tier": TIER2,
        "default_track": "supplier",
        "spec_standardization": "Medium (Grade, Tonnage)",
        "repeat_frequency": "Project-based / Monthly",
        "buyer_urgency": "Medium",
        "winning_edge": "Reusable: keeps legacy coverage measurable vs Tier 1.",
        "color": "#C65C1E",
        "keywords": [
            "foundry", "castings", "casting", "cast", "sand casting", "die casting",
            "die cast", "investment casting", "lost wax", "forging", "forged",
            "forgings", "melt", "moulding", "iron foundry", "steel foundry",
            "aluminium casting", "aluminum casting", "cast iron", "ductile iron",
            "grey iron", "non ferrous cast", "ferrous", "bronze casting",
            "manhole cover", "ductile cast", "sg iron", "cubiltic", "cast component",
        ],
        "weak_keywords": ["cast", "iron", "steel", "melt", "forge"],
        "excludes": ["broadcast"],
    },
    "sheet_metal": {
        "label": "Sheet Metal & Fabrication",
        "tier": TIER2,
        "default_track": "supplier",
        "spec_standardization": "Medium (Material, Gauge, Fold)",
        "repeat_frequency": "Project-based",
        "buyer_urgency": "Medium",
        "winning_edge": "Reusable: keeps legacy coverage measurable vs Tier 1.",
        "color": "#2E6E46",
        "keywords": [
            "sheet metal", "sheetmetal", "metal sheet", "steel fabrication",
            "metal fabrication", "sheet fabrication", "precision sheet metal",
            "chassis", "weldment", "welded fabrication", "structural fabrication",
            "pressure vessel", "storage tank", "industrial enclosure", "cabinet",
            "duct", "hopper", "conveyor fabrication", "guarding", "work table",
        ],
        "weak_keywords": ["sheet", "metal", "fabrication", "steel", "weld"],
        "excludes": [],
    },
}

# --------------------------------------------------------------------------
# Legacy vertical -> tag defaults.  Used when keyword evidence is thin so a lead
# never ends up untagged.  Tag order defines primary preference.
# --------------------------------------------------------------------------

LEGACY_VERTICAL_TAGS: dict[str, list[str]] = {
    "Automotive Parts":      ["automotive", "jobwork"],
    "CNC Job Work":          ["jobwork"],
    "Electrical Panels":     ["electrical"],
    "Food Manufacturing":    ["food_mfg"],
    "Foundry and Casting":   ["foundry", "jobwork"],
    "Metal Sheet Work":      ["jobwork", "sheet_metal"],
}

# Cross-category demand-side adjacency.  These do NOT change the primary tag.
# They mark where a lead is a *buyer* for a Tier 1 category even though its own
# business sits in another vertical -- the highest-value outreach insight.
DEMAND_ADJACENCY: dict[str, list[tuple[str, str]]] = {
    "food_mfg":    [("packaging", "food manufacturers buy pouches, cartons, film and labels on repeat")],
    "automotive":  [("fasteners", "auto programs run multi-item fastener BoMs")],
    "electrical":  [("fasteners", "panel builds consume hardware BoMs per project")],
    "foundry":     [("fasteners", "foundry tooling and castings ship with fastener call-outs")],
}

TIER_LABEL = {TIER1: "Tier 1 - Researched Focus", TIER2: "Tier 2 - Legacy Vertical"}

# Order used to break ties when several categories match equally well.
# Tier 1 wins over Tier 2; within a tier, registry declaration order wins.
_RANK = {key: i for i, key in enumerate(CATEGORIES)}


def _norm(text) -> str:
    if not text:
        return ""
    t = unicodedata.normalize("NFKD", str(text))
    t = t.replace("\ufffd", "").replace("�", "")
    return re.sub(r"\s+", " ", t).strip().lower()


# Normalized lookup for the legacy fallback. Built once at import so the exact
# casing of a source 'Category' cell can never disable the fallback.
_LEGACY_BY_NORM = {_norm(name): tags for name, tags in LEGACY_VERTICAL_TAGS.items()}

# Every category's own label is also a valid legacy prior. Without this, a row
# whose source 'Category' cell already holds a registry vertical (e.g. a NIC
# directory sweep filed under 'Fasteners / Hardware') would find no entry here,
# and if its NAME carries no keyword the lead lands with a blank category and
# still sits in a rep's queue. The explicit map above wins, because a hand-tuned
# vertical may expand to several tags ('Foundry and Casting' -> foundry+jobwork)
# while the auto-alias can only point at itself.
for _key, _cat in CATEGORIES.items():
    _LEGACY_BY_NORM.setdefault(_norm(_cat["label"]), [_key])
    _LEGACY_BY_NORM.setdefault(_norm(_key), [_key])


def _pattern(kw: str) -> re.Pattern:
    """Word-boundary matcher.

    Plain `in` substring matching is what made 'jar' match 'engineering' and
    'can' match 'Canada'.  Short generic terms must respect token edges;
    multi-word phrases get the same treatment so 'food' does not hit
    'foodservice equipment' variants we did not intend.
    """
    parts = [re.escape(p) for p in re.split(r"[\s\-]+", kw.strip()) if p]
    return re.compile(r"(?<!\w)" + r"[\s\-]+".join(parts) + r"(?!\w)")


def _hits(cat: dict, hay: str) -> tuple[int, list[str]]:
    """Return (score, matched keywords) for one category against one haystack."""
    if not hay:
        return 0, []
    score, matched = 0, []
    for kw in cat.get("keywords", []):
        if _pattern(kw).search(hay):
            score += 3
            matched.append(kw)
    for kw in cat.get("weak_keywords", []):
        if _pattern(kw).search(hay):
            score += 1
            matched.append(kw)
    for bad in cat.get("excludes", []):
        if _pattern(bad).search(hay):
            score -= 4
            if bad in matched:
                matched.remove(bad)
    return score, matched


def classify(
    *,
    company: str = "",
    address: str = "",
    website: str = "",
    legacy_category: str = "",
) -> dict:
    """Classify one lead into a primary tag + full tag list.

    Signals, strongest first: descriptive address text, company name, website
    domain.  Legacy vertical is a fallback prior, never an override of real
    keyword evidence.

    Returns dict with primary, primary_label, tags, tags_label, tier,
    confidence, rationale, adjacency.  `adjacency` is a list of
    (source_tag, target_category, why) triples.
    """
    # Address often carries an inline business description
    # ("... - brake discs, drums & hubs; est. 2005"), so weight it twice.
    hay_name = _norm(company)
    hay_addr = _norm(address)
    hay_web = _norm(website)

    scored: dict[str, dict] = {}
    for key, cat in CATEGORIES.items():
        s, m_name = _hits(cat, hay_name)
        s2, m_addr = _hits(cat, hay_addr)
        s3, m_web = _hits(cat, hay_web)
        total = s + (s2 * 2) + s3
        if total > 0:
            scored[key] = {
                "score": total,
                "cat": cat,
                "evidence": m_name[:2] + m_addr[:3] + m_web[:2],
            }

    if scored:
        ordered = sorted(
            scored.items(),
            key=lambda kv: (-kv[1]["score"], _RANK[kv[0]]),
        )
        top_key, top = ordered[0]
        tags = [k for k, _ in ordered]
        runner = ordered[1][1]["score"] if len(ordered) > 1 else 0
        margin = top["score"] - runner

        if top["score"] >= 9 and margin >= 4:
            confidence = "High"
        elif top["score"] >= 3 and margin >= 3:
            confidence = "Medium"
        else:
            confidence = "Low"

        ev = ", ".join(dict.fromkeys(top["evidence"][:4]))
        rationale = f"Keyword evidence on {top['cat']['label']} ({top['score']} pts: {ev})"
        primary = top_key
        tier = top["cat"]["tier"]
    else:
        legacy_tags = _LEGACY_BY_NORM.get(_norm(legacy_category), [])
        if not legacy_tags:
            return {
                "primary": "", "primary_label": "Uncategorised", "tags": [],
                "tags_label": "", "tier": "", "confidence": "Low",
                "rationale": "No keyword evidence and no legacy vertical mapping.",
                "adjacency": [],
            }
        tags = legacy_tags
        primary = legacy_tags[0]
        tier = CATEGORIES[primary]["tier"]
        confidence = "Low"
        rationale = f"No keyword evidence; inherited legacy vertical '{legacy_category}'."

    adjacency = []
    for src, pairs in DEMAND_ADJACENCY.items():
        if src not in tags:
            continue
        for dst, why in pairs:
            if dst not in tags:
                adjacency.append((src, dst, why))

    return {
        "primary": primary,
        "primary_label": CATEGORIES[primary]["label"],
        "tags": tags,
        "tags_label": "; ".join(CATEGORIES[t]["label"] for t in tags),
        "tier": TIER_LABEL[tier],
        "confidence": confidence,
        "rationale": rationale,
        "adjacency": adjacency,
    }


def registry_rows() -> list[dict]:
    """Flat view of the registry, for the workbook and the report."""
    out = []
    for key, cat in CATEGORIES.items():
        out.append({
            "key": key,
            "label": cat["label"],
            "tier": TIER_LABEL[cat["tier"]],
            "default_track": cat.get("default_track", "supplier"),
            "spec_standardization": cat["spec_standardization"],
            "repeat_frequency": cat["repeat_frequency"],
            "buyer_urgency": cat["buyer_urgency"],
            "winning_edge": cat["winning_edge"],
            "keywords": len(cat.get("keywords", [])),
        })
    return out
