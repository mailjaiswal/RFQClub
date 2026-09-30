import Link from "next/link";

export const metadata = { title: "How it works — RFQClub" };

export default function HowItWorksPage() {
  return (
    <div className="demo">
      <div className="dm-top">
        <span className="dm-mark">RFQ<b>Club</b>.</span>
        <Link className="lnk" href="/">Board</Link>
        <Link className="lnk" href="/how-it-works">How it works</Link>
        <span className="sp" />
        <Link className="post" href="/">Post an RFQ</Link>
      </div>

      <div className="dm-hero">
        <div className="dm-eye">◇ The RFQClub process</div>
        <h1 className="dm-h1">From a WhatsApp voice note to a <em>normalised quote</em> in 48 hours.</h1>
        <p className="dm-sub">No ERP, no forms overload. Send the requirement the way you already do — we structure it, route it to a few right suppliers, and compare their quotes on true landed cost.</p>
      </div>

      {/* 01 process overview */}
      <section>
        <div className="dm-kicker"><span className="n">01</span><h3>Process overview</h3><span>Requirement → decision</span></div>
        <div className="dm-flow">
          <div className="dm-fstep"><div className="dm-fnode">1</div><h4>Requirement received</h4><p>Voice note, WhatsApp text, drawing photo or a form.</p><span className="tagm">Ingest</span></div>
          <div className="dm-fstep"><div className="dm-fnode">2</div><h4>AI structures &amp; asks</h4><p>Mapped to an industry schema; missing specs trigger a clarify loop.</p><span className="tagm">Normalise</span></div>
          <div className="dm-fstep"><div className="dm-fnode">3</div><h4>Routed to ≤5 shops</h4><p>Capped, ranked to verified suppliers who actually make it.</p><span className="tagm">Distribute</span></div>
          <div className="dm-fstep"><div className="dm-fnode">4</div><h4>Quotes come back</h4><p>By voice, PDF or text — replies need no app.</p><span className="tagm">Collect</span></div>
          <div className="dm-fstep"><div className="dm-fnode">5</div><h4>Total-landed-cost view</h4><p>Compared like-for-like with a recommendation + rationale.</p><span className="tagm">Decide</span></div>
        </div>
      </section>

      {/* 02 ingestion methods */}
      <section>
        <div className="dm-kicker"><span className="n">02</span><h3>Ingestion methods</h3><span>Whatever you already use</span></div>
        <div className="dm-ing">
          <div className="dm-ic"><div className="ic" style={{ background: "rgba(37,211,102,.14)" }}><svg viewBox="0 0 24 24" style={{ stroke: "#128C4A" }}><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l2.2-5.3A8.5 8.5 0 1 1 21 11.5z" /></svg></div><b>WhatsApp text</b><span>Forward the group message straight in.</span></div>
          <div className="dm-ic"><div className="ic" style={{ background: "rgba(63,67,151,.12)" }}><svg viewBox="0 0 24 24" style={{ stroke: "#3F4397" }}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg></div><b>Voice note</b><span>Hinglish &amp; vernacular speech-to-text.</span></div>
          <div className="dm-ic"><div className="ic" style={{ background: "rgba(198,92,30,.12)" }}><svg viewBox="0 0 24 24" style={{ stroke: "#C65C1E" }}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-7 7" /></svg></div><b>Drawing / PDF</b><span>Photo or scan → OCR the title block.</span></div>
          <div className="dm-ic"><div className="ic" style={{ background: "rgba(30,108,120,.12)" }}><svg viewBox="0 0 24 24" style={{ stroke: "#1E6C78" }}><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg></div><b>Forwarded msg</b><span>Chained forwards de-duplicated &amp; parsed.</span></div>
          <div className="dm-ic"><div className="ic" style={{ background: "rgba(58,58,58,.1)" }}><svg viewBox="0 0 24 24" style={{ stroke: "#3A3A3A" }}><path d="M12 5v14M5 12h14" /></svg></div><b>Web form</b><span>Or fill the “Post an RFQ” form directly.</span></div>
        </div>
      </section>

      {/* 03 AI output snapshot */}
      <section>
        <div className="dm-kicker"><span className="n">03</span><h3>AI output snapshot</h3><span>After RFQs are received</span></div>
        <div className="dm-out">
          <div className="dm-panel">
            <h5><span className="live" />Structured RFQ · RFQ·0451</h5>
            <div className="dm-rfqtitle">5-axis CNC machined pump housings</div>
            <div className="dm-field"><span className="k">Material</span><span className="v">Duplex 2205</span><span className="conf cf-hi">98%</span></div>
            <div className="dm-field"><span className="k">Quantity</span><span className="v">1,200 pcs</span><span className="conf cf-hi">96%</span></div>
            <div className="dm-field"><span className="k">Standards</span><span className="v">ISO 2768-k</span><span className="conf cf-md">82%</span></div>
            <div className="dm-field"><span className="k">Budget</span><span className="v">₹8–15 L/unit</span><span className="conf cf-md">75%</span></div>
            <div className="dm-field"><span className="k">Deadline</span><span className="v">25 days</span><span className="conf cf-hi">90%</span></div>
            <div className="dm-field"><span className="k">Tolerance</span><span className="v">Not stated</span><span className="conf cf-gap">gap</span></div>
            <div className="dm-ask"><b>Clarify loop:</b> “Confirm ±tolerance &amp; surface finish on the sealing face?” — auto-sent to buyer before routing.</div>
          </div>
          <div className="dm-panel">
            <h5><span className="live" />Quote comparison · total landed cost</h5>
            <table className="dm-tbl">
              <thead><tr><th>Supplier</th><th>Unit</th><th>Tooling</th><th>Freight</th><th>Lead</th><th>TLC</th></tr></thead>
              <tbody>
                <tr className="best"><td className="sup">Ganesh Precision<small>Pune · verified</small><span className="dm-badge">Best value</span></td><td>₹640</td><td>₹40k</td><td>₹18k</td><td>4 wk</td><td><b>₹8.6 L</b></td></tr>
                <tr><td className="sup">Coimbatore Machines<small>Coimbatore</small></td><td>₹610</td><td>₹55k</td><td>₹26k</td><td>6 wk</td><td>₹9.1 L</td></tr>
                <tr><td className="sup">Rajkot FabWorks<small>Rajkot</small></td><td>₹655</td><td>₹30k</td><td>₹31k</td><td>5 wk</td><td>₹9.4 L</td></tr>
              </tbody>
            </table>
            <div className="dm-rec"><b>Recommendation:</b> Ganesh Precision — lowest total landed cost with the shortest lead time; unit price is above Rajkot but ₹31k lower tooling + freight nets out cheaper overall.</div>
          </div>
        </div>
      </section>

      {/* 04 trust before the data exists */}
      <section>
        <div className="dm-kicker"><span className="n">04</span><h3>Trust before the data exists</h3><span>How we de-risk the first order</span></div>
        <p className="dm-trust-lead">On day one RFQClub has <b>no delivered-order history</b> to score suppliers with — and the bidder is <b>blinded</b> until you award. So early buyer confidence comes from the <b>transaction design</b>, not a star rating: verify who can play, hold the money, inspect the goods — and let reputation data earn its way in later.</p>
        <div className="dm-trust">
          <div className="dm-tr"><div className="tn" style={{ background: "#3F4397" }}>1</div><b>Verified onboarding</b><span>GST + KYC and a real capability check (machines, certs, past parts) before a shop can even receive an RFQ.</span><span className="ph">Live at launch</span></div>
          <div className="dm-tr"><div className="tn" style={{ background: "#C65C1E" }}>2</div><b>De-risked first order</b><span>Start with a small trial / first-article-inspection lot; release the full production run only after the FAI passes.</span><span className="ph">Live at launch</span></div>
          <div className="dm-tr"><div className="tn" style={{ background: "#1E6C78" }}>3</div><b>Escrow &amp; milestones</b><span>Payment is held by RFQClub and released on delivery milestones — a brand-new shop can&apos;t run off with your advance.</span><span className="ph">Live at launch</span></div>
          <div className="dm-tr"><div className="tn" style={{ background: "#2E7D46" }}>4</div><b>Managed QC at dispatch</b><span>Optional third-party dimensional + NDT inspection before shipment; the report gates the final payment release.</span><span className="ph">Live at launch</span></div>
          <div className="dm-tr"><div className="tn" style={{ background: "#8A3A5E" }}>5</div><b>Reputation earns its way in</b><span>Once a shop has delivered orders here, its <b>orders · on-time % · reject %</b> appear on the bid — the stat is earned, never assumed.</span><span className="ph p2">Phase 2</span></div>
        </div>
      </section>

      <div className="dm-foot">Structured for Indian SMEs — ₹ pricing, WhatsApp-first, verified hub suppliers (Pune · Rajkot · Coimbatore).</div>
    </div>
  );
}
