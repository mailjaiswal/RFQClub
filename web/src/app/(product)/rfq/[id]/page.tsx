import Link from "next/link";
import { notFound } from "next/navigation";
import { getRfq, getBids } from "@/lib/api";
import { reqToken } from "@/lib/server-token";
import { deadlineLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

const KIND_CLASS: Record<string, string> = { process: "process", material: "mat", cert: "cert" };

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let rfq, bidsMeta;
  try {
    const tk = await reqToken();
    [rfq, bidsMeta] = await Promise.all([getRfq(id, tk), getBids(id, tk).catch(() => null)]);
  } catch {
    notFound();
  }
  const base = rfq.sector.base;
  const bidSlots = Array.from({ length: rfq.routing_cap });
  const awardedBid = bidsMeta?.revealed
    ? bidsMeta.bids.find((b) => b.bid_id === bidsMeta.awarded_bid_id)
    : undefined;

  return (
    <>
      <div className="ap-subbar">
        <Link href="/" className="ap-back">← Board</Link>
        <span className="code">{rfq.code}</span>
      </div>

      <div className="ap-detail">
        <div className="dwrap">
          <div>
            <div className="ap-hero">
              <div className="ap-band" style={{ background: base }}>
                <div className="ap-sec"><i />{rfq.sector.label}</div>
                <span style={{ marginLeft: "auto", fontFamily: "var(--font-jetbrains),monospace", fontSize: 11 }}>{deadlineLabel(rfq.closes_in_days)}</span>
              </div>
              <div className="body">
                <h1>{rfq.title}</h1>
                <p style={{ fontSize: 13.5, color: "var(--subtle)", marginTop: 10 }}>{rfq.description || rfq.title}</p>

                {rfq.tags?.length > 0 && (
                  <div className="ap-tags" style={{ marginTop: 14 }}>
                    {rfq.tags.map((t, i) => (
                      <span key={i} className={`ap-tag${KIND_CLASS[t.kind] ? " " + KIND_CLASS[t.kind] : ""}`}>{t.label}</span>
                    ))}
                  </div>
                )}

                <div className="dgrid">
                  <DRow k="Process" v={rfq.process || "—"} />
                  <DRow k="Material / grade" v={rfq.material || "—"} />
                  <DRow k="Quantity" v={rfq.qty ? `${rfq.qty.toLocaleString("en-IN")} ${rfq.unit}` : "—"} />
                  <DRow k="Budget" v={`${rfq.budget.range_display}${rfq.budget.status === "Priced" ? ` / ${rfq.budget.per_unit}` : ""}`} />
                  <DRow k="Est. order value" v={rfq.est_total_display} />
                  <DRow k="Buyer hub" v={rfq.hub_city || "—"} />
                  <DRow k="Posted" v={rfq.posted_days_ago != null ? `${rfq.posted_days_ago} days ago` : "—"} />
                  <DRow k="Closes" v={rfq.closes_at ? new Date(rfq.closes_at).toLocaleDateString("en-IN") : "No fixed date"} />
                </div>
              </div>
            </div>

            {rfq.clarify?.length > 0 && (
              <div className="card saffron">
                <div className="lbl" style={{ color: "var(--saffron)" }}>Points the concierge flagged</div>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--subtle)" }}>
                  {rfq.clarify.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}

            {rfq.spec_notes && (
              <div className="card">
                <div className="lbl">Spec notes</div>
                <p style={{ fontSize: 13, marginTop: 6, color: "var(--subtle)" }}>{rfq.spec_notes}</p>
              </div>
            )}

            {rfq.attachments?.length > 0 && (
              <div className="card">
                <div className="lbl">Attachments</div>
                <div style={{ marginTop: 8, fontSize: 13, color: "var(--subtle)" }}>
                  {rfq.attachments.length} file(s) available to verified members.
                </div>
              </div>
            )}
          </div>

          {/* sticky aside */}
          <aside className="aside">
            <div className="card" style={{ marginTop: 0 }}>
              <div className="lbl">Total landed cost bid</div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 600, color: base, margin: "6px 0" }}>
                {rfq.budget.range_display}
              </div>
              {awardedBid ? (
                <div className="chip" style={{ width: "100%", justifyContent: "center", color: "#2E7D46", borderColor: "rgba(46,125,70,.4)", background: "rgba(46,125,70,.08)" }}>
                  🏆 Awarded · {awardedBid.revealed_name || awardedBid.code}
                </div>
              ) : rfq.is_open ? (
                <Link href={`/bid/${rfq.id}`} className="btn-dark" id="t-bid" style={{ display: "block", textAlign: "center" }}>
                  Submit a bid →
                </Link>
              ) : (
                <div className="chip urgency-red" style={{ width: "100%", justifyContent: "center" }}>This RFQ has closed</div>
              )}

              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span className="muted">Routing to shops</span>
                  <span className="mono">{rfq.bid_count}/{rfq.routing_cap}</span>
                </div>
                <div className="meter">
                  {bidSlots.map((_, i) => <i key={i} className={i < rfq.bid_count ? "on" : ""} />)}
                </div>
                <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                  Bids are capped at {rfq.routing_cap} shops. {bidsMeta?.locked ? "Slots are full." : "There may still be room."}
                </p>
              </div>

              {bidsMeta && bidsMeta.count > 0 && (
                <Link href={`/rfq/${rfq.id}/compare`} className="btn-outline" style={{ display: "block", textAlign: "center", marginTop: 16 }}>
                  Compare bids ({bidsMeta.count}) →
                </Link>
              )}

              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #E4E1DA" }}>
                <div className="lbl">Buyer</div>
                <div style={{ fontSize: 13, marginTop: 6, fontWeight: 600 }}>Verified buyer · name withheld</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{rfq.buyer_note}</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

function DRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="drow">
      <span className="dk">{k}</span>
      <span className="dv">{v}</span>
    </div>
  );
}
