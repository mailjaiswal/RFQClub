import Link from "next/link";

export default function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--hairline)", background: "var(--paper)" }}>
      <div className="mx-auto max-w-6xl px-4 py-8 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div>
          <div className="display" style={{ fontSize: 16 }}>RFQClub</div>
          <p className="muted" style={{ fontSize: 12, maxWidth: 420, marginTop: 4 }}>
            The total-landed-cost RFQ exchange for Indian job shops. Bids stay blinded
            until the buyer awards one.
          </p>
        </div>
        <nav className="flex gap-5" style={{ fontSize: 12.5, color: "var(--subtle)" }}>
          <Link href="/" className="hover:opacity-70">Board</Link>
          <Link href="/how-it-works" className="hover:opacity-70">How it works</Link>
        </nav>
      </div>
    </footer>
  );
}
