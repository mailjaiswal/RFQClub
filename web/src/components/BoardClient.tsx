"use client";
import { useEffect, useMemo, useState } from "react";
import LedgerRow, { tagKey } from "@/components/LedgerRow";
import RfqTile from "@/components/RfqTile";
import { toggleSave, type BoardResponse, type RfqCard } from "@/lib/api";
import { getToken } from "@/lib/session";
import { getGuestSaved, toggleGuestSaved } from "@/lib/guestSaved";

type Sort = "deadline" | "value" | "bidcount";
type View = "all" | "saved" | "myrfqs" | "mybids";
type Mode = "cards" | "list";

// Sector legend: the mock's board bar shows these five chips.
const LEGEND: { key: string; label: string; color: string }[] = [
  { key: "", label: "All", color: "" },
  { key: "cnc", label: "CNC", color: "#3F4397" },
  { key: "foundry", label: "Foundry", color: "#C65C1E" },
  { key: "sheet", label: "Sheet Metal", color: "#2E6E46" },
  { key: "elec", label: "Electrical", color: "#9A6414" },
];

function sortItems(items: RfqCard[], sort: Sort): RfqCard[] {
  const c = [...items];
  if (sort === "value") c.sort((a, b) => (b.est_total ?? 0) - (a.est_total ?? 0));
  else if (sort === "bidcount") c.sort((a, b) => b.bids_received - a.bids_received);
  else c.sort((a, b) => (a.closes_in_days ?? 1e9) - (b.closes_in_days ?? 1e9));
  return c;
}

const SORT_LABELS: Record<Sort, string> = {
  deadline: "Closing soon",
  value: "Highest value",
  bidcount: "Most bids",
};

export default function BoardClient({
  initial,
  view = "all",
}: {
  initial: BoardResponse;
  view?: View;
}) {
  const [items, setItems] = useState<RfqCard[]>(initial.items);
  const [openTotal, setOpenTotal] = useState(initial.open_total);
  const [sector, setSector] = useState("");
  const [sort, setSort] = useState<Sort>("deadline");
  const [mode, setMode] = useState<Mode>("cards");
  const [activeTag, setActiveTag] = useState<{ key: string; label: string } | null>(null);
  const [isGuest, setIsGuest] = useState(false);

  // Board publishes live counts (open + saved) to the left rail. Child effects
  // run before the parent AppShell's listener is attached, so we also stash the
  // latest value on the window for AppShell to read on its own mount.
  const savedCount = useMemo(() => items.filter((r) => r.saved).length, [items]);
  useEffect(() => {
    const detail = { open: openTotal, saved: savedCount };
    (window as unknown as { __apCounts?: typeof detail }).__apCounts = detail;
    window.dispatchEvent(new CustomEvent("ap:counts", { detail }));
  }, [openTotal, savedCount]);

  // Guests keep their watchlist in this browser only (localStorage); signed-in
  // users get `saved` straight from the server's per-user SaveItem. Overlay the
  // guest list once on mount so hydration (server sends saved=false) stays clean.
  useEffect(() => {
    const guest = !getToken();
    setIsGuest(guest);
    if (guest) {
      const set = new Set(getGuestSaved());
      if (set.size) setItems((prev) => prev.map((r) => ({ ...r, saved: set.has(r.id) })));
    }
  }, []);

  function onTag(key: string, label: string) {
    setActiveTag((cur) => (cur && cur.key === key ? null : { key, label }));
  }

  function onToggleSave(id: number) {
    if (isGuest) {
      const nowSaved = toggleGuestSaved(id);
      setItems((prev) => prev.map((r) => (r.id === id ? { ...r, saved: nowSaved } : r)));
      return;
    }
    let next = false;
    setItems((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        next = !r.saved;
        return { ...r, saved: next };
      }),
    );
    toggleSave(id)
      .then((res) => {
        if (res.saved !== next) {
          setItems((prev) => prev.map((r) => (r.id === id ? { ...r, saved: res.saved } : r)));
        }
      })
      .catch(() => {
        setItems((prev) => prev.map((r) => (r.id === id ? { ...r, saved: !next } : r)));
      });
  }

  const filtered = useMemo(() => {
    let list = items;
    if (view === "saved") list = list.filter((r) => r.saved);
    if (sector) list = list.filter((r) => r.sector.key === sector);
    if (activeTag) {
      list = list.filter(
        (r) => (r.tags || []).some((t) => tagKey(t.label) === activeTag.key),
      );
    }
    return sortItems(list, sort);
  }, [items, view, sector, activeTag, sort]);

  const showBanner = view === "myrfqs" || view === "mybids";

  return (
    <>
      <div className="ap-bar">
        <div className="ap-legend" id="t-sectors">
          {LEGEND.map((s) => (
            <span
              key={s.key || "all"}
              className={`ap-lg${sector === s.key ? " on" : ""}`}
              onClick={() => setSector(s.key)}
            >
              {s.color ? <i style={{ background: s.color }} /> : null}
              {s.label}
            </span>
          ))}
        </div>
        <span className={`ap-filter${activeTag ? " on" : ""}`}>
          <span>{activeTag?.label}</span>
          <button aria-label="Clear filter" onClick={() => setActiveTag(null)}>✕</button>
        </span>
        <span className="laytog" role="group" aria-label="Board layout">
          <button className={mode === "cards" ? "on" : ""} aria-pressed={mode === "cards"} onClick={() => setMode("cards")}>Cards</button>
          <button className={mode === "list" ? "on" : ""} aria-pressed={mode === "list"} onClick={() => setMode("list")}>List</button>
        </span>
        <span className="ap-sort">
          {SORT_LABELS[sort]} ▾{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort board">
            <option value="deadline">Closing soon</option>
            <option value="value">Highest value</option>
            <option value="bidcount">Most bids</option>
          </select>
        </span>
      </div>

      {showBanner && (
        <div className="ap-banner">
          <b>{view === "myrfqs" ? "My RFQs" : "My bids"} console</b>
          <span>— your posted requirements and submitted bids land here in Phase 2.</span>
        </div>
      )}

      {view === "saved" && filtered.length === 0 ? (
        <div className="ap-empty" style={{ display: "block" }}>
          Nothing saved yet. Tap the bookmark on any RFQ to keep it here.
        </div>
      ) : activeTag && filtered.length === 0 ? (
        <div className="ap-empty" style={{ display: "block" }}>
          No open RFQs match this tag.
          <button type="button" onClick={() => setActiveTag(null)}>Clear filter</button>
        </div>
      ) : mode === "cards" ? (
        <div className="ap-grid">
          {filtered.map((rfq) => (
            <RfqTile
              key={rfq.id}
              rfq={rfq}
              activeTagKey={activeTag?.key ?? null}
              onTag={onTag}
              onToggleSave={onToggleSave}
            />
          ))}
        </div>
      ) : (
        filtered.map((rfq) => (
          <LedgerRow
            key={rfq.id}
            rfq={rfq}
            activeTagKey={activeTag?.key ?? null}
            onTag={onTag}
            onToggleSave={onToggleSave}
          />
        ))
      )}
    </>
  );
}
