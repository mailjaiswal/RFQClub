import Link from "next/link";
import { getBoard, type RfqCard } from "@/lib/api";

export const dynamic = "force-dynamic";

type Status = { label: string; cls: string };

function statusOf(r: RfqCard): Status {
  if (r.status === "awarded") return { label: "Awarded", cls: "awarded" };
  if (!r.is_open) return { label: "Closed", cls: "closed" };
  if (r.bid_count >= r.routing_cap) return { label: "Ready to award", cls: "ready" };
  if (r.bid_count > 0) return { label: "Bids in", cls: "bids" };
  return { label: "Open", cls: "open" };
}

export default async function MyRfqsPage() {
  let items: RfqCard[] = [];
  try {
    // Awarded RFQs leave the published board — fetch them too so decisions stay visible.
    const [board, awarded] = await Promise.all([
      getBoard(),
      getBoard({ status: "awarded" }).catch(() => null),
    ]);
    const active = board.items.filter((r) => r.bid_count > 0).sort((a, b) => b.bid_count - a.bid_count);
    const done = awarded ? awarded.items.sort((a, b) => b.id - a.id) : [];
    // Representative "your posts" set: awarded first, then most-active bids.
    items = [...done, ...active].slice(0, 10);
  } catch {
    items = [];
  }

  return (
    <>
      <div className="ap-subbar">
        <span className="code" style={{ marginLeft: 0 }}>Buyer console</span>
        <span className="code">My RFQs</span>
      </div>

      <div className="ap-detail">
        <div className="mr-head">
          <h1>Your posted requirements</h1>
          <p>Track bid flow on every RFQ you've published and jump into the blinded comparison to decide an award.</p>
        </div>
        <div className="mr-note">
          <b>Demo buyer view.</b> Showing {items.length} representative RFQs from the live board — per-user accounts and your own posts arrive in Phase 2.
        </div>

        <div className="mr-table">
          <div className="mr-row mr-hd">
            <span>RFQ</span><span>Requirement</span><span>Status</span><span className="c">Bids</span>
            <span className="c">Closes</span><span className="r">Est. value</span><span className="r">Action</span>
          </div>
          {items.map((r) => {
            const st = statusOf(r);
            return (
              <div className="mr-row" key={r.id}>
                <span className="mr-code mono">{r.code}</span>
                <span className="mr-title">
                  <span className="mr-sec" style={{ color: r.sector.base }}><i style={{ background: r.sector.base }} />{r.sector.label}</span>
                  <Link href={`/rfq/${r.id}`}>{r.title}</Link>
                </span>
                <span><em className={`mr-st ${st.cls}`}>{st.label}</em></span>
                <span className="c mono">{r.bid_count}/{r.routing_cap}</span>
                <span className="c mono">{r.closes_in_days == null ? "—" : r.closes_in_days <= 0 ? "today" : `${r.closes_in_days}d`}</span>
                <span className="r mono">{r.est_total_display}</span>
                <span className="r mr-act">
                  {r.bid_count > 0 && <Link className="mr-cmp" href={`/rfq/${r.id}/compare`}>Compare →</Link>}
                  <Link className="mr-view" href={`/rfq/${r.id}`}>View</Link>
                </span>
              </div>
            );
          })}
        </div>
        {items.length === 0 && (
          <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>No posted RFQs to show yet.</div>
        )}
      </div>
    </>
  );
}
