"""RFQClub sector taxonomy: 7 sectors with colors + a keyword classifier.

Colors match the design-concepts.html prototype exactly. classify() scans a
process/title/material string against keyword sets in priority order and falls
back to cnc (most Indian SME RFQs are machining).
"""
from __future__ import annotations

# key -> label, base color, soft bg, urgency-free (used for card bands/chips)
SECTORS = {
    "cnc":    {"label": "CNC & Machining",              "base": "#3F4397", "soft": "rgba(63,67,151,.12)"},
    "foundry":{"label": "Foundry & Casting",            "base": "#C65C1E", "soft": "rgba(198,92,30,.12)"},
    "sheet":  {"label": "Sheet Metal & Fabrication",     "base": "#2E6E46", "soft": "rgba(46,110,70,.12)"},
    "auto":   {"label": "Automotive Parts",             "base": "#1E6C78", "soft": "rgba(30,108,120,.12)"},
    "elec":   {"label": "Electrical Panels",            "base": "#9A6414", "soft": "rgba(154,100,20,.12)"},
    "tools":  {"label": "Tools & Fixtures",             "base": "#8A3A5E", "soft": "rgba(138,58,94,.12)"},
    "plant":  {"label": "Plant & Machinery / Raw Mat.", "base": "#3A3A3A", "soft": "rgba(58,58,58,.10)"},
}

# priority order matters (first match wins)
_KEYWORDS = [
    ("elec",   ["panel", "switchgear", "bus duct", "busbar", "vfd", "control cabinet", "electrical", "wiring harness", "mcc", "pcc"]),
    ("plant",  ["crane", "slewing", "gantry", "girder", "pillar-mounted", "machinery", "press line", "conveyor", "raw material", "billet", "coil", "plate", "ingot", "extrusion"]),
    ("foundry",["casting", "cast", "foundry", "forging", "forged", "melt", "sand mold", "investment cast", "die cast", "billet forging"]),
    ("sheet",  ["sheet metal", "fabrication", "fabricated", "laser cut", "press brake", "punch", "weldment", "welded", "bending", "chassis", "enclosure", "tank", "duct"]),
    ("tools",  ["tooling", "fixture", "jig", "mould", "mold", "die", "carbide insert", "workholding", "zero-point", "eps pattern", "gage", "gauge", "punch and die"]),
    ("auto",   ["automotive", "automobile", "brake", "clutch", "engine part", "transmission", "spur gear", "gear", "crankshaft", "camshaft", "hub", "20mncr5", "sae"]),
    ("cnc",    ["5-axis machined", "5 axis", "cnc", "vmc", "milled", "mill", "turned", "turning", "machined", "machining", "precision ground", "grinding", "wire edm", "edm", "deep hole drilling", "broached", "hobbed", "anodising", "anodizing", "heat treatment", "duplex", "super duplex", "6061", "titanium", "inconel", "aluminium", "aluminum", "ss 304", "ss316"]),
]


def classify(process: str = "", title: str = "", material: str = "") -> str:
    hay = " ".join((process or "", title or "", material or "")).lower()
    for key, kws in _KEYWORDS:
        for kw in kws:
            if kw in hay:
                return key
    return "cnc"


def label(key: str) -> str:
    return SECTORS.get(key, SECTORS["cnc"])["label"]


def colors(key: str) -> dict:
    return SECTORS.get(key, SECTORS["cnc"])
