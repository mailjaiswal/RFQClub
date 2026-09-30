import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <span className="concept-num mono" style={{ color: "var(--saffron)", fontWeight: 700, letterSpacing: 1 }}>
        HOW RFQCLUB WORKS
      </span>
      <h1 className="display" style={{ fontSize: 34, letterSpacing: "-1px", lineHeight: 1.1, margin: "8px 0 0" }}>
        Total landed cost, decided blind, revealed on award.
      </h1>

      <div className="flex gap-2" style={{ margin: "18px 0 32px" }}>
        <Link href="/" className="btn btn-primary">Browse open RFQs</Link>
      </div>

      <Step n="01" title="A buyer posts a requirement">
        Requirements arrive messy — a forwarded chat, a photo of a drawing, a voice note. Our
        regex parser plus an optional LLM-assist structure it into sector, process, material,
        quantity and budget. <strong>A concierge reviews every capture before it hits the board.</strong>{" "}
        Nothing unverified reaches suppliers.
      </Step>

      <Step n="02" title="Suppliers bid on total landed cost">
        Not a bare unit price. A bid is unit price × quantity, <strong>plus tooling, plus freight,</strong>{" "}
        with GST declared explicitly. The server recomputes and stores the landed figure so every
        bid is ranked on the same, honest number.
      </Step>

      <Step n="03" title="The buyer compares blinded bids">
        Bids are routed to at most <strong>5 shops</strong>. The buyer sees Bid A–E with landed
        cost, lead time, capability tags, hub city and distance — but never the shop's name.
        Ribbons flag best value, lowest cost, fastest and any spec exceptions.
      </Step>

      <Step n="04" title="Award reveals only the winner">
        When the buyer awards one bid, that supplier's identity is revealed and everyone else stays
        anonymous. The winning shop gets a direct line to move forward.
      </Step>

      <div className="surface-card" style={{ padding: 22, marginTop: 28, borderColor: "var(--oxide)" }}>
        <div className="label-mono" style={{ color: "var(--oxide)" }}>Trust before the data exists</div>
        <p style={{ fontSize: 13.5, marginTop: 8, color: "var(--subtle)", lineHeight: 1.6 }}>
          Reputation stats (on-time %, reject %, response quality) are earned from delivered-order
          outcomes — they don't exist on day one. So Phase&nbsp;1 leans on mechanisms instead:
          verified onboarding, a trial / first-article-inspection lot, escrow, and managed QC.
          The rating follows performance, it doesn't precede it.
        </p>
      </div>

      <div className="flex gap-2" style={{ marginTop: 28 }}>
        <Link href="/" className="btn btn-outline">Back to board</Link>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "18px 0", borderTop: "1px solid var(--hairline)" }}>
      <div className="mono" style={{ color: "var(--saffron)", fontWeight: 700, fontSize: 13, minWidth: 28 }}>{n}</div>
      <div>
        <h2 className="display" style={{ fontSize: 19, margin: "0 0 6px" }}>{title}</h2>
        <p style={{ fontSize: 13.5, color: "var(--subtle)", lineHeight: 1.6, margin: 0 }}>{children}</p>
      </div>
    </div>
  );
}
