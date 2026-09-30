import Link from "next/link";
import { notFound } from "next/navigation";
import { getRfq } from "@/lib/api";
import BidForm from "@/components/BidForm";

export const dynamic = "force-dynamic";

export default async function BidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let rfq;
  try {
    rfq = await getRfq(id);
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center gap-2 muted" style={{ fontSize: 12, marginBottom: 12 }}>
        <Link href={`/rfq/${rfq.id}`}>← {rfq.code}</Link>
      </div>
      <h1 className="display" style={{ fontSize: 26, letterSpacing: "-0.5px", margin: "0 0 4px" }}>
        Bid on “{rfq.title}”
      </h1>
      <p className="subtle" style={{ fontSize: 13, marginBottom: 20, maxWidth: 640 }}>
        Quote your <strong>total landed cost</strong> — unit price plus tooling and freight, GST
        handled explicitly. The buyer sees only blinded bids (A–E) ranked on landed cost and lead time.
      </p>

      {rfq.is_open ? (
        <BidForm rfq={rfq} />
      ) : (
        <div className="surface-card" style={{ padding: 32, textAlign: "center" }}>
          <div className="chip urgency-red" style={{ width: "fit-content", margin: "0 auto" }}>This RFQ has closed</div>
          <p className="muted" style={{ marginTop: 10 }}>Bidding is no longer accepted.</p>
        </div>
      )}
    </div>
  );
}
