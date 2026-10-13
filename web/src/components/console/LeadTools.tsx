"use client";
// Lead-creation tools for the queue screen: reps (and managers) add leads the
// database doesn't have yet, either one at a time (+ Add lead), or in bulk by
// filling an Exportable template and uploading it back (Import). Everything here
// rides the same /api/sales/leads/* endpoints the backend smoke-tested green —
// a rep's new lead lands in *their* queue; a manager may route it to a chosen rep.
//
// Duplicate handling is the server's, not ours: a company that already exists is
// MERGED (blanks filled, a missing contact/lead added, never overwritten), and the
// result says so — we surface "merged" honestly rather than pretending it's new.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConsole } from "@/components/console/ConsoleApp";
import {
  aiAccept, aiPreview, aiStatus, aiTranscribe, createLead, downloadLeadTemplate, fileToBase64,
  importLeadsBase64,
  type AiAnalysis, type AiAcceptResult, type CreateLeadResult, type ImportResult,
  type NewLeadInput, type TeamUser,
} from "@/lib/sales-api";

const msg = (e: unknown) => String((e as Error)?.message || e);
const MAX_IMPORT_BYTES = 6 * 1024 * 1024; // keep the base64 payload well under the API cap

const BLANK = {
  company: "", category: "", legal_name: "", track: "", city: "", country: "India",
  address: "", website: "", linkedin_url: "", gmb_link: "", gst: "", cin: "",
  size_band: "", what_they_do: "", contact_name: "", designation: "", email: "",
  phone_primary: "", phone_secondary: "", whatsapp: "", decision_maker: "", status: "",
  notes: "", owner_email: "",
};
type Form = typeof BLANK;

export function LeadTools({ team, onChanged }: { team: TeamUser[]; onChanged: () => void }) {
  const { meta, isManager, user } = useConsole();
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [tplBusy, setTplBusy] = useState("");
  const [tplErr, setTplErr] = useState("");

  const actAs = typeof window !== "undefined" ? (localStorage.getItem("rfqclub_act_as") || "") : "";
  // While impersonating a rep the owner's own email isn't the acting identity;
  // hide the tools rather than let them create leads as themselves by mistake.
  const scopedAway = !!actAs && actAs.toLowerCase() !== (user?.email || "").toLowerCase();

  async function getTemplate(fmt: "csv" | "xlsx") {
    setMenu(false); setTplErr(""); setTplBusy(fmt);
    try { await downloadLeadTemplate(fmt); }
    catch (e) { setTplErr(msg(e)); }
    finally { setTplBusy(""); }
  }

  return (
    <>
      <div className="in-row" style={{ gap: 8, alignItems: "center" }}>
        {tplErr && <span className="in-err" style={{ fontSize: 11 }}>{tplErr}</span>}
        {!scopedAway && (
          <>
            <button className="in-btn primary sm" onClick={() => setAddOpen(true)}>+ Add lead</button>
            <button className="in-btn sm" onClick={() => setAiOpen(true)}
              title="Paste any text — the AI works out if it is a lead, an RFQ or a supplier quote">
              ✨ AI ingest</button>
            <div style={{ position: "relative" }}>
              <button className="in-btn sm" onClick={() => setMenu((v) => !v)}
                title="Download the blank import template">⭳ Template ▾</button>
              {menu && (<>
                <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setMenu(false)} />
                <div className="in-card" style={{
                  position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 41,
                  padding: 8, minWidth: 168, display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <div className="in-lbl" style={{ padding: "0 4px" }}>Export lead template</div>
                  <button className="in-btn sm block" disabled={!!tplBusy}
                    onClick={() => getTemplate("csv")}>{tplBusy === "csv" ? "Preparing…" : "CSV (.csv)"}</button>
                  <button className="in-btn sm block" disabled={!!tplBusy}
                    onClick={() => getTemplate("xlsx")}>{tplBusy === "xlsx" ? "Preparing…" : "Excel (.xlsx)"}</button>
                </div>
              </>)}
            </div>
            <button className="in-btn sm" onClick={() => setImportOpen(true)}>⇧ Import leads</button>
          </>
        )}
      </div>

      {addOpen && (
        <AddLeadModal
          categories={meta?.categories || []} statuses={meta?.statuses || []} tracks={meta?.tracks || []}
          isManager={isManager} team={team}
          onClose={() => setAddOpen(false)}
          onCreated={() => { onChanged(); }}
        />
      )}
      {importOpen && (
        <ImportModal
          isManager={isManager} team={team}
          onClose={() => setImportOpen(false)}
          onImported={() => { onChanged(); }}
        />
      )}
      {aiOpen && (
        <AiIngestModal
          categories={meta?.categories || []} statuses={meta?.statuses || []} tracks={meta?.tracks || []}
          isManager={isManager} team={team}
          onClose={() => setAiOpen(false)}
          onAccepted={() => { onChanged(); }}
        />
      )}
    </>
  );
}

// ---- shared modal chrome -------------------------------------------------
function Modal({ title, sub, onClose, children, footer }: {
  title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="in-modal-backdrop" onClick={onClose}>
      <div className="in-modal" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 620, width: "min(620px, 94vw)", maxHeight: "88vh", overflow: "auto" }}>
        <div className="in-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h3 className="display" style={{ fontSize: 17, margin: "0 0 4px", color: "var(--txt)" }}>{title}</h3>
            {sub && <p className="in-muted" style={{ margin: "0 0 8px", fontSize: 12 }}>{sub}</p>}
          </div>
          <button className="in-btn sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
        <div className="in-row" style={{ gap: 10, justifyContent: "flex-end", marginTop: 16 }}>{footer}</div>
      </div>
    </div>
  );
}

const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label><span className="in-lbl">{label}</span>{children}</label>
);

// ---- add-one-lead --------------------------------------------------------
function AddLeadModal({ categories, statuses, tracks, isManager, team, onClose, onCreated }: {
  categories: { key: string; label: string }[]; statuses: { key: string; label: string }[];
  tracks: string[]; isManager: boolean; team: TeamUser[];
  onClose: () => void; onCreated: () => void;
}) {
  const [f, setF] = useState<Form>({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<CreateLeadResult | null>(null);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  function build(): NewLeadInput {
    return {
      company: f.company.trim(),
      category: f.category,
      legal_name: f.legal_name.trim(), track: f.track, city: f.city.trim(),
      country: f.country.trim() || "India", address: f.address.trim(),
      website: f.website.trim(), linkedin_url: f.linkedin_url.trim(), gmb_link: f.gmb_link.trim(),
      gst: f.gst.trim(), cin: f.cin.trim(), size_band: f.size_band.trim(),
      what_they_do: f.what_they_do.trim(), contact_name: f.contact_name.trim(),
      designation: f.designation.trim(), email: f.email.trim(),
      phone_primary: f.phone_primary.trim(), phone_secondary: f.phone_secondary.trim(),
      whatsapp: f.whatsapp.trim(),
      decision_maker: f.decision_maker === "yes" ? true : f.decision_maker === "no" ? false : null,
      status: f.status, notes: f.notes.trim(),
      ...(isManager && f.owner_email ? { owner_email: f.owner_email } : {}),
    };
  }

  async function submit() {
    setErr("");
    if (!f.company.trim()) { setErr("Company name is required."); return; }
    if (!f.category) { setErr("Pick the category — it sets the call script and default track."); return; }
    setBusy(true);
    try {
      const r = await createLead(build());
      setResult(r);
      onCreated();               // refresh the queue behind the modal immediately
      setF({ ...BLANK });        // clear for a possible "Add another"
    } catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  }

  if (result) {
    return (
      <Modal title={result.merged ? "Company merged" : "Lead added"} onClose={onClose}
        footer={<>
          <button className="in-btn" onClick={() => setResult(null)}>+ Add another</button>
          <button className="in-btn primary" onClick={onClose}>Done</button>
        </>}>
        <p className="in-muted" style={{ fontSize: 13, margin: 0 }}>
          {result.merged
            ? <>We already had <b>{result.company}</b> — we filled in the blanks you provided and
              did <b>not</b> overwrite anything. </>
            : <><b>{result.company}</b> was created. </>}
          {result.lead_created
            ? "A new lead was opened in the queue."
            : "The lead for this track already existed, so nothing new was started there."}
          {result.contact_created ? " A contact was added." : ""}
        </p>
        <div style={{ marginTop: 12 }}>
          <Link className="in-link" href={`/console/leads/${result.lead_id}`}>Open this lead →</Link>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add a lead" sub="Enter a company the database doesn't have yet. Only Company and Category are required."
      onClose={onClose}
      footer={<>
        <button className="in-btn" onClick={onClose}>Cancel</button>
        <button className="in-btn primary" onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Create lead"}</button>
      </>}>
      {err && <p className="in-err" style={{ marginBottom: 10 }}>{err}</p>}
      <div className="in-grid3" style={{ rowGap: 10 }}>
        <F label="Company *"><input className="in-field" value={f.company} onChange={set("company")} placeholder="Legal / trading name" /></F>
        <F label="Category *">
          <select className="in-field" value={f.category} onChange={set("category")}>
            <option value="">Choose…</option>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select></F>
        <F label="Track (optional)">
          <select className="in-field" value={f.track} onChange={set("track")}>
            <option value="">Default for category</option>
            {tracks.map((t) => <option key={t} value={t}>{t}</option>)}
          </select></F>
        <F label="Legal name"><input className="in-field" value={f.legal_name} onChange={set("legal_name")} /></F>
        <F label="City"><input className="in-field" value={f.city} onChange={set("city")} /></F>
        <F label="Country"><input className="in-field" value={f.country} onChange={set("country")} /></F>
      </div>
      <div style={{ marginTop: 10 }}>
        <F label="Address"><input className="in-field" value={f.address} onChange={set("address")} /></F>
      </div>
      <div className="in-grid3" style={{ rowGap: 10, marginTop: 10 }}>
        <F label="Website"><input className="in-field" value={f.website} onChange={set("website")} placeholder="https://" /></F>
        <F label="LinkedIn"><input className="in-field" value={f.linkedin_url} onChange={set("linkedin_url")} /></F>
        <F label="Google Maps link"><input className="in-field" value={f.gmb_link} onChange={set("gmb_link")} /></F>
        <F label="GSTIN"><input className="in-field" value={f.gst} onChange={set("gst")} /></F>
        <F label="CIN"><input className="in-field" value={f.cin} onChange={set("cin")} /></F>
        <F label="Size band"><input className="in-field" value={f.size_band} onChange={set("size_band")} placeholder="e.g. 50-100" /></F>
      </div>
      <div style={{ marginTop: 10 }}>
        <F label="What they make / do"><input className="in-field" value={f.what_they_do} onChange={set("what_they_do")} /></F>
      </div>

      <div className="in-sec-h" style={{ marginTop: 16 }}>Primary contact</div>
      <div className="in-grid3" style={{ rowGap: 10 }}>
        <F label="Name"><input className="in-field" value={f.contact_name} onChange={set("contact_name")} /></F>
        <F label="Designation"><input className="in-field" value={f.designation} onChange={set("designation")} /></F>
        <F label="Decision maker?">
          <select className="in-field" value={f.decision_maker} onChange={set("decision_maker")}>
            <option value="">Auto (from designation)</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select></F>
        <F label="Email"><input className="in-field" type="email" value={f.email} onChange={set("email")} /></F>
        <F label="Phone"><input className="in-field" value={f.phone_primary} onChange={set("phone_primary")} /></F>
        <F label="Phone 2"><input className="in-field" value={f.phone_secondary} onChange={set("phone_secondary")} /></F>
        <F label="WhatsApp"><input className="in-field" value={f.whatsapp} onChange={set("whatsapp")} /></F>
        <F label="Starting status">
          <select className="in-field" value={f.status} onChange={set("status")}>
            <option value="">Uncontacted (default)</option>
            {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select></F>
        {isManager && (
          <F label="Assign to">
            <select className="in-field" value={f.owner_email} onChange={set("owner_email")}>
              <option value="">Me (self)</option>
              {team.map((t) => <option key={t.email} value={t.email}>{t.name || t.email}</option>)}
            </select></F>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <F label="Notes"><textarea className="in-field" rows={2} value={f.notes} onChange={set("notes")} /></F>
      </div>
    </Modal>
  );
}

// ---- bulk import ---------------------------------------------------------
function ImportModal({ isManager, team, onClose, onImported }: {
  isManager: boolean; team: TeamUser[]; onClose: () => void; onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pick(f: File | null) {
    setErr(""); setResult(null);
    if (!f) { setFile(null); return; }
    const ok = /\.(csv|xlsx)$/i.test(f.name);
    if (!ok) { setErr("Choose a .csv or .xlsx template."); setFile(null); return; }
    if (f.size > MAX_IMPORT_BYTES) { setErr("That file is too large — split it into smaller batches."); setFile(null); return; }
    setFile(f);
  }

  async function run() {
    setErr("");
    if (!file) { setErr("Pick the filled-in template first."); return; }
    setBusy(true);
    try {
      const data_base64 = await fileToBase64(file);
      const r = await importLeadsBase64({
        filename: file.name, data_base64,
        ...(isManager && owner ? { owner_email: owner } : {}),
      });
      setResult(r);
      onImported();
    } catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Import leads"
      sub="Fill the template and upload it back. Companies that already exist are merged, never duplicated."
      onClose={onClose}
      footer={result
        ? <button className="in-btn primary" onClick={onClose}>Done</button>
        : <>
          <button className="in-btn" onClick={onClose}>Cancel</button>
          <button className="in-btn primary" onClick={run} disabled={busy || !file}>
            {busy ? "Importing…" : "Import"}</button>
        </>}>
      {err && <p className="in-err" style={{ marginBottom: 10 }}>{err}</p>}

      {!result ? (<>
        <div className="in-row in-wrap" style={{ gap: 10, marginBottom: 10 }}>
          <input ref={inputRef} type="file" accept=".csv,.xlsx"
            onChange={(e) => pick(e.target.files?.[0] || null)} />
          {file && <span className="in-faint" style={{ fontSize: 12 }}>{file.name}</span>}
        </div>
        <p className="in-muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
          No template yet? Close this and use <b>⭳ Template</b> to download a blank CSV or Excel file with all the fields.
        </p>
        {isManager && (
          <F label="Default owner for new leads">
            <select className="in-field" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Me (self)</option>
              {team.map((t) => <option key={t.email} value={t.email}>{t.name || t.email}</option>)}
            </select>
            <div className="in-faint" style={{ fontSize: 11, marginTop: 4 }}>
              Rows that carry their own “Owner email” column win over this default.
            </div>
          </F>
        )}
      </>) : (
        <>
          <p className="in-ok" style={{ margin: "0 0 8px", fontSize: 13 }}>
            Read {result.rows_read} row{result.rows_read === 1 ? "" : "s"} ·{" "}
            {result.leads_created} lead{result.leads_created === 1 ? "" : "s"} created ·{" "}
            {result.companies_created} new company · {result.companies_merged} merged ·{" "}
            {result.contacts_created} contact{result.contacts_created === 1 ? "" : "s"} added.
          </p>
          {result.rejected.length > 0 && (<>
            <div className="in-sec-h" style={{ marginTop: 8 }}>{result.rejected.length} row(s) skipped</div>
            <div className="in-card in-scroll-x" style={{ maxHeight: 220, overflow: "auto" }}>
              <table className="in-table">
                <thead><tr><th>Row</th><th>Company</th><th>Why</th></tr></thead>
                <tbody>
                  {result.rejected.map((r) => (
                    <tr key={r.row}>
                      <td className="sub">{r.row}</td>
                      <td className="co">{r.company || <span className="in-faint">(blank)</span>}</td>
                      <td className="sub">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>)}
          {!result.rejected.length && <p className="in-faint" style={{ fontSize: 12, margin: 0 }}>Nothing was skipped.</p>}
        </>
      )}
    </Modal>
  );
}

// ---- AI "paste anything" ingestion --------------------------------------
// Paste -> Preview (the AI shows what it understood + the extracted fields) ->
// the rep confirms/edits -> Accept writes it and a completion popup confirms.
// Nothing is saved on preview; the rep can always Discard and go back.
type AiOpt = [string, string];
type AiFld = { key: string; label: string; req?: boolean; type?: "text" | "num" | "area" | "select"; opts?: AiOpt[] };

const SECTOR_OPTS: AiOpt[] = [
  ["", "auto-detect"], ["cnc", "CNC & Machining"], ["foundry", "Foundry & Casting"],
  ["sheet", "Sheet Metal & Fabrication"], ["auto", "Automotive Parts"],
  ["elec", "Electrical Panels"], ["tools", "Tools & Fixtures"], ["plant", "Plant & Machinery"],
];
const YN_OPTS: AiOpt[] = [["", "—"], ["Y", "Yes"], ["N", "No"]];

function fieldsFor(kind: string, cats: AiOpt[], stats: AiOpt[]): AiFld[] {
  if (kind === "rfq") return [
    { key: "title", label: "Title", req: true },
    { key: "sector_key", label: "Sector", type: "select", opts: SECTOR_OPTS },
    { key: "process", label: "Process" }, { key: "material", label: "Material" },
    { key: "qty", label: "Quantity", type: "num" }, { key: "unit", label: "Unit" },
    { key: "budget_low", label: "Budget low", type: "num" }, { key: "budget_high", label: "Budget high", type: "num" },
    { key: "currency", label: "Currency" }, { key: "closes_in_days", label: "Closes in (days)", type: "num" },
    { key: "hub_city", label: "City" }, { key: "issuer_name", label: "Buyer / issuer" },
    { key: "description", label: "Description", type: "area" },
    { key: "notes", label: "Internal notes", type: "area" },
  ];
  if (kind === "supplier_quote") return [
    { key: "rfq_code", label: "RFQ code / #", req: true }, { key: "rfq_title", label: "RFQ title" },
    { key: "supplier_name", label: "Supplier name", req: true },
    { key: "contact_name", label: "Contact name" }, { key: "designation", label: "Designation" },
    { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "city", label: "City" },
    { key: "item", label: "What is quoted", type: "area" },
    { key: "unit_price", label: "Unit price", type: "num" }, { key: "currency", label: "Currency" },
    { key: "qty", label: "Qty", type: "num" }, { key: "unit", label: "Unit" },
    { key: "tooling", label: "Tooling", type: "num" }, { key: "freight", label: "Freight", type: "num" },
    { key: "lead_weeks", label: "Lead time (weeks)", type: "num" },
    { key: "payment_terms", label: "Payment terms" }, { key: "validity_days", label: "Validity (days)", type: "num" },
    { key: "gst_included", label: "GST included?", type: "select", opts: YN_OPTS },
    { key: "notes", label: "Notes", type: "area" },
  ];
  // lead (and the fallback shape)
  return [
    { key: "company", label: "Company", req: true },
    { key: "category", label: "Category", type: "select", opts: [["", "Choose…"], ...cats] },
    { key: "track", label: "Track", type: "select", opts: [["", "Default"], ["supplier", "supplier"], ["buyer", "buyer"]] },
    { key: "city", label: "City" }, { key: "country", label: "Country" },
    { key: "address", label: "Address", type: "area" },
    { key: "website", label: "Website" }, { key: "linkedin_url", label: "LinkedIn" }, { key: "gmb_link", label: "Google Maps" },
    { key: "gst", label: "GSTIN" }, { key: "cin", label: "CIN" }, { key: "size_band", label: "Size band" },
    { key: "what_they_do", label: "What they make", type: "area" },
    { key: "contact_name", label: "Contact name" }, { key: "designation", label: "Designation" },
    { key: "email", label: "Email" }, { key: "phone_primary", label: "Phone" },
    { key: "phone_secondary", label: "Phone 2" }, { key: "whatsapp", label: "WhatsApp" },
    { key: "decision_maker", label: "Decision maker", type: "select", opts: [["", "Auto"], ["Y", "Yes"], ["N", "No"]] },
    { key: "status", label: "Status", type: "select", opts: [["", "Uncontacted"], ...stats] },
    { key: "legal_name", label: "Legal name" }, { key: "notes", label: "Notes", type: "area" },
  ];
}

const KIND_LABEL: Record<string, string> = {
  lead: "Lead / contact", rfq: "RFQ (buyer enquiry)", supplier_quote: "Supplier quote", unknown: "Unclear",
};

function AiIngestModal({ categories, statuses, tracks, isManager, team, onClose, onAccepted }: {
  categories: { key: string; label: string }[]; statuses: { key: string; label: string }[];
  tracks: string[]; isManager: boolean; team: TeamUser[];
  onClose: () => void; onAccepted: () => void;
}) {
  void tracks; // tracks are handled by the fixed supplier/buyer select above
  const catOpts: AiOpt[] = categories.map((c) => [c.key, c.label]);
  const stOpts: AiOpt[] = statuses.map((s) => [s.key, s.label]);

  const [step, setStep] = useState<"paste" | "review" | "done">("paste");
  const [text, setText] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [kind, setKind] = useState<string>("lead");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [owner, setOwner] = useState("");
  const [result, setResult] = useState<AiAcceptResult | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceNote, setVoiceNote] = useState("");
  const audioRef = useRef<HTMLInputElement | null>(null);
  const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

  useEffect(() => {
    let live = true;
    aiStatus().then((s) => { if (live) setConfigured(s.configured); }).catch(() => { if (live) setConfigured(false); });
    return () => { live = false; };
  }, []);

  const spec = fieldsFor(kind, catOpts, stOpts);

  function seedFields(a: AiAnalysis, k: string) {
    const rec = (a.kind === k ? a.record : {}) as Record<string, string | number | null>;
    const next: Record<string, string> = {};
    for (const f of fieldsFor(k, catOpts, stOpts)) {
      const cur = fields[f.key];
      const fromAi = rec[f.key];
      next[f.key] = (fromAi !== undefined && fromAi !== null ? String(fromAi)
        : (cur ?? ""));
    }
    setFields(next);
  }

  async function preview(src?: string) {
    setErr("");
    const body = (src ?? text).trim();
    if (!body) { setErr("Paste some text first."); return; }
    setBusy(true);
    try {
      const r = await aiPreview(body);
      setAnalysis(r.analysis);
      const k = r.analysis.kind === "unknown" ? "lead" : r.analysis.kind;
      setKind(k);
      seedFields({ ...r.analysis, kind: k }, k);
      setStep("review");
    } catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  }

  async function transcribeFile(f: File | null) {
    setErr(""); setVoiceNote("");
    if (!f) return;
    const isAudio = (f.type || "").startsWith("audio/") || /\.(mp3|m4a|wav|ogg|oga|opus|webm|aac|flac|amr)$/i.test(f.name);
    if (!isAudio) { setErr("That file isn't an audio clip (mp3, m4a, wav, ogg, webm…)."); return; }
    if (f.size > MAX_AUDIO_BYTES) { setErr("That recording is too large — keep it under ~15 minutes / 15 MB."); return; }
    setVoiceBusy(true);
    try {
      const data_base64 = await fileToBase64(f);
      const r = await aiTranscribe({ data_base64, mime: f.type, filename: f.name });
      const t = (r.text || "").trim();
      if (!t) { setErr("I couldn't hear anything usable in that clip — try again, or type it in below."); return; }
      setText(t);
      setVoiceNote(`Transcribed from "${f.name}" — check it below, then accept.`);
      await preview(t);            // go straight into the same preview review
    } catch (e) { setErr(msg(e)); }
    finally { setVoiceBusy(false); }
  }

  function changeKind(k: string) {
    setKind(k);
    if (analysis) seedFields(analysis, k);
  }

  async function accept() {
    setErr("");
    // Only send fields that actually carry a value, for the chosen kind.
    const record: Record<string, string> = {};
    for (const f of spec) {
      const v = (fields[f.key] || "").trim();
      if (v) record[f.key] = v;
    }
    const missingReq = spec.filter((f) => f.req && !record[f.key]).map((f) => f.label);
    if (missingReq.length) { setErr(`Still needed: ${missingReq.join(", ")}.`); return; }
    const targetRfqId = kind === "supplier_quote" ? (analysis?.quote?.matched_rfq?.id ?? null) : null;
    setBusy(true);
    try {
      const res = await aiAccept({
        kind, record, summary: analysis?.summary || "",
        raw_text: analysis?.source_text || text,
        target_rfq_id: targetRfqId,
        ...(isManager && owner ? { owner_email: owner } : {}),
      });
      setResult(res);
      onAccepted();
      setStep("done");
    } catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  }

  function reset() {
    setStep("paste"); setText(""); setAnalysis(null); setResult(null); setErr(""); setFields({}); setOwner(""); setVoiceNote("");
  }

  const footer = step === "paste" ? (<>
    <button className="in-btn" onClick={onClose}>Cancel</button>
    <button className="in-btn primary" onClick={() => preview()} disabled={busy || voiceBusy || !text.trim() || configured === false}>
      {busy ? "Analysing…" : "Preview ▸"}</button>
  </>) : step === "review" ? (<>
    <button className="in-btn" onClick={() => setStep("paste")}>‹ Back</button>
    <button className="in-btn" onClick={onClose}>Discard</button>
    <button className="in-btn primary" onClick={accept} disabled={busy}>
      {busy ? "Saving…" : "✓ Accept & save"}</button>
  </>) : (<>
    <button className="in-btn" onClick={reset}>+ Ingest another</button>
    <button className="in-btn primary" onClick={onClose}>Done</button>
  </>);

  const kindBadge = (k: string) => (
    <span className="in-pill st-onboarded" style={{ textTransform: "none" }}>{KIND_LABEL[k] || k}</span>
  );

  const renderInput = (f: AiFld) => {
    const val = fields[f.key] || "";
    const on = (v: string) => setFields((p) => ({ ...p, [f.key]: v }));
    if (f.type === "select") {
      return (
        <select className="in-field" value={val} onChange={(e) => on(e.target.value)}>
          {(f.opts || []).map(([ov, ol]) => <option key={ov} value={ov}>{ol}</option>)}
        </select>);
    }
    if (f.type === "area") {
      return <textarea className="in-field" rows={2} value={val} onChange={(e) => on(e.target.value)} />;
    }
    return (
      <input className="in-field" type={f.type === "num" ? "number" : "text"}
        value={val} onChange={(e) => on(e.target.value)} />);
  };

  return (
    <Modal title="✨ AI ingest" onClose={onClose} footer={footer}
      sub={step === "paste"
        ? "Paste any text — a WhatsApp reply, an email, a call note, an enquiry or a quote. The AI figures out what it is."
        : step === "review"
          ? "Check what the AI understood. Fix anything, then accept to save it."
          : "Done — here's what was written."}>
      {err && <p className="in-err" style={{ marginBottom: 10 }}>{err}</p>}

      {step === "paste" && (<>
        {configured === false && (
          <p className="in-err" style={{ marginBottom: 10 }}>
            AI ingest is not configured on this server (no model key). Use <b>+ Add lead</b> or
            <b> ⇧ Import</b> instead.</p>
        )}
        <div className="in-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input ref={audioRef} type="file" accept="audio/*" style={{ display: "none" }}
            onChange={(e) => { transcribeFile(e.target.files?.[0] || null); e.target.value = ""; }} />
          <button className="in-btn sm" onClick={() => audioRef.current?.click()}
            disabled={configured === false || voiceBusy || busy}>
            {voiceBusy ? "Transcribing…" : "🎙 Voice note"}</button>
          <span className="in-faint" style={{ fontSize: 11 }}>upload a recording, or type / paste text below</span>
        </div>
        {voiceNote && <p className="in-ok" style={{ fontSize: 12, margin: "0 0 8px" }}>{voiceNote}</p>}
        <textarea className="in-field" rows={9} value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"e.g. Priya from Sharma Precision, Pune — laser cutting, 50 ppl, Rakesh proprietor, +91 90000 12345…"} />
        <p className="in-faint" style={{ fontSize: 11, marginTop: 6 }}>
          Nothing is saved until you preview and then accept.</p>
      </>)}

      {step === "review" && analysis && (<>
        <div className="in-card in-pad" style={{ marginBottom: 12 }}>
          <div className="in-row in-wrap" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span className="in-lbl" style={{ margin: 0 }}>I understood this as</span>
            {kindBadge(analysis.kind)}
            <span className="in-faint" style={{ fontSize: 11, marginLeft: "auto" }}>
              confidence {Math.round(analysis.confidence * 100)}% · {analysis.model}</span>
          </div>
          <p style={{ margin: "2px 0 0", fontSize: 13 }}>{analysis.summary || "(no summary)"}</p>

          {analysis.kind !== "unknown" && analysis.lead && (
            <p className="in-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
              Category → <b>{analysis.lead.category_label || "?"}</b>; lands on the{" "}
              <b>{analysis.lead.default_track}</b> track.</p>)}

          {analysis.kind === "rfq" && analysis.rfq && (
            <p className={`in-${analysis.rfq.publish_ready ? "ok" : "muted"}`} style={{ fontSize: 12, margin: "8px 0 0" }}>
              {analysis.rfq.publish_ready
                ? <>Complete enough to <b>publish straight to the board</b> ({analysis.rfq.sector_label}).</>
                : <>Not finished yet — it will be saved as a <b>pending concierge draft</b>. Still needs: {analysis.rfq.would_missing.join(", ")}.</>}
            </p>)}

          {analysis.kind === "supplier_quote" && analysis.quote && (
            <p className="in-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
              {analysis.quote.matched_rfq
                ? <>Matches <b>{analysis.quote.matched_rfq.code}</b> ({analysis.quote.matched_rfq.title}) —{" "}
                  {analysis.quote.will_file_as === "bid" ? "will be filed as a bid." : "no price given, so it will be saved as a supplier lead."}</>
                : <>No RFQ identified in the text, so this will be saved as a <b>supplier lead</b>. Add an RFQ code above to file it as a bid instead.</>}
            </p>)}

          {analysis.notes && <p className="in-faint" style={{ fontSize: 11, margin: "8px 0 0" }}>AI note: {analysis.notes}</p>}
        </div>

        <div className="in-row in-wrap" style={{ gap: 8, marginBottom: 10 }}>
          <span className="in-lbl" style={{ margin: 0 }}>Wrong? Re-file as</span>
          {(["lead", "rfq", "supplier_quote"] as const).map((k) => (
            <button key={k} className={`in-btn sm${kind === k ? " primary" : ""}`}
              onClick={() => changeKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>

        <div className="in-grid3" style={{ rowGap: 10 }}>
          {spec.map((f) => (
            <label key={f.key} style={{ gridColumn: f.type === "area" ? "1 / -1" : undefined }}>
              <span className="in-lbl">{f.label}{f.req ? " *" : ""}</span>{renderInput(f)}</label>
          ))}
          {isManager && kind === "lead" && (
            <F label="Assign to">
              <select className="in-field" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Me (self)</option>
                {team.map((t) => <option key={t.email} value={t.email}>{t.name || t.email}</option>)}
              </select></F>
          )}
        </div>
      </>)}

      {step === "done" && result && (<>
        <p className="in-ok" style={{ margin: "0 0 8px", fontSize: 13 }}>{result.message}</p>
        {result.lead_id ? (
          <Link className="in-link" href={`/console/leads/${result.lead_id}`}>Open this lead →</Link>
        ) : result.rfq ? (
          <p className="in-muted" style={{ fontSize: 12, margin: 0 }}>
            {result.filed_as === "published"
              ? <>Published as <b>{result.rfq.code}</b> on the RFQ board.</>
              : <>Draft <b>#{result.draft_id}</b> is waiting in the concierge queue.</>}</p>
        ) : null}
      </>)}
    </Modal>
  );
}

