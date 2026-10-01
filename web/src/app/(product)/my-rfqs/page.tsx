import Link from "next/link";
import {
  getBoard,
  getMyBids,
  getMyRfqs,
  getMySubmissions,
  type MyBidItem,
  type RfqCard,
  type SubmissionItem,
} from "@/lib/api";
import { reqToken } from "@/lib/server-token";

export const dynamic = "force-dynamic";

type Status = { label: string; cls: string };

function statusOf(r: RfqCard): Status {
  if (r.status === "awarded") return { label: "Awarded", cls: "awarded" };
  if (!r.is_open) return { label: "Closed", cls: "closed" };
  if (r.bid_count >= r.routing_cap) return { label: "Ready to award", cls: "ready" };
  if (r.bid_count > 0) return { label: "Bids in", cls: "bids" };
  return { label: "Open", cls: "open" };
}

const BID_CLS: Record<MyBidItem["status"], string> = {
  Won: "awarded",
  Lost: "closed",
  Live: "bids",
  Closed: "closed",
};

const SUB_CLS: Record<string, string> = {
  PENDING: "open",
  APPROVED: "bids",
  REJECTED: "closed",
};
const SUB_LABEL: Record<string, string> = {
  PENDING: "In review",
  APPROVED: "Approved",
  REJECTED: "Not published",
};

export default async function MyRfqsPage() {
  const token = await reqToken();
  let items: RfqCard[] = [];
  let bids: MyBidItem[] = [];
  let submissions: SubmissionItem[] = [];
  let personal = false;

  try {
    if (token) {
      // Signed in: show this user's own posts + bids (empty until they act).
      const [mine, mineBids, mineSubs] = await Promise.all([
        getMyRfqs(token),
        getMyBids(token).catch(() => null),
        getMySubmissions(token).catch(() => null),
      ]);
      personal = true;
      items = mine.items;
      bids = mineBids?.items ?? [];
      submissions = mineSubs?.items ?? [];
    } else {
      // Anonymous demo: representative set from the live board.
      const [board, awarded] = await Promise.all([
        getBoard(),
        getBoard({ status: "awarded" }).catch(() => null),
      ]);
      const active = board.items.filter((r) => r.bid_count > 0).sort((a, b) => b.bid_count - a.bid_count);
      const done = awarded ? awarded.items.sort((a, b) => b.id - a.id) : [];
      items = [...done, ...active].slice(0, 10);
    }
  } catch {
    // Bad/expired token etc. — fall back to the anonymous demo view.
    personal = false;
    items = [];
    bids = [];
    submissions = [];
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
        {personal ? (
          <div className="mr-note ok">
            <b>Signed-in view.</b> Showing your {items.length} posted RFQ{items.length === 1 ? "" : "s"}
            {bids.length > 0 && <> and {bids.length} bid{bids.length === 1 ? "" : "s"}</>}.
          </div>
        ) : (
          <div className="mr-note">
            <b>Demo buyer view.</b> Showing {items.length} representative RFQs from the live board —{" "}
            <Link href="/login" style={{ textDecoration: "underline" }}>sign in</Link> to track your own posts and bids.
          </div>
        )}

        {personal && submissions.length > 0 && (
          <>
            <div className="mr-head" style={{ marginTop: 26 }}>
              <h1>In concierge review</h1>
              <p>Requirements you filed that a concierge is still structuring — they aren&apos;t on the board yet.</p>
            </div>
            <div className="mr-table">
              <div className="mr-row mr-hd">
                <span>Filed</span><span>Requirement</span><span>Status</span><span className="r">Action</span>
              </div>
              {submissions.map((s) => (
                <div className="mr-row" key={s.draft_id}>
                  <span className="mono">#{s.draft_id}</span>
                  <span className="mr-title">
                    <span className="mr-sec">{s.sector_label}</span>
                    <span>{s.title || "(untitled)"}</span>
                  </span>
                  <span>
                    <em className={`mr-st ${SUB_CLS[s.status] ?? "open"}`}>{SUB_LABEL[s.status] ?? s.status}</em>
                    {s.status === "REJECTED" && s.reject_reason && (
                      <span className="muted" style={{ display: "block", fontSize: 11.5, marginTop: 3 }}>{s.reject_reason}</span>
                    )}
                  </span>
                  <span className="r mr-act">
                    {s.duplicate_of && <span className="muted" style={{ fontSize: 11 }}>dup of {s.duplicate_of.code}</span>}
                    <Link className="mr-post" href="/post">New +</Link>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

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
        {items.length === 0 && !personal && (
          <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>No posted RFQs to show yet.</div>
        )}
        {items.length === 0 && personal && (
          <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
            You haven't posted an RFQ yet — <Link href="/post" style={{ textDecoration: "underline" }}>post your first requirement</Link>.
          </div>
        )}

        {personal && (
          <>
            <div className="mr-head" style={{ marginTop: 34 }}>
              <h1>My bids</h1>
              <p>Quotes you submitted. Supplier identities stay blinded until the buyer awards the work.</p>
            </div>
            <div className="mr-table">
              <div className="mr-row mr-hd mr-bids">
                <span>RFQ</span><span>Requirement</span><span>Status</span>
                <span className="r">Your TLC</span><span className="c">Bid</span>
              </div>
              {bids.map((b) => (
                <div className="mr-row mr-bids" key={b.bid_id}>
                  <span className="mr-code mono">{b.rfq?.code ?? "—"}</span>
                  <span className="mr-title">
                    {b.rfq && (
                      <span className="mr-sec" style={{ color: b.rfq.sector.base }}><i style={{ background: b.rfq.sector.base }} />{b.rfq.sector.label}</span>
                    )}
                    {b.rfq ? <Link href={`/rfq/${b.rfq.id}`}>{b.rfq.title}</Link> : <span>Requirement removed</span>}
                  </span>
                  <span><em className={`mr-st ${BID_CLS[b.status]}`}>{b.status}</em></span>
                  <span className="r mono">{b.tlc_display}</span>
                  <span className="c mono">{b.bidder_code}</span>
                </div>
              ))}
            </div>
            {bids.length === 0 && (
              <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
                You haven't bid on anything yet — <Link href="/board" style={{ textDecoration: "underline" }}>browse the board</Link>.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
