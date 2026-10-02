"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getBoard,
  getRfqOrder,
  updateRfqOrder,
  type OrderState,
  type OrderUpdate,
  type RfqCard,
} from "@/lib/api";

// Concierge delivery desk: for every awarded RFQ the operator advances the
// escrow state, the managed-QC state and each payment milestone. Mirrors the
// buyer-facing OrderTracker but with the controls (POST /api/operator/.../order,
// which enforces the operator role server-side; this section only renders
// inside the operator-only /review page).

const ESCROW: [string, string][] = [
  ["not_started", "Escrow not started"],
  ["funded", "Advance funded · held"],
  ["part_released", "Part released on milestone"],
  ["released", "Fully released to supplier"],
];
const QC: [string, string][] = [
  ["n/a", "QC not scheduled"],
  ["scheduled", "QC scheduled"],
  ["in_progress", "QC in progress"],
  ["passed", "QC passed at dispatch"],
  ["failed", "QC failed — held"],
];
const MSTATE = ["pending", "active", "done"] as const;

const DOT: Record<string, string> = { done: "#2E7D46", active: "#B77A1B", pending: "#B8B2A4" };

function OpsCard({ rfq }: { rfq: RfqCard }) {
  const [order, setOrder] = useState<OrderState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getRfqOrder(rfq.id).then((o) => live && setOrder(o)).catch(() => {});
    return () => { live = false; };
  }, [rfq.id]);

  async function patch(body: OrderUpdate) {
    setBusy(true);
    setErr(null);
    try {
      const r = await updateRfqOrder(rfq.id, body);
      setOrder((prev) => ({ ...(prev ?? { exists: true }), ...r }));
    } catch (e) {
      setErr(e instanceof Error ? `⚠ ${e.message}` : "update failed");
    } finally {
      setBusy(false);
    }
  }

  if (!order?.exists) return null;

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div className="rv-dhead">
        <Link className="rv-title sm" href={`/rfq/${rfq.id}`}>{rfq.code} · {rfq.title}</Link>
      </div>
      <div className="muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
        {order.supplier_name || "supplier withheld"}
        {order.supplier_hub ? ` · ${order.supplier_hub}` : ""}
        {order.tlc_display ? ` — ${order.tlc_display} landed` : ""}
        {order.updated_at ? ` · updated ${new Date(order.updated_at).toLocaleDateString("en-IN")}` : ""}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <select className="field" style={{ flex: 1, minWidth: 180 }} disabled={busy}
          value={order.escrow_status || "not_started"}
          onChange={(e) => patch({ escrow_status: e.target.value })}>
          {ESCROW.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="field" style={{ flex: 1, minWidth: 180 }} disabled={busy}
          value={order.qc_status || "n/a"}
          onChange={(e) => patch({ qc_status: e.target.value })}>
          {QC.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <ol style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
        {(order.milestones || []).map((m, i) => (
          <li key={m.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderTop: i ? "1px solid var(--line, #E4E1DA)" : "none" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: DOT[m.state] || DOT.pending, flex: "0 0 auto" }} />
            <span style={{ fontSize: 13, flex: 1 }}>{m.label}</span>
            <select className="field" style={{ width: 110, fontSize: 12 }} disabled={busy}
              value={m.state}
              onChange={(e) => patch({ milestone_key: m.key, milestone_state: e.target.value })}>
              {MSTATE.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </li>
        ))}
      </ol>
      {err && <div className="rv-warn" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

export default function OrderOps() {
  const [awarded, setAwarded] = useState<RfqCard[] | null>(null);

  useEffect(() => {
    let live = true;
    getBoard({ status: "awarded" }).then((d) => live && setAwarded(d.items)).catch(() => live && setAwarded([]));
    return () => { live = false; };
  }, []);

  if (awarded === null) return null;

  return (
    <section style={{ marginTop: 28 }}>
      <div className="label-mono" style={{ margin: "4px 0 10px" }}>
        Orders in delivery · escrow, managed QC &amp; milestones
      </div>
      {awarded.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
          No awarded RFQs yet — the tracker appears once a buyer awards a bid.
        </div>
      ) : (
        awarded.map((r) => <OpsCard key={r.id} rfq={r} />)
      )}
    </section>
  );
}
