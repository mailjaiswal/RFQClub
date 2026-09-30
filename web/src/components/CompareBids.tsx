"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { BlindedBid, BidsResponse } from "@/lib/api";

// Backend returns ribbon as a machine key; map to display label + colour.
const RIBBON: Record<string, { label: string; color: string; bg: string }> = {
  best_value: { label: "★ Best value", color: "#fff", bg: "#3F4397" },
  lowest_cost: { label: "Lowest cost", color: "#fff", bg: "#266B3C" },
  fastest: { label: "Fastest", color: "#fff", bg: "#B77A1B" },
  exception: { label: "⚑ Exception", color: "#fff", bg: "#B23A2B" },
};

type Sort = "landed" | "lead" | "perunit";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

function perUnitLanded(b: BlindedBid, qty: number | null): number | null {
  if (!qty || qty <= 0) return null;
  return b.tlc_rupees / qty;
}

// Deterministic, data-derived rationale line (no fabricated insight).
function rationale(b: BlindedBid, minTlc: number, minLead: number | null): string {
  if (b.exception_flag) return "Flagged as an exception — confirm the assumptions below before awarding.";
  const delta = b.tlc_cents / 100 - minTlc;
  const parts: string[] = [];
  if (delta <= 0.5) parts.push("Lowest total landed cost in this comparison.");
  else parts.push(`${inr(delta)} (${Math.round((delta / minTlc) * 100)}%) above the leading landed cost.`);
  if (b.lead_weeks != null && minLead != null && b.lead_weeks <= minLead) parts.push("also the shortest lead time.");
  parts.push(b.gst_included ? "Quote includes GST." : "GST to be added on top.");
  return parts.join(" ");
}

export default function CompareBids({ data }: { data: BidsResponse }) {
  const rfq = data.rfq;
  const bids = data.bids;
  const [sort, setSort] = useState<Sort>("landed");
  const [shortlist, setShortlist] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);

  const { minTlc, minLead } = useMemo(() => {
    const qualified = bids.filter((b) => !b.exception_flag);
    const pool = qualified.length ? qualified : bids;
    const t = pool.length ? Math.min(...pool.map((b) => b.tlc_cents / 100)) : 0;
    const leads = bids.map((b) => b.lead_weeks).filter((x): x is number => x != null);
    return { minTlc: t, minLead: leads.length ? Math.min(...leads) : null };
  }, [bids]);

  const ordered = useMemo(() => {
    const c = [...bids];
    if (sort === "lead") c.sort((a, b) => (a.lead_weeks ?? 1e9) - (b.lead_weeks ?? 1e9));
    else if (sort === "perunit") c.sort((a, b) => (perUnitLanded(a, rfq.qty) ?? 1e12) - (perUnitLanded(b, rfq.qty) ?? 1e12));
    else c.sort((a, b) => a.tlc_cents - b.tlc_cents);
    return c;
  }, [bids, sort, rfq.qty]);

  function toggleShortlist(id: number) {
    setShortlist((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="ap-subbar">
        <Link href={`/rfq/${rfq.id}`} className="ap-back">← {rfq.code}</Link>
        <span className="code">Compare bids</span>
      </div>

      <div className="ap-detail">
        <div className="cmp-head">
          <div className="cmp-title">
            <span className="ap-sec" style={{ color: rfq.sector.base }}>
              <i style={{ background: rfq.sector.base }} />{rfq.sector.label}
            </span>
            <h1>{rfq.title}</h1>
            <div className="cmp-sub">
              {rfq.qty ? `${rfq.qty.toLocaleString("en-IN")} ${rfq.unit}` : "Quantity per spec"}
              {rfq.hub_city ? ` · Buyer hub ${rfq.hub_city}` : ""}
            </div>
          </div>
          <div className="cmp-trust">
            <div className="cmp-count"><b>{bids.length}</b> of ≤{rfq.routing_cap} bids</div>
            <span className="cmp-lock">🔒 Comparison locked · suppliers cannot see each other's prices</span>
            <span className="cmp-blind">Identities stay hidden (Bid A–E) until you award</span>
          </div>
        </div>

        {bids.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
            No bids received yet. They'll appear here, blinded, as shops respond.
          </div>
        ) : (
          <>
            <div className="cmp-seg" role="tablist" aria-label="Sort bids">
              <span className="lbl">Rank by</span>
              {([["landed", "Landed cost"], ["lead", "Lead time"], ["perunit", "Per-unit landed"]] as [Sort, string][]).map(
                ([k, label]) => (
                  <button key={k} role="tab" aria-selected={sort === k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>
                    {label}
                  </button>
                ),
              )}
            </div>

            <div className="cmp-scroll">
              {ordered.map((b) => {
                const rb = b.ribbon ? RIBBON[b.ribbon] : null;
                const pu = perUnitLanded(b, rfq.qty);
                const isSel = selected === b.bid_id;
                const isShort = shortlist.has(b.bid_id);
                return (
                  <article key={b.bid_id} className={`cmp-card${isSel ? " sel" : ""}${b.exception_flag ? " exc" : ""}`}>
                    {rb && <span className="cmp-ribbon" style={{ background: rb.bg }}>{rb.label}</span>}

                    <div className="cmp-bid">
                      <span className="cmp-bidcode">{b.code}</span>
                      <label className="cmp-pick" title="Select to award">
                        <input type="radio" name="award" checked={isSel} onChange={() => setSelected(b.bid_id)} />
                      </label>
                    </div>

                    <div className="cmp-tlc">
                      <div className="cmp-tlcn">{b.tlc_display}</div>
                      <div className="cmp-tlcl">Total landed cost{pu != null ? ` · ${b.per_unit_landed_display || inr(pu)}/pc` : ""}</div>
                    </div>

                    <div className="cmp-ai">{rationale(b, minTlc, minLead)}</div>

                    <div className="cmp-hdr">
                      <span className="cmp-name">Verified supplier</span>
                      <span className="cmp-loc">{b.hub_city || "—"}{b.distance_km != null ? ` · ${b.distance_km} km` : ""}</span>
                    </div>
                    {b.verified && <span className="cmp-badge">✓ KYC verified</span>}

                    <div className="cmp-rows">
                      <Row k="Unit price" v={b.unit_price_display} />
                      <Row k="Tooling / one-time" v={inr(b.tooling)} />
                      <Row k="Freight" v={inr(b.freight)} />
                      <Row k="GST" v={b.gst_included ? "Included" : "Excluded"} />
                      <Row k="Lead time" v={b.lead_weeks != null ? `${b.lead_weeks} weeks` : "—"} />
                      <Row k="Payment terms" v={b.payment_terms || "—"} />
                      {b.validity_days != null && <Row k="Validity" v={`${b.validity_days} days`} />}
                    </div>

                    {b.capability_tags?.length > 0 && (
                      <div className="ap-tags" style={{ marginTop: 10 }}>
                        {b.capability_tags.map((t, i) => <span key={i} className="ap-tag process">{t}</span>)}
                      </div>
                    )}
                    {b.certifications?.length > 0 && (
                      <div className="ap-tags" style={{ marginTop: 6 }}>
                        {b.certifications.map((t, i) => <span key={i} className="ap-tag cert">{t}</span>)}
                      </div>
                    )}

                    {b.exception_flag && b.exception_note && (
                      <div className="cmp-exc-note">{b.exception_note}</div>
                    )}

                    <button className={`cmp-star${isShort ? " on" : ""}`} onClick={() => toggleShortlist(b.bid_id)} aria-pressed={isShort}>
                      {isShort ? "★ Shortlisted" : "☆ Shortlist"}
                    </button>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>

      {bids.length > 0 && (
        <div className="cmp-bar">
          <span className="cmp-barinfo">
            {selected ? <>Award ready — <b>{ordered.find((b) => b.bid_id === selected)?.code}</b> selected</> : <>Select a bid to award</>}
            {shortlist.size > 0 && <> · {shortlist.size} shortlisted</>}
          </span>
          <button className="cmp-award" disabled title="Award flow coming soon">Confirm award</button>
        </div>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="cmp-row">
      <span className="cmp-rk">{k}</span>
      <span className="cmp-rv">{v}</span>
    </div>
  );
}
