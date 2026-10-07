"""Where the lead pipeline's files live.

The CODE ships inside the repo (rfqclub/pipeline, next to this file). The DATA it
reads and writes - the three workbooks, the enrichment batches, the worklist
JSONs - stays in a folder OUTSIDE the repo, because it is real contact data for
thousands of companies (phone numbers, names, emails) and is not something to
publish, version or diff. The shared Neon database is the deployed copy of that
data; the workbooks are its editable source of truth.

On this machine the data folder is the workspace root two levels above the repo.
Any other checkout points at its own copy with the SWANIKI_DATA_DIR environment
variable, so nothing here has to be edited when the folder moves.
"""
from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent            # .../rfqclub/pipeline


def _data_dir() -> Path:
    env = os.getenv("SWANIKI_DATA_DIR", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return HERE.parent.parent                     # .../<workspace root>


DATA_DIR = _data_dir()
ENRICH_DIR = DATA_DIR / "enrichment"

# The workbook every stage of the loop touches, keyed by the name used in code.
BNS_XLSX = "BnS_Contacts_Database.xlsx"
EXPANSION_XLSX = "Swaniki_Expansion_Database.xlsx"
BOARD_XLSX = "Swaniki_Outreach_Board.xlsx"


def data(name: str) -> Path:
    """Path to a data file that must already exist, with an honest error."""
    p = DATA_DIR / name
    if not p.exists():
        raise SystemExit(
            "%s not found in %s\n"
            "  the pipeline code lives in the repo, the workbooks do not - set "
            "SWANIKI_DATA_DIR to the folder that holds them" % (name, DATA_DIR))
    return p


def out(name: str) -> Path:
    """Path to a file the pipeline writes (no existence check)."""
    return DATA_DIR / name
