"use client";
import { useEffect, useState } from "react";
import { getRfqOrder, type OrderState } from "@/lib/api";

// Buyer-side "Order · escrow & delivery" tracker. Only meaningful once an RFQ is
// awarded; it surfaces the trust mechanisms advertised on How-it-works (payment
// held in escrow, released against milestones, optional managed QC before the
// final release). Renders nothing when there is no order (un-awarded / error).

const ESCROW_LABEL: Record<string, string> = {
  not_started: "Escrow not started",
  funded: "Advance funded · held by RFQClub",
  part_released: "Part released on milestone",
  released: "Fully released to supplier",
};
const QC_LABEL: Record<string, string> = {
  "n/a": "QC not scheduled",
  scheduled: "QC inspection scheduled",
  in_progress: "QC inspection in progress",
  passed: "QC passed at dispatch",
  failed: "QC failed — held",
};

const DOT = { done: "#2E7D46", active: "#B77A1B", pending: "#B8B2A4" } as const;

export default function OrderTracker({ rfqId }: { rfqId: number }) {
  const [order, setOrder] = useState<OrderState | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getRfqOrder(rfqId)
      .then((o) => alive && setOrder(o))
      .catch(() => alive && setOrder(null))
      .finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [rfqId]);

  if (!loaded || !order?.exists) return null;

  const escrow = order.escrow_status || "not_started";
  const qc = order.qc_status || "n/a";
  const milestones = order.milestones || [];

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="lbl">Order · escrow &amp; delivery</div>
      {order.supplier_name && (
        <div style={{ fontSize: 13, marginTop: 6 }}>
          Awarded to <b>{order.supplier_name}</b>
          {order.supplier_hub ? ` · ${order.supplier_hub}` : ""}
          {order.tlc_display ? ` — ${order.tlc_display} landed` : ""}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <span className="chip" title="Escrow state">{ESCROW_LABEL[escrow] || escrow}</span>
        <span className="chip" title="Managed QC state">{QC_LABEL[qc] || qc}</span>
      </div>

      {milestones.length > 0 && (
        <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
          {milestones.map((m, i) => (
            <li key={m.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: i ? "1px solid var(--line, #E4E1DA)" : "none" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: DOT[m.state] || DOT.pending, flex: "0 0 auto" }} />
              <span style={{ fontSize: 13, color: m.state === "pending" ? "var(--subtle)" : "inherit", fontWeight: m.state === "active" ? 600 : 400 }}>
                {m.label}
              </span>
              {m.state === "done" && <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "#2E7D46" }}>done</span>}
              {m.state === "active" && <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "#B77A1B" }}>in progress</span>}
            </li>
          ))}
        </ol>
      )}

      {order.updated_at && (
        <p className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>
          Last updated {new Date(order.updated_at).toLocaleDateString("en-IN")} · progress managed by the RFQClub concierge.
        </p>
      )}
    </div>
  );
}
