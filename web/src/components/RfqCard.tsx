import Link from "next/link";
import type { RfqCard as Card } from "@/lib/api";
import { SectorGlyph } from "@/lib/sectors";
import { deadlineLabel } from "@/lib/format";

export default function RfqCard({ rfq }: { rfq: Card }) {
  const base = rfq.sector.base;
  return (
    <Link
      href={`/rfq/${rfq.id}`}
      className="surface-card overflow-hidden block hover:shadow-[var(--shadow)] transition"
      style={{ display: "flex", flexDirection: "column" }}
    >
      {/* sector color-block header */}
      <div
        className="flex items-center gap-2"
        style={{ background: base, color: "#fff", padding: "8px 14px", fontSize: 12, fontWeight: 600 }}
      >
        <SectorGlyph sector={rfq.sector.key} size={15} />
        {rfq.sector.label}
        <span className="mono" style={{ marginLeft: "auto", fontSize: 11, opacity: 0.85 }}>{rfq.code}</span>
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        <h3 style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.25, margin: 0 }}>{rfq.title}</h3>

        <div className="muted" style={{ fontSize: 12 }}>
          {rfq.qty ? <>{rfq.qty.toLocaleString("en-IN")} {rfq.unit} · </> : null}
          {rfq.material || "Material per spec"}
        </div>

        {/* budget-dominant figure */}
        <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.5px", color: base }}>
          {rfq.budget.range_display}
          {rfq.budget.per_unit && rfq.budget.status === "Priced" ? (
            <span className="muted" style={{ fontSize: 12 }}> / {rfq.budget.per_unit}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 mt-auto" style={{ paddingTop: 4 }}>
          <span className={`chip urgency-${rfq.urgency}`}>
            <span style={{ width: 6, height: 6, borderRadius: 9, background: "currentColor", display: "inline-block" }} />
            {deadlineLabel(rfq.closes_in_days)}
          </span>
          <span className="chip">{rfq.bid_count}/{rfq.routing_cap} bids</span>
          {rfq.bid_count >= rfq.routing_cap && <span className="chip muted">Locked</span>}
        </div>
      </div>
    </Link>
  );
}
