import Link from "next/link";
import { notFound } from "next/navigation";
import { getRfq, getBids } from "@/lib/api";
import { SectorGlyph } from "@/lib/sectors";
import { deadlineLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let rfq, bidsMeta;
  try {
    [rfq, bidsMeta] = await Promise.all([getRfq(id), getBids(id).catch(() => null)]);
  } catch {
    notFound();
  }
  const base = rfq.sector.base;
  const bidSlots = Array.from({ length: rfq.routing_cap });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 grid lg:grid-cols-[1fr_320px] gap-6">
      <div>
        <div className="flex items-center gap-2 muted" style={{ fontSize: 12 }}>
          <Link href="/">← Board</Link>
          <span className="mono">{rfq.code}</span>
        </div>

        <div className="surface-card overflow-hidden" style={{ marginTop: 10 }}>
          <div className="flex items-center gap-2" style={{ background: base, color: "#fff", padding: "10px 18px" }}>
            <SectorGlyph sector={rfq.sector.key} size={16} />
            <span style={{ fontWeight: 600 }}>{rfq.sector.label}</span>
            <span className={`chip urgency-${rfq.urgency}`} style={{ marginLeft: "auto", background: "rgba(255,255,255,.18)", color: "#fff", borderColor: "transparent" }}>
              {deadlineLabel(rfq.closes_in_days)}
            </span>
          </div>

          <div style={{ padding: 20 }}>
            <h1 className="display" style={{ fontSize: 24, letterSpacing: "-0.5px", margin: 0 }}>{rfq.title}</h1>
            <p className="subtle" style={{ marginTop: 10, fontSize: 13.5 }}>{rfq.description || rfq.title}</p>

            <div className="grid sm:grid-cols-2 gap-x-8" style={{ marginTop: 16 }}>
              <KV k="Process" v={rfq.process || "—"} />
              <KV k="Material / grade" v={rfq.material || "—"} />
              <KV k="Quantity" v={rfq.qty ? `${rfq.qty.toLocaleString("en-IN")} ${rfq.unit}` : "—"} />
              <KV k="Budget" v={`${rfq.budget.range_display}${rfq.budget.status === "Priced" ? ` / ${rfq.budget.per_unit}` : ""}`} />
              <KV k="Est. order value" v={rfq.est_total_display} />
              <KV k="Closes" v={rfq.closes_at ? new Date(rfq.closes_at).toLocaleDateString("en-IN") : "No fixed date"} />
            </div>
          </div>
        </div>

        {/* clarify block */}
        {rfq.clarify?.length > 0 && (
          <div className="surface-card" style={{ padding: 18, marginTop: 16, borderColor: "var(--saffron)" }}>
            <div className="label-mono" style={{ color: "var(--saffron)" }}>Points the concierge flagged</div>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--subtle)" }}>
              {rfq.clarify.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}

        {rfq.spec_notes && (
          <div className="surface-card" style={{ padding: 18, marginTop: 16 }}>
            <div className="label-mono">Spec notes</div>
            <p style={{ fontSize: 13, marginTop: 6, color: "var(--subtle)" }}>{rfq.spec_notes}</p>
          </div>
        )}

        {rfq.attachments?.length > 0 && (
          <div className="surface-card" style={{ padding: 18, marginTop: 16 }}>
            <div className="label-mono">Attachments</div>
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--subtle)" }}>
              {rfq.attachments.length} file(s) available to verified members.
            </div>
          </div>
        )}
      </div>

      {/* sticky aside */}
      <aside>
        <div className="surface-card" style={{ padding: 18, position: "sticky", top: 76 }}>
          <div className="label-mono">Total landed cost bid</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 600, color: base, margin: "6px 0" }}>
            {rfq.budget.range_display}
          </div>
          {rfq.is_open ? (
            <Link href={`/bid/${rfq.id}`} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
              Submit a bid →
            </Link>
          ) : (
            <div className="chip urgency-red" style={{ width: "100%", justifyContent: "center" }}>This RFQ has closed</div>
          )}

          {/* routing meter */}
          <div style={{ marginTop: 18 }}>
            <div className="flex items-center justify-between" style={{ fontSize: 12 }}>
              <span className="muted">Routing to shops</span>
              <span className="mono">{rfq.bid_count}/{rfq.routing_cap}</span>
            </div>
            <div className="flex gap-1" style={{ marginTop: 8 }}>
              {bidSlots.map((_, i) => (
                <div key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: i < rfq.bid_count ? base : "var(--hairline)" }} />
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              Bids are capped at {rfq.routing_cap} shops. {bidsMeta?.locked ? "Slots are full." : "There may still be room."}
            </p>
          </div>

          {/* buyer card (identity withheld) */}
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
            <div className="label-mono">Buyer</div>
            <div style={{ fontSize: 13, marginTop: 6, fontWeight: 600 }}>Verified buyer · name withheld</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{rfq.buyer_note}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <span className="muted" style={{ fontSize: 12.5 }}>{k}</span>
      <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right" }}>{v}</span>
    </div>
  );
}
