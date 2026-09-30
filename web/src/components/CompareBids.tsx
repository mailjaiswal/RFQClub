"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { awardBid, getBids, type BlindedBid, type BidsResponse } from "@/lib/api";

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
  const [resp, setResp] = useState<BidsResponse>(data);
  const rfq = resp.rfq;
  const bids = resp.bids;
  const [sort, setSort] = useState<Sort>("landed");
  const [shortlist, setShortlist] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [changing, setChanging] = useState(false); // "Change award" → re-open selection
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const awardedId = resp.revealed ? resp.awarded_bid_id ?? null : null;
  const awarded = awardedId != null && !changing;
  const winner = awardedId != null ? bids.find((b) => b.bid_id === awardedId) : undefined;
  // Selection UI is live before an award, and again while explicitly re-awarding.
  const picking = bids.length > 0 && (awardedId == null || changing);

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

  const selBid = ordered.find((b) => b.bid_id === selected);

  function toggleShortlist(id: number) {
    setShortlist((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function doAward() {
    if (selected == null || busy) return;
    setBusy(true); setError(null);
    try {
      await awardBid(rfq.id, selected);
      setResp(await getBids(rfq.id)); // re-fetch: winner identity now revealed
      setConfirmOpen(false); setChanging(false); setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Award failed — try again.");
    } finally {
      setBusy(false);
    }
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
            {awardedId != null ? (
              <span className="cmp-blind done">🏆 Awarded — unsuccessful suppliers stay blinded</span>
            ) : (
              <span className="cmp-blind">Identities stay hidden (Bid A–E) until you award</span>
            )}
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
                const isWinner = b.bid_id === awardedId;
                const isLost = awardedId != null && !isWinner;
                const rb = isWinner ? null : b.ribbon ? RIBBON[b.ribbon] : null;
                const pu = perUnitLanded(b, rfq.qty);
                const isSel = selected === b.bid_id;
                const isShort = shortlist.has(b.bid_id);
                return (
                  <article key={b.bid_id} className={`cmp-card${isSel ? " sel" : ""}${b.exception_flag ? " exc" : ""}${isWinner ? " won" : ""}${isLost ? " lost" : ""}`}>
                    {isWinner && <span className="cmp-ribbon awrd">🏆 Awarded</span>}
                    {rb && <span className="cmp-ribbon" style={{ background: rb.bg }}>{rb.label}</span>}

                    <div className="cmp-bid">
                      <span className="cmp-bidcode">{b.code}</span>
                      {picking ? (
                        <label className="cmp-pick" title="Select to award">
                          <input type="radio" name="award" checked={isSel} onChange={() => setSelected(b.bid_id)} />
                        </label>
                      ) : isWinner ? (
                        <span className="cmp-wonic" title="Current award">🏆</span>
                      ) : null}
                    </div>

                    <div className="cmp-tlc">
                      <div className="cmp-tlcn">{b.tlc_display}</div>
                      <div className="cmp-tlcl">Total landed cost{pu != null ? ` · ${b.per_unit_landed_display || inr(pu)}/pc` : ""}</div>
                    </div>

                    <div className="cmp-ai">{rationale(b, minTlc, minLead)}</div>

                    <div className="cmp-hdr">
                      <span className="cmp-name">{isWinner && b.revealed_name ? b.revealed_name : "Verified supplier"}</span>
                      <span className="cmp-loc">{b.hub_city || "—"}{b.distance_km != null ? ` · ${b.distance_km} km` : ""}</span>
                    </div>
                    {isLost && <span className="cmp-notsel">Not selected · identity stays hidden</span>}
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
        <div className={`cmp-bar${awardedId != null && !changing ? " awrd" : ""}`}>
          {awardedId != null && !changing ? (
            <>
              <span className="cmp-barinfo">
                🏆 Awarded to <b>{winner?.revealed_name || winner?.code || "the selected supplier"}</b>
                {winner ? <> · {winner.tlc_display}{winner.lead_weeks != null ? ` · ${winner.lead_weeks} weeks` : ""}</> : null}
              </span>
              <button className="cmp-change" onClick={() => { setChanging(true); setError(null); }}>Change award</button>
            </>
          ) : (
            <>
              <span className="cmp-barinfo">
                {changing ? <>Re-awarding — <b>pick a new winner</b> (current: {winner?.code})</> :
                  selected ? <>Award ready — <b>{selBid?.code}</b> · {selBid?.tlc_display} landed</> : <>Select a bid to award</>}
                {shortlist.size > 0 && <> · {shortlist.size} shortlisted</>}
              </span>
              {error && <span className="cmp-err">⚠ {error}</span>}
              <button
                className="cmp-award"
                disabled={selected == null || selected === awardedId || busy}
                onClick={() => { setError(null); setConfirmOpen(true); }}
              >
                {busy ? "Awarding…" : changing ? "Confirm re-award" : "Confirm award"}
              </button>
            </>
          )}
        </div>
      )}

      {confirmOpen && selBid && (
        <div className="cmp-modal-wrap" onClick={() => !busy && setConfirmOpen(false)}>
          <div className="cmp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="k">Confirm award · {rfq.code}</div>
            <h3>Award {selBid.code} — {selBid.tlc_display} landed?</h3>
            <p>
              {selBid.revealed_name ? selBid.revealed_name : "The winning supplier's"} identity will be revealed to you,
              the RFQ closes for new bids, and the other bidders stay blinded. You can change the award later.
            </p>
            <div className="cmp-modal-sum">
              <span>{selBid.code} · {selBid.tlc_display}</span>
              <span>{selBid.lead_weeks != null ? `${selBid.lead_weeks} weeks lead` : "Lead time not set"}</span>
              <span>{selBid.payment_terms || "Terms per quote"}</span>
            </div>
            {error && <div className="cmp-err">⚠ {error}</div>}
            <div className="row">
              <button className="skip" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</button>
              <button className="nx" onClick={doAward} disabled={busy}>{busy ? "Awarding…" : "Yes, award it"}</button>
            </div>
          </div>
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
