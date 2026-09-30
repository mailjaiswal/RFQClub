"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RfqDetail } from "@/lib/api";
import { submitBid } from "@/lib/api";
import { computeTLC, formatINR } from "@/lib/format";

export default function BidForm({ rfq }: { rfq: RfqDetail }) {
  const router = useRouter();
  const qty = rfq.qty ?? 1;

  const [unitPrice, setUnitPrice] = useState<string>(rfq.budget.low ? String(rfq.budget.low) : "");
  const [tooling, setTooling] = useState("0");
  const [freight, setFreight] = useState("0");
  const [gst, setGst] = useState(true);
  const [lead, setLead] = useState("");
  const [terms, setTerms] = useState("30 / 70");
  const [validity, setValidity] = useState("30");

  const [supplierName, setSupplierName] = useState("");
  const [hubCity, setHubCity] = useState("");
  const [distance, setDistance] = useState("");
  const [tags, setTags] = useState("");

  const [exception, setException] = useState(false);
  const [exceptionNote, setExceptionNote] = useState("");
  const [declaration, setDeclaration] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const num = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(/[^0-9.]/g, "")) || 0);

  const tlc = useMemo(
    () => computeTLC(num(unitPrice), qty, num(tooling), num(freight), gst),
    [unitPrice, tooling, freight, gst, qty],
  );
  const perPc = qty ? tlc / qty : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!declaration) {
      setError("Please confirm the declaration before submitting.");
      return;
    }
    if (num(unitPrice) <= 0) {
      setError("Enter a unit price greater than zero.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitBid(rfq.id, {
        supplier_name: supplierName.trim() || "Unnamed shop",
        hub_city: hubCity.trim(),
        distance_km: distance ? num(distance) : null,
        capability_tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        unit_price: num(unitPrice),
        tooling: num(tooling),
        freight: num(freight),
        gst_included: gst,
        lead_weeks: lead ? num(lead) : null,
        payment_terms: terms,
        validity_days: validity ? num(validity) : null,
        exception_flag: exception,
        exception_note: exception ? exceptionNote : "",
        source: "web",
      });
      setDone(res.bidder_code);
      setTimeout(() => router.push(`/rfq/${rfq.id}`), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit bid.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="surface-card" style={{ padding: 32, textAlign: "center" }}>
        <div className="display" style={{ fontSize: 22 }}>Bid lodged as <span style={{ color: "var(--oxide)" }}>Bid {done}</span></div>
        <p className="muted" style={{ marginTop: 8 }}>Your identity is hidden from the buyer until they award. Redirecting…</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
      <div>
        <div className="surface-card" style={{ padding: 20 }}>
          <div className="label-mono">Landed-cost calculator</div>
          <div className="grid sm:grid-cols-2 gap-4" style={{ marginTop: 12 }}>
            <Field label={`Unit price (per ${rfq.unit || "pc"})`}>
              <input className="field input-money" inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0" />
            </Field>
            <Field label={`Qty on this RFQ`}>
              <input className="field input-money" value={`${qty.toLocaleString("en-IN")} ${rfq.unit}`} readOnly tabIndex={-1} />
            </Field>
            <Field label="Tooling / one-time">
              <input className="field input-money" inputMode="decimal" value={tooling} onChange={(e) => setTooling(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Freight to buyer">
              <input className="field input-money" inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" />
            </Field>
          </div>

          <label className="flex items-center gap-2" style={{ marginTop: 14, fontSize: 13 }}>
            <input type="checkbox" checked={gst} onChange={(e) => setGst(e.target.checked)} />
            Price includes 18% GST
          </label>

          <div className="grid sm:grid-cols-3 gap-4" style={{ marginTop: 16 }}>
            <Field label="Lead time (weeks)">
              <input className="field input-money" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} placeholder="e.g. 6" />
            </Field>
            <Field label="Payment terms">
              <select className="field" value={terms} onChange={(e) => setTerms(e.target.value)}>
                <option>Advance</option>
                <option>30 / 70</option>
                <option>40 / 60</option>
                <option>50 / 50</option>
                <option>60 days credit</option>
              </select>
            </Field>
            <Field label="Validity (days)">
              <input className="field input-money" inputMode="numeric" value={validity} onChange={(e) => setValidity(e.target.value)} placeholder="30" />
            </Field>
          </div>
        </div>

        {/* spec compliance */}
        <div className="surface-card" style={{ padding: 20, marginTop: 16 }}>
          <div className="label-mono">Spec compliance</div>
          <div className="flex gap-4" style={{ marginTop: 10, fontSize: 13 }}>
            <label className="flex items-center gap-2">
              <input type="radio" name="comp" checked={!exception} onChange={() => setException(false)} /> Fully compliant
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="comp" checked={exception} onChange={() => setException(true)} /> Raise an exception
            </label>
          </div>
          {exception && (
            <textarea
              className="field" style={{ marginTop: 12, minHeight: 70 }}
              placeholder="Describe the deviation (tolerance, outsourced process, etc.)"
              value={exceptionNote} onChange={(e) => setExceptionNote(e.target.value)}
            />
          )}
        </div>

        {/* supplier identity */}
        <div className="surface-card" style={{ padding: 20, marginTop: 16 }}>
          <div className="label-mono">Your shop (hidden from buyer until award)</div>
          <div className="grid sm:grid-cols-2 gap-4" style={{ marginTop: 12 }}>
            <Field label="Shop name"><input className="field" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. Coimbatore Machining Works" /></Field>
            <Field label="Hub city"><input className="field" value={hubCity} onChange={(e) => setHubCity(e.target.value)} placeholder="City, State" /></Field>
            <Field label="Distance to buyer (km)"><input className="field input-money" inputMode="numeric" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="e.g. 120" /></Field>
            <Field label="Capability tags"><input className="field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="5-Axis, NDT, Anodising" /></Field>
          </div>
        </div>

        <label className="flex items-start gap-2" style={{ marginTop: 16, fontSize: 12.5, color: "var(--subtle)" }}>
          <input type="checkbox" style={{ marginTop: 3 }} checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} />
          I declare this bid is genuine, I can meet the stated lead time, and pricing is firm for the validity period.
        </label>

        {error && <div className="chip urgency-red" style={{ marginTop: 12, width: "fit-content" }}>{error}</div>}
      </div>

      {/* sticky summary */}
      <aside>
        <div className="surface-card" style={{ padding: 20, position: "sticky", top: 76 }}>
          <div className="label-mono">Your total landed cost</div>
          <div className="mono" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-1px", color: rfq.sector.base, margin: "8px 0" }}>
            {formatINR(tlc)}
          </div>
          <div className="kv"><span className="muted">Unit × qty</span><span className="mono">{formatINR(num(unitPrice) * qty)}</span></div>
          <div className="kv"><span className="muted">Tooling</span><span className="mono">{formatINR(num(tooling))}</span></div>
          <div className="kv"><span className="muted">Freight</span><span className="mono">{formatINR(num(freight))}</span></div>
          <div className="kv"><span className="muted">GST {gst ? "included (+18%)" : "excluded"}</span><span className="mono">{formatINR(gst ? tlc - (num(unitPrice) * qty + num(tooling) + num(freight)) : 0)}</span></div>
          <div className="kv"><span className="muted">Effective / {rfq.unit || "pc"}</span><span className="mono">{formatINR(perPc)}</span></div>

          <p className="muted" style={{ fontSize: 11.5, margin: "12px 0" }}>
            The server recomputes and stores this landed cost; you'll be ranked against up to {rfq.routing_cap} blinded bids.
          </p>

          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit bid"}
          </button>
          <Link href={`/rfq/${rfq.id}`} className="btn btn-outline" style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>
            Cancel
          </Link>
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
