"use client";
import Link from "next/link";
import { useState } from "react";
import type { RfqCard as Card } from "@/lib/api";

// Urgency dot colour, mirroring the mock's deadline chips.
const URGENCY: Record<string, string> = {
  red: "#B23A2B",
  amber: "#B77A1B",
  green: "#3B7148",
};

// tag.kind -> the mock chip modifier class (sector stays a plain .ap-tag).
const KIND_CLASS: Record<string, string> = {
  process: "process",
  material: "mat",
  cert: "cert",
};

const PIN = (
  <svg viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="2.6" /></svg>
);
const BOOKMARK = <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z" /></svg>;

// Mirror the mock's tag-key normalisation so the +N overflow + tap-to-filter
// behave exactly like design-concepts.html's data-t attributes.
export function tagKey(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const CAP = 4;

export default function LedgerRow({
  rfq,
  activeTagKey,
  onTag,
  onToggleSave,
}: {
  rfq: Card;
  activeTagKey: string | null;
  onTag: (key: string, label: string) => void;
  onToggleSave: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const base = rfq.sector.base;
  const tags = rfq.tags || [];
  const extra = tags.length - CAP;
  const days = rfq.closes_in_days;
  const dot = URGENCY[rfq.urgency] || "#8A857A";
  const dead =
    days == null ? "No deadline" : days <= 0 ? "Closes today" : `${days} days`;

  return (
    <div className="ap-row">
      <span className="ap-id">{rfq.code}</span>

      <div>
        <div className="ap-sec" style={{ color: base }}>
          <i style={{ background: base }} />
          {rfq.sector.label}
        </div>
        <Link className="ap-title" href={`/rfq/${rfq.id}`}>{rfq.title}</Link>
        <div className="ap-spec">{rfq.material || "Material per spec"}
          {rfq.qty ? ` · ${rfq.qty.toLocaleString("en-IN")} ${rfq.unit}` : ""}
        </div>

        {tags.length > 0 && (
          <div className={`ap-tags${expanded ? " expanded" : ""}`}>
            {tags.map((t, i) => {
              const key = tagKey(t.label);
              const hidden = i >= CAP && !expanded;
              return (
                <span
                  key={key + i}
                  className={`ap-tag${KIND_CLASS[t.kind] ? " " + KIND_CLASS[t.kind] : ""}${hidden ? " hide" : ""}${activeTagKey === key ? " active" : ""}`}
                  title={`Filter by ${t.label}`}
                  onClick={() => onTag(key, t.label)}
                >
                  {t.label}
                </span>
              );
            })}
            {extra > 0 && (
              <span
                className="ap-tag more"
                title="Show more tags"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "Show less" : `+${extra}`}
              </span>
            )}
          </div>
        )}

        <div className="ap-meta">
          <span className="ap-loc">{PIN}{rfq.hub_city || "—"}</span>
          {rfq.posted_days_ago != null && (
            <span>Posted <b>{rfq.posted_days_ago} day{rfq.posted_days_ago === 1 ? "" : "s"} ago</b></span>
          )}
          <span>Buyer verified</span>
        </div>
      </div>

      <div className="ap-action">
        <div className="ap-budget">{rfq.budget.range_display}</div>
        <div className="ap-value">Est. {rfq.est_total_display} order</div>
        <div className="ap-dead"><i style={{ background: dot }} />{dead} · {rfq.bid_count} bids</div>
        <div className="ap-btns">
          <button
            className={`save${rfq.saved ? " saved" : ""}`}
            title={rfq.saved ? "Saved" : "Save"}
            aria-pressed={rfq.saved}
            onClick={() => onToggleSave(rfq.id)}
          >
            {BOOKMARK}
          </button>
          <Link className="ap-bid" href={`/bid/${rfq.id}`}>Submit a bid</Link>
        </div>
      </div>
    </div>
  );
}
