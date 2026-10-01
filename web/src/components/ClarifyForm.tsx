"use client";
import Link from "next/link";
import { useState } from "react";
import { answerClarify, type Clarification, type ReviewDraft } from "@/lib/api";

// The buyer answers the concierge's clarify questions for one of their own
// intake drafts. Each answer is folded back into the draft's structured fields
// server-side (see workflow.answer_clarifications); a question disappears from
// this list as soon as its field has a value, so "open" is always the truth.
const PLACEHOLDER: Record<string, string> = {
  qty: "e.g. 1200 pcs",
  material: "e.g. SS 316 / Duplex 2205",
  process: "e.g. 5-axis CNC machining",
  budget: "e.g. ₹8–15 Lakh (or leave blank to route open)",
};

const STATUS_CHIP: Record<string, { t: string; color: string; bd: string; bg: string }> = {
  PENDING: { t: "In review", color: "#B4690E", bd: "rgba(180,105,14,.4)", bg: "rgba(180,105,14,.08)" },
  APPROVED: { t: "Approved", color: "#2E7D46", bd: "rgba(46,125,70,.4)", bg: "rgba(46,125,70,.08)" },
  REJECTED: { t: "Closed", color: "#C0392B", bd: "rgba(192,57,43,.4)", bg: "rgba(192,57,43,.08)" },
};

export default function ClarifyForm({ initial }: { initial: ReviewDraft }) {
  const [draft, setDraft] = useState<ReviewDraft>(initial);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noted, setNoted] = useState<string[]>([]);

  const open = draft.fields.clarifications;
  const pending = draft.status === "PENDING";
  const answered = Object.entries(draft.fields.clarify_answers || {});

  async function save() {
    const sent: Record<string, string> = {};
    for (const c of open) {
      const v = (answers[c.key] || "").trim();
      if (v) sent[c.key] = v;
    }
    if (Object.keys(sent).length === 0) {
      setError("Type an answer for at least one question.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await answerClarify(draft.id, sent);
      setDraft(res.draft);
      // A typed answer that the parser couldn't read leaves the question open —
      // nudge the buyer rather than silently dropping it.
      const stillOpen = new Set(res.draft.fields.clarifications.map((c: Clarification) => c.key));
      const duds = Object.keys(sent).filter((k) => stillOpen.has(k));
      setNoted(duds);
      setAnswers((prev) => {
        const next: Record<string, string> = {};
        for (const k of duds) next[k] = prev[k] ?? "";
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your answers.");
    } finally {
      setBusy(false);
    }
  }

  const chip = STATUS_CHIP[draft.status] ?? STATUS_CHIP.PENDING;

  return (
    <div className="surface-card" style={{ padding: 24, maxWidth: 720 }}>
      <div className="chip" style={{ width: "fit-content", color: chip.color, borderColor: chip.bd, background: chip.bg }}>
        ● {chip.t} · your draft
      </div>
      <h1 className="display" style={{ fontSize: 22, margin: "12px 0 4px" }}>{draft.fields.title || "Untitled requirement"}</h1>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        {draft.fields.sector_label}
        {draft.fields.qty ? <> · {draft.fields.qty} {draft.fields.unit}</> : null}
        {draft.fields.budget_display ? <> · {draft.fields.budget_display}</> : null}
      </p>

      {pending && open.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="label-mono">Help us route this faster</div>
          <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 14px" }}>
            Answer any you can — leave one blank and the concierge will simply ask or proceed without it.
          </p>
          <div style={{ display: "grid", gap: 14 }}>
            {open.map((c) => (
              <label key={c.key} style={{ display: "block" }}>
                <span className="field-label">{c.question}</span>
                <input
                  className="field"
                  value={answers[c.key] ?? ""}
                  onChange={(e) => setAnswers((p) => ({ ...p, [c.key]: e.target.value }))}
                  placeholder={PLACEHOLDER[c.key] ?? ""}
                  maxLength={200}
                />
                {noted.includes(c.key) && (
                  <span style={{ fontSize: 11.5, color: "#B4690E" }}>We couldn&apos;t read that — try the example format.</span>
                )}
              </label>
            ))}
          </div>
          {error && <div className="chip urgency-red" style={{ marginTop: 12, width: "fit-content" }}>{error}</div>}
          <div className="flex gap-3" style={{ marginTop: 18 }}>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save answers"}</button>
            <Link href="/my-rfqs" className="btn btn-outline">Later</Link>
          </div>
        </div>
      )}

      {pending && open.length === 0 && (
        <div className="card" style={{ marginTop: 18, padding: 16 }}>
          <div className="chip" style={{ color: "#2E7D46", borderColor: "rgba(46,125,70,.4)", background: "rgba(46,125,70,.08)" }}>✓ All answered</div>
          <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
            Nothing left to clarify — a concierge will structure and publish it. Track it under{" "}
            <Link href="/my-rfqs" style={{ textDecoration: "underline" }}>My RFQs</Link>.
          </p>
        </div>
      )}

      {!pending && (
        <div className="card" style={{ marginTop: 18, padding: 16 }}>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            This draft is no longer open for changes.{" "}
            {draft.status === "REJECTED" && draft.reject_reason ? <>Reason: {draft.reject_reason}.</> : null}{" "}
            See it under <Link href="/my-rfqs" style={{ textDecoration: "underline" }}>My RFQs</Link>.
          </p>
        </div>
      )}

      {answered.length > 0 && (
        <div style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div className="label-mono">What you&apos;ve told us</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 0, listStyle: "none", fontSize: 13, color: "var(--subtle)", lineHeight: 1.8 }}>
            {answered.map(([key, rec]) => (
              <li key={key}><strong style={{ color: "var(--ink)" }}>{key}</strong> — {rec.answer}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
