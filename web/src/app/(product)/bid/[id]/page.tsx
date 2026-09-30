import Link from "next/link";
import { notFound } from "next/navigation";
import { getRfq, getBids } from "@/lib/api";
import BidForm from "@/components/BidForm";

export const dynamic = "force-dynamic";

export default async function BidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let rfq, bidsMeta;
  try {
    rfq = await getRfq(id);
    bidsMeta = await getBids(id).catch(() => null);
  } catch {
    notFound();
  }
  const awarded = !!bidsMeta?.revealed;

  return (
    <>
      <div className="ap-subbar">
        <Link href={`/rfq/${rfq.id}`} className="ap-back">← {rfq.code}</Link>
      </div>

      <div className="ap-detail">
        <div className="card" style={{ marginTop: 0 }}>
          <h1 style={{ fontFamily: "var(--font-fraunces),serif", fontWeight: 600, fontSize: 24, letterSpacing: "-.5px", margin: 0 }}>
            Bid on “{rfq.title}”
          </h1>
          <p style={{ fontSize: 13, color: "var(--subtle)", margin: "10px 0 4px", maxWidth: 640 }}>
            Quote your <strong>total landed cost</strong> — unit price plus tooling and freight, GST
            handled explicitly. The buyer sees only blinded bids (A–E) ranked on landed cost and lead time.
          </p>
        </div>

        <div style={{ marginTop: 16 }}>
          {awarded ? (
            <div className="card" style={{ textAlign: "center", padding: 32, marginTop: 0 }}>
              <div className="chip" style={{ width: "fit-content", margin: "0 auto", color: "#2E7D46", borderColor: "rgba(46,125,70,.4)", background: "rgba(46,125,70,.08)" }}>🏆 This RFQ has been awarded</div>
              <p className="muted" style={{ marginTop: 10 }}>The buyer has selected a supplier — bidding is closed.</p>
            </div>
          ) : rfq.is_open ? (
            <BidForm rfq={rfq} />
          ) : (
            <div className="card" style={{ textAlign: "center", padding: 32, marginTop: 0 }}>
              <div className="chip urgency-red" style={{ width: "fit-content", margin: "0 auto" }}>This RFQ has closed</div>
              <p className="muted" style={{ marginTop: 10 }}>Bidding is no longer accepted.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
