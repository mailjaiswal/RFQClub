"""Static profile fixture mirroring the mock #profile screen (one demo supplier).

Served verbatim by GET /api/profile. The frontend renders each panel from an
ordered list of typed blocks so a single generic renderer covers all 8 tabs:

  block.type: "grid"   -> fields[]
              "chips"  -> items[] (+ note)
              "table"  -> cols[] + rows[] (cells: {text} | {pill:{state,text}} |
                         {sec:{color,label},text})
              "verify" -> rows[] (state kind ok|pend|act + optional otp box)
              "stats"  -> items[]
              "addrow" -> label

field keys: label, value, kind(input|select|textarea|password|disabled|phone),
            hint, req, full, placeholder, options[], prefix
pill.state maps to the mock classes: ok/won->green, open->indigo,
            lost->red, pend->amber, close->gray, act->indigo.
"""
from __future__ import annotations

PROFILE: dict = {
    "identity": {
        "logo": "G",
        "name": "Ganesh Precision Pvt. Ltd.",
        "since": "Member since Aug 2024 · Pune, MH",
        "badge": "Verified supplier",
    },
    "percent": 72,
    "strength_note": "4 sections need attention to reach 100% and unlock higher bid ranking.",
    "missing": [
        {"label": "Upload GST certificate", "pct": "+6%", "tab": "compliance"},
        {"label": "Add machine capacity", "pct": "+8%", "tab": "caps"},
        {"label": "ISO expiry missing", "pct": "+7%", "tab": "certs"},
        {"label": "Bank / payment terms", "pct": "+7%", "tab": "billing"},
    ],
    "tabs": [
        {"id": "company", "label": "Company", "icon": "building"},
        {"id": "contact", "label": "Contact & team", "icon": "contact"},
        {"id": "caps", "label": "Capabilities", "icon": "tool", "count": 2},
        {"id": "certs", "label": "Certifications", "icon": "medal", "count": 1},
        {"id": "compliance", "label": "Verification", "icon": "shield", "count": 1},
        {"id": "billing", "label": "Billing & terms", "icon": "card", "count": 1},
        {"id": "prefs", "label": "Preferences", "icon": "gear"},
        {"id": "activity", "label": "Activity & history", "icon": "chart"},
    ],
    "panels": {
        "company": {
            "title": "Company details",
            "sub": "Legal and trading identity. Buyers see the verified fields on every bid you submit.",
            "blocks": [
                {"type": "grid", "label": "Legal identity", "fields": [
                    {"label": "Legal / registered name", "value": "Ganesh Precision Private Limited", "req": True},
                    {"label": "Trading name (if different)", "value": "Ganesh Precision"},
                    {"label": "GSTIN", "value": "27AEGPD0000X1Z5", "req": True,
                     "hint": "15 chars · state code 27 (Maharashtra) · checked against the GST portal"},
                    {"label": "Udyam / MSME registration", "value": "UM-27-0004567890"},
                    {"label": "Company CIN", "value": "U29253MH2011PTC214567"},
                    {"label": "Year established", "value": "2011"},
                    {"label": "Website", "value": "https://ganeshprecision.in"},
                    {"label": "Import-Export Code (IEC)", "placeholder": "Optional — unlocks export RFQs"},
                    {"label": "ROC / incorporation no.", "placeholder": "Optional"},
                    {"label": "Primary sector", "kind": "select",
                     "options": ["CNC & Machining", "Sheet Metal", "Foundry & Casting", "Electrical Equipment"],
                     "value": "CNC & Machining"},
                ]},
                {"type": "grid", "label": "Scale & description", "fields": [
                    {"label": "Employees", "kind": "select",
                     "options": ["1–20", "21–50", "51–200", "201–500", "500+"], "value": "51–200"},
                    {"label": "Annual turnover", "kind": "select",
                     "options": ["Under ₹1 Cr", "₹1–5 Cr", "₹5–25 Cr", "₹25–100 Cr", "₹100 Cr+"], "value": "₹5–25 Cr"},
                    {"label": "About the company", "kind": "textarea", "full": True,
                     "value": "Job-shop for precision machined & fabricated components — CNC turning, 3/5-axis milling, welding and powder coating. Supply to automotive Tier-1s, pump OEMs and capital-equipment builders. In-house QA with CMM and NDT."},
                ]},
                {"type": "grid", "label": "Locations", "fields": [
                    {"label": "Registered office", "full": True, "value": "Plot 14, MIDC Bhosawada, Pune, Maharashtra 411026"},
                    {"label": "Manufacturing unit(s)", "full": True, "value": "Unit 2, Chakan MIDC Phase II, Pune — 40,000 sq ft",
                     "hint": "Add each plant address so buyers can filter you by logistics radius."},
                    {"label": "Hub city", "value": "Pune, MH"},
                    {"label": "Dispatch / logistics", "value": "Pan-India via surface transport; SEZ handling"},
                    {"label": "Additional branch / warehouse", "placeholder": "Optional address"},
                ]},
            ],
        },
        "contact": {
            "title": "Contact & team",
            "sub": "Who RFQClub routes to and who can place bids on this account.",
            "blocks": [
                {"type": "grid", "label": "Primary point of contact", "fields": [
                    {"label": "Full name", "value": "Rakesh Deshmukh", "req": True},
                    {"label": "Designation", "value": "Director — Operations"},
                    {"label": "Work email", "value": "rakesh@ganeshprecision.in", "req": True},
                    {"label": "Mobile (WhatsApp)", "kind": "phone", "prefix": "+91", "value": "9820045671",
                     "req": True, "hint": "10-digit Indian mobile · valid"},
                ]},
                {"type": "grid", "label": "Additional team & departments", "fields": [
                    {"label": "Estimation / quoting contact", "value": "sales@ganeshprecision.in"},
                    {"label": "Quality / documentation contact", "value": "qa@ganeshprecision.in"},
                    {"label": "Office landline", "placeholder": "Optional"},
                    {"label": "Company LinkedIn / profile", "full": True, "placeholder": "Optional — builds buyer confidence"},
                ]},
                {"type": "chips", "full": True, "items": [
                    {"text": "Owner can bid", "on": True},
                    {"text": "Sales can bid", "on": True},
                    {"text": "+ Invite team member", "on": False},
                ], "note": "Role-based access: only verified members with a \u201ccan bid\u201d role submit quotes on this company's behalf."},
            ],
        },
        "caps": {
            "title": "Capabilities & capacity",
            "sub": "Select everything you actually make — these tags drive which RFQs you're routed to. Tap a chip to toggle.",
            "blocks": [
                {"type": "chips", "label": "Processes", "items": [
                    {"text": "CNC Milling", "on": True, "proc": True},
                    {"text": "CNC Turning", "on": True, "proc": True},
                    {"text": "5-Axis", "on": True, "proc": True},
                    {"text": "Grinding", "on": False, "proc": True},
                    {"text": "Laser Cutting", "on": True, "proc": True},
                    {"text": "Press Bending", "on": False, "proc": True},
                    {"text": "Welding MIG/TIG", "on": False, "proc": True},
                    {"text": "Investment Casting", "on": False, "proc": True},
                    {"text": "Powder Coating", "on": False, "proc": True},
                    {"text": "Heat Treatment", "on": False, "proc": True},
                    {"text": "Assembly", "on": False, "proc": True},
                ]},
                {"type": "chips", "label": "Materials", "items": [
                    {"text": "Mild Steel", "on": True},
                    {"text": "SS 304/316", "on": True},
                    {"text": "Duplex 2205", "on": True},
                    {"text": "Aluminium", "on": False},
                    {"text": "Brass / Bronze", "on": False},
                    {"text": "CRCA", "on": False},
                    {"text": "Cast Iron", "on": False},
                    {"text": "Engineering Plastics", "on": False},
                ]},
                {"type": "grid", "label": "Capacity & limits", "fields": [
                    {"label": "Max job size (mm)", "value": "650 × 400 × 500"},
                    {"label": "Tightest tolerance", "value": "±0.01 mm"},
                    {"label": "Typical monthly capacity", "value": "≈ 40,000 machined parts / month"},
                    {"label": "Minimum order value (₹)", "value": "25,000"},
                    {"label": "Available machine-hours / week", "placeholder": "Optional"},
                    {"label": "In-house tooling & fixtures", "placeholder": "Optional"},
                    {"label": "Surface finishes offered", "placeholder": "Optional"},
                    {"label": "Key machines", "kind": "textarea", "full": True,
                     "value": "4× VMC (3-axis), 1× 5-axis DMU, 6× CNC turning centers (up to Ø 320), 2× cylindrical grinders, 3kW fiber laser, shot-blast + powder-coat line, 2× CMM, FPI & UT NDT."},
                ]},
                {"type": "addrow", "label": "+ Add machine / process"},
            ],
        },
        "certs": {
            "title": "Certifications & compliance",
            "sub": "Attach certificates with validity — buyers shortlist on these, and expired docs pause your badge.",
            "blocks": [
                {"type": "table", "label": "Management & product",
                 "cols": ["Certificate", "Status", "Valid till", "Document"],
                 "rows": [
                    [{"text": "ISO 9001:2015", "rt": True}, {"pill": {"state": "won", "text": "Active"}}, {"text": "Mar 2027"}, {"text": "ISO9001.pdf"}],
                    [{"text": "IATF 16949", "rt": True}, {"pill": {"state": "open", "text": "In audit"}}, {"text": "—"}, {"text": "—"}],
                    [{"text": "ISO 14001", "rt": True}, {"pill": {"state": "won", "text": "Active"}}, {"text": "Nov 2026"}, {"text": "ISO14001.pdf"}],
                    [{"text": "AS9100D", "rt": True}, {"pill": {"state": "close", "text": "Not held"}}, {"text": "—"}, {"text": "—"}],
                    [{"text": "CE marking", "rt": True}, {"pill": {"state": "won", "text": "Active"}}, {"text": "Jun 2028"}, {"text": "ce-decl.pdf"}],
                 ]},
                {"type": "grid", "label": "Registrations", "fields": [
                    {"label": "BIS / IS licence no.", "placeholder": "Optional"},
                    {"label": "Factory licence (state)", "placeholder": "Optional"},
                ]},
                {"type": "addrow", "label": "+ Upload a certificate"},
            ],
        },
        "compliance": {
            "title": "Verification",
            "sub": "Email and mobile are validated with one-time codes. Business documents are checked against government registries. All three raise your trust badge and bid ranking.",
            "blocks": [
                {"type": "verify", "rows": [
                    {"kind": "email", "title": "rakesh@ganeshprecision.in",
                     "desc": "Email verified · 6-digit code sent to your inbox",
                     "state": {"kind": "ok", "text": "Verified"}, "action": "Change email",
                     "otp": {"desc": "Enter the 6-digit code we emailed to rakesh@ganeshprecision.in. Codes expire in 10 minutes.",
                             "preset": ["4", "1", "9", "2", "", ""], "timer": "05:58"}},
                    {"kind": "phone", "title": "+91 98200 45671",
                     "desc": "Mobile verified via SMS OTP · linked as WhatsApp business number",
                     "state": {"kind": "ok", "text": "Verified"}, "action": "Re-validate",
                     "otp": {"desc": "We'll SMS a 6-digit OTP to +91 98200 45671. Indian 10-digit mobile numbers only.",
                             "preset": ["", "", "", "", "", ""], "timer": "09:12"}},
                    {"kind": "gst", "amber": True, "title": "GSTIN 27AEGPD0000X1Z5",
                     "desc": "Number format valid · certificate upload pending to confirm active status",
                     "state": {"kind": "pend", "text": "Pending"}, "action": "Upload GST"},
                ]},
                {"type": "grid", "label": "Business documents", "fields": [
                    {"label": "GST certificate", "placeholder": "GST_cert.pdf (drag-drop)", "kind": "disabled"},
                    {"label": "Udyam / MSME certificate", "placeholder": "udyam.pdf", "kind": "disabled"},
                    {"label": "PAN (company)", "value": "AEGPD0000X · matched", "kind": "disabled"},
                    {"label": "Incorporation / COI", "placeholder": "COI.pdf", "kind": "disabled"},
                ]},
            ],
        },
        "billing": {
            "title": "Billing & payment terms",
            "sub": "How you invoice and get paid. Shared only with a buyer after you're awarded an order.",
            "blocks": [
                {"type": "grid", "fields": [
                    {"label": "Invoice / billing name", "value": "Ganesh Precision Pvt. Ltd."},
                    {"label": "GST rate applied", "kind": "select",
                     "options": ["18% (manufacturing services)", "12%", "5%", "Exempt"], "value": "18% (manufacturing services)"},
                    {"label": "Bank name", "value": "HDFC Bank — Pune"},
                    {"label": "Account type", "kind": "select", "options": ["Current", "Savings"], "value": "Current"},
                    {"label": "Account number", "value": "520004471", "kind": "password"},
                    {"label": "IFSC", "value": "HDFC0001234"},
                    {"label": "Payment terms", "kind": "select",
                     "options": ["Advance only", "30% advance · 70% on delivery", "45-day credit", "60-day credit"],
                     "value": "30% advance · 70% on delivery"},
                    {"label": "Accepted instruments", "value": "NEFT / RTGS · Cheque · LC on orders ₹25 L+"},
                    {"label": "Transport / insurance terms", "placeholder": "Optional (e.g. ex-works, CIF)"},
                ]},
            ],
        },
        "prefs": {
            "title": "Preferences",
            "sub": "Control how RFQs reach you and how the platform behaves for your team.",
            "blocks": [
                {"type": "chips", "label": "Notifications", "full": True, "items": [
                    {"text": "WhatsApp", "on": True}, {"text": "Email", "on": True},
                    {"text": "SMS", "on": False}, {"text": "In-app only", "on": False},
                ]},
                {"type": "grid", "fields": [
                    {"label": "RFQ alerts frequency", "kind": "select",
                     "options": ["Instant", "Daily digest", "Weekly"], "value": "Daily digest"},
                    {"label": "Only route to me if", "kind": "select",
                     "options": ["Order ≥ ₹25,000", "Order ≥ ₹1,00,000", "Any value"], "value": "Order ≥ ₹25,000"},
                ]},
                {"type": "grid", "label": "Locale & units", "fields": [
                    {"label": "Currency", "value": "INR (₹)", "kind": "disabled"},
                    {"label": "Measurement units", "kind": "select", "options": ["Metric (mm · kg)", "Imperial"], "value": "Metric (mm · kg)"},
                    {"label": "Language", "kind": "select",
                     "options": ["English", "English + Hindi", "Marathi", "Tamil"], "value": "English + Hindi"},
                    {"label": "Default lead time to quote", "value": "4 weeks"},
                ]},
            ],
        },
        "activity": {
            "title": "Activity & history",
            "sub": "Your lifetime record on RFQClub — bids placed, outcomes and the RFQs routed to you.",
            "blocks": [
                {"type": "stats", "items": [
                    {"num": "184", "label": "RFQs routed"},
                    {"num": "96", "label": "Bids placed"},
                    {"num": "27", "label": "Orders won"},
                    {"num": "28%", "label": "Win rate"},
                ]},
                {"type": "table", "label": "Historical RFQ & bid log",
                 "cols": ["RFQ", "Requirement", "Your bid", "Outcome", "Date"],
                 "rows": [
                    [{"text": "RFQ·0451"}, {"sec": {"color": "#3F4397", "label": "CNC"}, "text": " 5-axis pump housings · Duplex 2205 · 1,200 pcs"}, {"text": "₹8.6 L"}, {"pill": {"state": "open", "text": "Open"}}, {"text": "Oct 2026"}],
                    [{"text": "RFQ·0432"}, {"sec": {"color": "#C65C1E", "label": "Foundry"}, "text": " Valve bodies · SS 316 · 850 sets"}, {"text": "$20.4 /set"}, {"pill": {"state": "won", "text": "Won"}}, {"text": "Sep 2026"}],
                    [{"text": "RFQ·0428"}, {"sec": {"color": "#2E6E46", "label": "Sheet Metal"}, "text": " Encoder brackets · CRCA 2mm · 5,000 pcs"}, {"text": "$2.8 /pc"}, {"pill": {"state": "lost", "text": "Lost"}}, {"text": "Sep 2026"}],
                    [{"text": "RFQ·0399"}, {"sec": {"color": "#9A6414", "label": "Electrical"}, "text": " Panel enclosures · powder coat · 320 nos"}, {"text": "₹5.1 L"}, {"pill": {"state": "won", "text": "Won"}}, {"text": "Aug 2026"}],
                    [{"text": "RFQ·0377"}, {"sec": {"color": "#8A3A5E", "label": "Tooling"}, "text": " Carbide inserts · grade KC30 · 300 lots"}, {"text": "—"}, {"pill": {"state": "close", "text": "No bid"}}, {"text": "Aug 2026"}],
                 ]},
                {"type": "addrow", "label": "Download full history (CSV)"},
            ],
        },
    },
}
