# pipeline — the daily lead loop

Code that turns public company records into leads the sales console can dial.
It runs on the machine that holds the workbooks, not on Render or Vercel.

**What lives here vs. what does not.** This folder is code, so it is versioned.
The data it reads and writes — `BnS_Contacts_Database.xlsx`,
`Swaniki_Expansion_Database.xlsx`, `Swaniki_Outreach_Board.xlsx`, `enrichment/*.json`,
`p7_active.json`, `p7_sector.json` — stays **outside the repo**, in the folder above
it, because it is real contact data for thousands of companies. `pipeline_paths.py`
resolves that folder; set `SWANIKI_DATA_DIR` to point somewhere else. The deployed
copy of the same data is the shared Neon database.

## The loop, in order

| step | script | what it does |
| --- | --- | --- |
| 1. harvest | `apply_p7_harvest.py` | appends peers found by the registry (NIC × city) sweep as new **append-only** rows in the expansion workbook, tagged with the cluster they came from |
| 2. worklist | `p7_worklist.py` | writes `p7_active.json` (rows still needing research) and, with `--sectors`, `p7_sector.json` (live callable rows whose sector is only a cluster guess), biggest paid-up first |
| 3. enrich | `apply_exp_enrichment.py` | applies `enrichment/p7_exp_*.json` batch verdicts: contacts, `status`/`out_of_scope` retirements, and `category` → the `Category (Researched)` column. `apply_enrichment.py` is the same job for the BnS workbook |
| 4. tag | `apply_rfq_categories.py` | re-tags every row from `rfq_categories.py`; a researched category **overrides** the harvested one and is recorded as `Tag Source: Researched override` with High confidence |
| 5. import | `api/import_leads.py` | upserts the tagged workbooks into `company` / `contact` / `lead`. Idempotent, never deletes |
| 6. verify | `api/test_lead_import.py`, `api/test_smoke.py` | row-level integrity, including that every workbook name actually reached a company and that each researched verdict reached `category_primary` **and** `category_source` |

`api/seed_categories.py` mirrors `rfq_categories.py` into the `category` table so the
UI can render the taxonomy without a code deploy.

## Rules the scripts enforce

- **Append-only harvesting, fill-blank-only enrichment.** A run may add a row or
  fill an empty cell; it never overwrites a value a human or an earlier batch set.
  `Category (Researched)` is write-once for the same reason: two passes that
  disagree must surface as a conflict, not silently resolve.
- **A sector is a claim about the company, not about where it was found.** The
  harvest copies the cluster anchor's sector onto `Category`, so that value is a
  guess; only research recorded in `Category (Researched)` counts as proven, and
  the console badges the difference for reps.
- **Never invent a channel.** No phone, email or website is written without a
  public source, noted in `Data Source` with the date.
- **Retirement is a status, not a delete.** `Dead - <registry state>` and
  `Out of scope - <reason>` hide a lead from sales and stay reversible.
