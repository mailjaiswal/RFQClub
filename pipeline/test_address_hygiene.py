"""Regression test for address_hygiene.guard().

Every case below is an Address string that a real enrichment batch actually tried to
write, taken from Swaniki_Expansion_Database.xlsx before the 2026-10-08 repair. The
assertion is the one that matters: after the guard, the Address text must not change
the verdict the company's own name and harvested vertical already give - i.e. a
sector may only be asserted through `Category (Researched)`.

Usage:  python test_address_hygiene.py
"""
import sys

import address_hygiene as ah
import rfq_categories as rc

# (company, harvested legacy Category, address exactly as a batch tried to write it)
CASES = [
    ("UTTAM FOMA TECHNOCAST PRIVATE LIMITED", "Foundry and Casting",
     "Office No. 609, 6th Floor, East Court, Phoenix Market City, Nagar Road, Viman "
     "Nagar, Pune 411014, Maharashtra (works filed at Unit No. 2, 5th Floor, "
     "Fountainhead Tower-1, Viman Nagar)"),
    ("RISHABH BUSINESS PVT LTD", "Electrical Panels",
     "Registered office: 35, Omkar House, C.G. Road, Navrangpura, Ahmedabad 360001, "
     "Gujarat (registry registered office - a city office, no works address "
     "published anywhere)"),
    ("KAIZEN ENGINEERING (INDIA) PRIVATE LIMITED", "Automotive Parts",
     "Works: Plot No. 4/6, Sector No. 10 PCNTDA, Near Vishweshwar Chowk, Opp. to "
     "Shivraj Industrial Premises, MIDC, Bhosari, Pune 411026, Maharashtra"),
    ("GANJAWALLA FABRIPRO PRIVATE LIMITED", "Metal Sheet Work",
     "Office: G-1, Hema House, Chandawarkar Road, Borivali West, Mumbai 400092; "
     "Works: Plot No. 47, Government Industrial Estate Phase 2, Piparia, "
     "Silvassa 396230"),
    ("SHYAM UDYOG METALLIC PRIVATE LIMITED", "Metal Sheet Work",
     "Office No. 303, Corporate Corner Premises CHS Ltd, Malad West, Mumbai 400064 "
     "(no works/plant address published anywhere)"),
    ("TROIKA COMPONENTS PRIVATE LIMITED", "Automotive Parts",
     "Works: 92/1 & 2, Inappasandram Village, Hosur-Bagalur Road, Hosur 635 103, "
     "Tamil Nadu"),
    ("AG MULLER TECHNIK PRIVATE LIMITED", "Fasteners / Hardware",
     "Group works and office: E-69/1, BSR Industrial Area, Site 1, Ghaziabad "
     "201009, Uttar Pradesh (Delhi-NCR)"),
    ("MANGLAM CONTAINERS PRIVATE LIMITED", "Packaging",
     "Registered office: 89, Vasudha Enclave, Pitampura, Delhi 110034 (a directory "
     "listing puts a works at '11, Model Industrial Estate, Bahadurgarh, Haryana "
     "124507' - unconfirmed)"),
    ("SIDHARTH PAPERS PRIVATE LIMITED", "Packaging",
     "Works: 7th Km, Moradabad Rd, Shahganj, Uttarakhand 244713. Registered: 432, "
     "Sitaram Apartments, Patpar Ganj, Delhi 110092."),
    ("SAI SHYAM FABRICON PRIVATE LIMITED", "Foundry and Casting",
     "Registered office: House No. 16/868, G.E. Road, Ramkund, Raipur 492001, "
     "Chhattisgarh (a residence address; no works or factory address is published "
     "anywhere)"),
    ("ASTHA FERRO ALLOYS PRIVATE LIMITED", "Foundry and Casting",
     "Works: Plot No. 114-125 & 128, Sector C, Urla Industrial Area, Raipur "
     "(Chhattisgarh) 493221."),
]

# Addresses that must pass through untouched - the guard is only allowed to react to
# text that actually moves the sector, so a plain postal line is never mangled.
PASSTHROUGH = [
    ("SHREE SWASTIK STEELS PVT LTD", "Foundry and Casting",
     "Plot D-29, MIDC Shirolli, Kolhapur 416122, Maharashtra"),
    ("VP SYNERGIC WELD PVT LTD", "Sheet Metal",
     "Survey 102/2, GAT Industrial Area, Pune 411021"),
]

# Prose a relabel cannot neutralise, so the claim has to leave the Address cell.
# mode: "note" = a postal line survives and the claim becomes a note,
#       "refuse" = every phrase asserts, so the cell is left empty.
HARD = [
    ("MADHU CYCLES", "Automotive Parts",
     "Registered office: 12, Station Road, Karnal 132001 (their own page says they "
     "only do laser cutting for others)", "note"),
    ("RISHABH BUSINESS", "Electrical Panels",
     "Laser cutting and press brake job shop, Plot 5, MIDC, Ahmedabad", "refuse"),
]


def _primary(company, legacy, address):
    sig = (address or "").strip()
    res = rc.classify(company=company, address=sig, website=sig,
                      legacy_category=legacy)
    return res["primary_label"]


def main():
    failed = 0
    for company, legacy, addr in CASES:
        kept, notes, warn = ah.guard(addr, company=company, legacy=legacy)
        base = _primary(company, legacy, "")
        now = _primary(company, legacy, kept)
        if now != base:
            print("FAIL  %-42s address still moves the sector %s -> %s"
                  % (company[:42], base, now))
            failed += 1
        elif kept and kept != addr:
            print("ok    %-42s rewrote  (%s)" % (company[:42], warn[:44]))
        elif not kept:
            print("ok    %-42s refused the cell, kept %d note(s)"
                  % (company[:42], len(notes)))
        else:
            print("ok    %-42s untouched - the name/vertical already said %s"
                  % (company[:42], now))
        if " works" in (kept or "").lower() or kept.lower().startswith("works"):
            print("FAIL  %-42s still carries the signal word" % company[:42])
            failed += 1
    for company, legacy, addr in PASSTHROUGH:
        kept, notes, warn = ah.guard(addr, company=company, legacy=legacy)
        if kept != addr or notes or warn:
            print("FAIL  %-42s plain address was touched: %r" % (company[:42], kept))
            failed += 1
    for company, legacy, addr, mode in HARD:
        kept, notes, warn = ah.guard(addr, company=company, legacy=legacy)
        if _primary(company, legacy, kept) != _primary(company, legacy, ""):
            print("FAIL  %-42s prose still moves the sector" % company[:42])
            failed += 1
        elif mode == "refuse" and (kept or not notes):
            print("FAIL  %-42s should have refused the cell, got %r"
                  % (company[:42], kept))
            failed += 1
        elif mode == "note" and (not kept or not notes):
            print("FAIL  %-42s expected a postal line plus a note, got %r / %r"
                  % (company[:42], kept, notes))
            failed += 1
        else:
            print("ok    %-42s %s -> %r + %d note(s)"
                  % (company[:42], mode, kept[:40], len(notes)))
    print("\n%d case(s), %d failure(s): %s"
          % (len(CASES) + len(PASSTHROUGH) + len(HARD), failed,
             "PASS" if not failed else "FAIL"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
