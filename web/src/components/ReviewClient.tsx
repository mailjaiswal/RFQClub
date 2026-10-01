"use client";
import Link from "next/link";
import { useState } from "react";
import {
  approveDraft,
  getOperatorQueue,
  rejectDraft,
  setRfqStatus,
  type ReviewDraft,
  type ReviewEdits,
  type ReviewQueue,
  type RfqCard,
} from "@/lib/api";
import { SECTOR_LIST, sectorMeta } from "@/lib/sectors";

// The concierge gate. An operator reviews every incoming requirement here and
// is the only path by which an RFQ reaches the public board. All actions call
// the operator-only /api/operator/* endpoints, then re-fetch the authoritative
// queue from the server.
export default function ReviewClient({ initial }: { initial: ReviewQueue }) {
  const [queue, setQueue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    try {
      setQueue(await getOperatorQueue(8));
    } catch {
      /* keep last known state */
    }
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? `⚠ ${err.message}` : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="ap-subbar">
        <span className="code" style={{ marginLeft: 0 }}>Concierge review</span>
        <span className="code">{queue.counts.pending} intake · {queue.counts.rfq_drafts} unpublishable · {queue.counts.published} live</span>
      </div>

      <div className="ap-detail">
        <div className="mr-head">
          <h1>The human gate</h1>
          <p>Nothing reaches the board without an approval here. Correct any field before approving; low-confidence
            values are flagged so you know what to double-check against the buyer&apos;s raw text.</p>
        </div>
        {msg && <div className="mr-note ok" role="status">{msg}</div>}

        <div className="rv-cols">
          {/* ---- intake drafts ---- */}
          <section className="rv-main">
            <div className="label-mono" style={{ margin: "4px 0 10px" }}>Intake drafts awaiting structure</div>
            {queue.pending.length === 0 && (
              <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>Queue is clear — no drafts awaiting review.</div>
            )}
            {queue.pending.map((d) => (
              <DraftCard key={d.id} draft={d} busy={busy} onApprove={(edits, publish, force) =>
                run(() => approveDraft(d.id, { edits, publish, force }), `Draft #${d.id} approved${publish ? " & published" : " as draft"}.`)}
                onReject={(reason) => run(() => rejectDraft(d.id, reason), `Draft #${d.id} rejected.`)} />
            ))}
          </section>

          {/* ---- rfq records awaiting publish ---- */}
          <aside className="rv-side">
            <div className="label-mono" style={{ margin: "4px 0 10px" }}>RFQ records not yet on the board</div>
            {queue.rfq_drafts.length === 0 && (
              <div className="card" style={{ color: "var(--muted)", fontSize: 12.5 }}>None.</div>
            )}
            {queue.rfq_drafts.map((r) => (
              <UnpublishedRfq key={r.id} rfq={r} busy={busy}
                onPublish={() => run(() => setRfqStatus(r.id, "published"), `${r.code} published to the board.`)}
                onClose={() => run(() => setRfqStatus(r.id, "closed"), `${r.code} closed.`)} />
            ))}

            {queue.recently_reviewed.length > 0 && (
              <>
                <div className="label-mono" style={{ margin: "18px 0 10px" }}>Recently reviewed</div>
                <div className="card" style={{ padding: 14 }}>
                  {queue.recently_reviewed.map((d) => (
                    <div key={d.id} className="rv-recent">
                      <b>{d.status}</b>
                      <span className="rv-rt">{d.fields.title || "(untitled)"}</span>
                      {d.reviewed_by && <span className="mono rv-rb">by {d.reviewed_by}</span>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

function DraftCard({ draft, busy, onApprove, onReject }: {
  draft: ReviewDraft;
  busy: boolean;
  onApprove: (edits: ReviewEdits, publish: boolean, force: boolean) => void;
  onReject: (reason: string) => void;
}) {
  const f = draft.fields;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(f.title);
  const [process, setProcess] = useState(f.process);
  const [material, setMaterial] = useState(f.material);
  const [qty, setQty] = useState(f.qty == null ? "" : String(f.qty));
  const [low, setLow] = useState(f.low == null ? "" : String(f.low));
  const [high, setHigh] = useState(f.high == null ? "" : String(f.high));
  const [days, setDays] = useState(f.closes_in_days == null ? "" : String(f.closes_in_days));
  const [sectorKey, setSectorKey] = useState(f.sector_key);
  const [reason, setReason] = useState("");

  const sec = sectorMeta(f.sector_key);
  const dup = draft.duplicate_of;

  function edits(): ReviewEdits {
    // Only send what the reviewer changed. Empty numeric box => null => "clear it";
    // untouched (still equal to the parsed value) => omit so nothing is reset.
    const e: ReviewEdits = {};
    if (title !== f.title) e.title = title;
    if (process !== f.process) e.process = process;
    if (material !== f.material) e.material = material;
    if (sectorKey !== f.sector_key) e.sector_key = sectorKey;
    const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^0-9.]/g, "")) || null);
    if (n(qty) !== f.qty) e.qty = n(qty);
    if (n(low) !== f.low) e.low = n(low);
    if (n(high) !== f.high) e.high = n(high);
    if (n(days) !== f.closes_in_days) e.closes_in_days = n(days);
    return e;
  }

  return (
    <div className="card rv-draft">
      <div className="rv-dhead">
        <span className="rv-badge" style={{ background: sec.soft, color: sec.base }}>#{draft.id} · {sec.label}</span>
        <span className="mono rv-src">{draft.source}</span>
      </div>

      <div className="rv-title">{f.title || <span style={{ color: "var(--muted)" }}>(no title parsed)</span>}</div>

      <div className="rv-grid">
        <span>Material</span><b>{f.material || "—"}</b>
        <span>Process</span><b>{f.process || "—"}</b>
        <span>Quantity</span><b>{f.qty == null ? "—" : `${f.qty.toLocaleString("en-IN")} ${f.unit}`}</b>
        <span>Budget</span><b>{f.budget_display}</b>
        <span>Closes</span><b>{f.closes_in_days == null ? "—" : `${f.closes_in_days} days`}</b>
        <span>Filed</span><b>{draft.created_at ? new Date(draft.created_at).toLocaleString() : "—"}</b>
      </div>

      {draft.low_confidence.length > 0 && (
        <div className="rv-warn">⚠ Low confidence: {draft.low_confidence.join(", ")}</div>
      )}
      {dup && (
        <div className="rv-warn dup">⚠ Duplicate of <Link href={`/rfq/${dup.id}`}>{dup.code}</Link> — approve will need “force”.</div>
      )}
      {Object.entries(f.clarify_answers || {}).length > 0 && (
        <div className="rv-answered">
          {Object.entries(f.clarify_answers).map(([key, rec]) => (
            <span key={key} className="rv-ans">✓ {key}: {rec.answer}{rec.by ? ` (${rec.by})` : ""}</span>
          ))}
        </div>
      )}
      {f.clarifications.length > 0 && (
        <div className="rv-clarify">
          <span className="rv-clarlabel">Still asking the buyer:</span>
          {f.clarifications.map((c, i) => <span key={i}>{c.question}</span>)}
        </div>
      )}

      <button className="rv-rawtoggle" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"} buyer&apos;s raw text</button>
      {open && <div className="rv-raw">{draft.raw_text || "(none)"}</div>}

      {open && (
        <div className="rv-edits">
          <div className="label-mono" style={{ margin: "4px 0 8px" }}>Correct before approving</div>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <div className="grid sm:grid-cols-2 gap-3" style={{ marginTop: 8 }}>
            <input className="field" value={process} onChange={(e) => setProcess(e.target.value)} placeholder="Process" />
            <input className="field" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Material" />
            <input className="field input-money" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" />
            <select className="field" value={sectorKey} onChange={(e) => setSectorKey(e.target.value)}>
              {SECTOR_LIST.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <input className="field input-money" value={low} onChange={(e) => setLow(e.target.value)} placeholder="Budget low (₹)" />
            <input className="field input-money" value={high} onChange={(e) => setHigh(e.target.value)} placeholder="Budget high (₹)" />
          </div>
        </div>
      )}

      <div className="rv-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => onApprove(edits(), true, !!dup)}>Approve &amp; publish</button>
        <button className="btn btn-outline" disabled={busy} onClick={() => onApprove(edits(), false, !!dup)}>Approve as draft</button>
      </div>
      <div className="rv-actions rv-reject">
        <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejecting (shown to the buyer)" />
        <button className="btn btn-ghost" disabled={busy} onClick={() => { onReject(reason); setReason(""); }}>Reject</button>
      </div>
    </div>
  );
}

function UnpublishedRfq({ rfq, busy, onPublish, onClose }: {
  rfq: RfqCard;
  busy: boolean;
  onPublish: () => void;
  onClose: () => void;
}) {
  const sec = sectorMeta(rfq.sector.key);
  return (
    <div className="card rv-rfq">
      <div className="rv-dhead">
        <span className="rv-badge" style={{ background: sec.soft, color: sec.base }}>{rfq.code}</span>
        <span className="mono rv-src">{rfq.status}</span>
      </div>
      <div className="rv-title sm"><Link href={`/rfq/${rfq.id}`}>{rfq.title}</Link></div>
      <div className="rv-acts">
        <button className="btn btn-primary sm" disabled={busy} onClick={onPublish}>Publish</button>
        <button className="btn btn-ghost sm" disabled={busy} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
