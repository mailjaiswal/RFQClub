"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { intakeRfq, type IntakeResult } from "@/lib/api";
import { SECTOR_LIST } from "@/lib/sectors";
import { getUser } from "@/lib/session";

// The web "Post an RFQ" form. It does NOT publish to the board — it files a
// review draft (POST /api/rfqs/intake) that a concierge must approve, which is
// the mandatory human gate in front of the board (see api/workflow.py).
export default function PostForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [process, setProcess] = useState("");
  const [material, setMaterial] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [budgetLow, setBudgetLow] = useState("");
  const [budgetHigh, setBudgetHigh] = useState("");
  const [days, setDays] = useState("14");
  const [sectorKey, setSectorKey] = useState("");
  const [hubCity, setHubCity] = useState("");

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<IntakeResult | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  const DRAFT_KEY = "rfqclub_post_draft";

  // Resolve sign-in and recover any unsaved draft on mount.
  useEffect(() => {
    setSignedIn(!!getUser());
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.title || d.description || d.process || d.material) {
          if (d.title) setTitle(d.title);
          if (d.description) setDescription(d.description);
          if (d.process) setProcess(d.process);
          if (d.material) setMaterial(d.material);
          if (d.qty) setQty(d.qty);
          if (d.unit) setUnit(d.unit);
          if (d.budgetLow) setBudgetLow(d.budgetLow);
          if (d.budgetHigh) setBudgetHigh(d.budgetHigh);
          if (d.days) setDays(d.days);
          if (d.sectorKey) setSectorKey(d.sectorKey);
          if (d.hubCity) setHubCity(d.hubCity);
          setDraftRestored(true);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Autosave draft whenever fields change
  useEffect(() => {
    if (done) return;
    const hasContent = title.trim() || description.trim() || process.trim() || material.trim();
    if (!hasContent) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            title, description, process, material, qty, unit,
            budgetLow, budgetHigh, days, sectorKey, hubCity,
            savedAt: Date.now(),
          }),
        );
      } catch {
        // storage quota exceeded or unavailable
      }
    }, 400);
    return () => clearTimeout(t);
  }, [title, description, process, material, qty, unit, budgetLow, budgetHigh, days, sectorKey, hubCity, done]);

  function discardDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setTitle("");
    setDescription("");
    setProcess("");
    setMaterial("");
    setQty("");
    setUnit("pcs");
    setBudgetLow("");
    setBudgetHigh("");
    setDays("14");
    setSectorKey("");
    setHubCity("");
    setDraftRestored(false);
  }

  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^0-9.]/g, "")) || null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 4) {
      setError("Give the requirement a short title (at least 4 characters).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await intakeRfq({
        title: title.trim(),
        description: description.trim(),
        process: process.trim(),
        material: material.trim(),
        qty: num(qty),
        unit: unit.trim() || "pcs",
        budget_low: num(budgetLow),
        budget_high: num(budgetHigh),
        closes_in_days: num(days),
        sector_key: sectorKey,
        hub_city: hubCity.trim(),
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      setDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not file your requirement.");
    } finally {
      setSubmitting(false);
    }
  }

  if (signedIn === false) {
    return (
      <div className="surface-card" style={{ padding: 28, textAlign: "center" }}>
        <div className="display" style={{ fontSize: 20 }}>Sign in to post a requirement</div>
        <p className="muted" style={{ marginTop: 8, maxWidth: 460, marginInline: "auto" }}>
          Every RFQ is tied to a verified business account, so posting needs a quick email sign-in.
        </p>
        <Link href="/login?next=/post" className="btn btn-primary" style={{ marginTop: 14 }}>Sign in to continue</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="surface-card" style={{ padding: 28 }}>
        <div className="chip" style={{ width: "fit-content", color: "#2E7D46", borderColor: "rgba(46,125,70,.4)", background: "rgba(46,125,70,.08)" }}>
          ✓ Filed for review · {done.sector_label}
        </div>
        <h2 className="display" style={{ fontSize: 22, margin: "12px 0 4px" }}>Thanks — a concierge is on it.</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Your requirement is now in the review queue. A human structures and publishes it, so it isn&apos;t on the
          board yet. You&apos;ll see it under <Link href="/my-rfqs" style={{ textDecoration: "underline" }}>My RFQs</Link> once it&apos;s live.
        </p>
        {done.clarify.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="label-mono">A few things we still need</div>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--subtle)", lineHeight: 1.7 }}>
              {done.clarify.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
            <Link href={`/draft/${done.draft_id}`} className="btn btn-outline" style={{ marginTop: 12 }}>
              Answer now →
            </Link>
          </div>
        )}
        <div className="flex gap-3" style={{ marginTop: 18 }}>
          <button className="btn btn-outline" onClick={() => setDone(null)}>Post another</button>
          <Link href="/my-rfqs" className="btn btn-primary">Track my submissions</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
      <div>
        {draftRestored && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              borderRadius: "8px",
              background: "rgba(63, 67, 151, 0.08)",
              border: "1px solid rgba(63, 67, 151, 0.22)",
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--foreground, #222)" }}>
              📝 <strong>Restored draft</strong> from your previous unsaved session.
            </span>
            <button
              type="button"
              onClick={discardDraft}
              style={{
                background: "transparent",
                border: "none",
                color: "#d32f2f",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "underline",
              }}
            >
              Discard draft
            </button>
          </div>
        )}
        <div className="surface-card" style={{ padding: 20 }}>
          <div className="label-mono">The requirement</div>
          <div style={{ marginTop: 12 }}>
            <Field label="Title">
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 5-axis machined pump housings in Duplex 2205" maxLength={200} />
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label="Describe it in your own words (tolerances, finish, standards, drawings…)">
              <textarea className="field" style={{ minHeight: 110 }} value={description}
                onChange={(e) => setDescription(e.target.value)} maxLength={4000}
                placeholder="Paste the spec or voice-note text — we structure it for you." />
            </Field>
          </div>
        </div>

        <div className="surface-card" style={{ padding: 20, marginTop: 16 }}>
          <div className="label-mono">Specification (optional — leave blank and the concierge will ask)</div>
          <div className="grid sm:grid-cols-2 gap-4" style={{ marginTop: 12 }}>
            <Field label="Process"><input className="field" value={process} onChange={(e) => setProcess(e.target.value)} placeholder="5-axis machining, sand casting…" /></Field>
            <Field label="Material / grade"><input className="field" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="SS 316, Duplex 2205, Al 6061…" /></Field>
            <Field label="Quantity"><input className="field input-money" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 1200" /></Field>
            <Field label="Unit">
              <select className="field" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {["pcs", "kg", "sets", "m", "nos"].map((u) => <option key={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Sector">
              <select className="field" value={sectorKey} onChange={(e) => setSectorKey(e.target.value)}>
                <option value="">Auto-detect</option>
                {SECTOR_LIST.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Hub city (delivery)"><input className="field" value={hubCity} onChange={(e) => setHubCity(e.target.value)} placeholder="Pune, Maharashtra" /></Field>
          </div>
        </div>

        <div className="surface-card" style={{ padding: 20, marginTop: 16 }}>
          <div className="label-mono">Budget &amp; timing</div>
          <div className="grid sm:grid-cols-3 gap-4" style={{ marginTop: 12 }}>
            <Field label="Budget low (₹)"><input className="field input-money" inputMode="numeric" value={budgetLow} onChange={(e) => setBudgetLow(e.target.value)} placeholder="open" /></Field>
            <Field label="Budget high (₹)"><input className="field input-money" inputMode="numeric" value={budgetHigh} onChange={(e) => setBudgetHigh(e.target.value)} placeholder="open" /></Field>
            <Field label="Quote closes in (days)"><input className="field input-money" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="14" /></Field>
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            Leave the budget blank to route it open. Nothing is published until a concierge reviews it.
          </p>
        </div>

        {error && <div className="chip urgency-red" style={{ marginTop: 12, width: "fit-content" }}>{error}</div>}
      </div>

      <aside>
        <div className="surface-card" style={{ padding: 20, position: "sticky", top: 76 }}>
          <div className="label-mono">What happens next</div>
          <ol style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--subtle)", lineHeight: 1.8 }}>
            <li>We structure your requirement into an RFQ.</li>
            <li>A concierge checks it and asks you to clarify anything missing.</li>
            <li>Only then it&apos;s published and routed to up to 5 verified shops.</li>
          </ol>
          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 16 }} disabled={submitting}>
            {submitting ? "Filing…" : "Submit for review"}
          </button>
          <Link href="/board" className="btn btn-outline" style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>Cancel</Link>
        </div>
      </aside>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
