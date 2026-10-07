"use client";
import React, { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useConsole } from "@/components/console/ConsoleApp";
import { StatusPill, fmtDate, relTime } from "@/components/console/ui";
import { useCached } from "@/lib/cache";
import {
  assignLeads, dropRows, getLeads, getTeam, markQueuesStale, patchRows, prefetchLead,
  queueKey, rememberRows, teamCacheKey,
  type LeadQuery, type LeadRow, type LeadsResponse, type SalesView,
} from "@/lib/sales-api";

const VIEWS = [
  { key: "mine", label: "My queue" },
  { key: "unassigned", label: "Unclaimed" },
  { key: "followups", label: "Follow-ups" },
  { key: "all", label: "All leads", mgr: true },
  { key: "excluded", label: "Out of scope", mgr: true },
];

function Queue() {
  const router = useRouter();
  const sp = useSearchParams();
  const { meta, isManager, user } = useConsole();
  const view = (sp.get("view") || "mine") as SalesView;
  const statusFilter = sp.get("status") || "";
  const trackFilter = sp.get("track") || "";
  const contactedFilter = sp.get("contacted") || "";
  const callableFilter = sp.get("callable") || "";
  const ownerFilter = sp.get("owner_email") || "";
  const categoryFilter = sp.get("category") || "";
  const [localSort, setLocalSort] = useState(() => sp.get("sort") || "priority");
  const [localDir, setLocalDir] = useState(() => sp.get("dir") || "");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    setLocalSort(sp.get("sort") || "priority");
    setLocalDir(sp.get("dir") || "");
  }, [sp]);

  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [err, setErr] = useState("");
  const [more, setMore] = useState<LeadRow[]>([]);
  const [moreBusy, setMoreBusy] = useState(false);
  const [claiming, setClaiming] = useState<number | null>(null);

  // Search settles before it hits the queue: a request per keystroke used to
  // stampede the hosted API while the user was still typing.
  useEffect(() => {
    const t = setTimeout(() => setQDeb(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query: LeadQuery = {
    view, status: statusFilter, track: trackFilter, category: categoryFilter,
    contacted: contactedFilter, callable: callableFilter, owner_email: ownerFilter,
    sort: localSort, dir: localDir, q: qDeb || undefined, limit: 100, offset: 0,
  };
  const key = queueKey(query);
  // SWR: the cached page paints the moment this screen mounts (returning from a
  // lead, or re-opening a filter you already viewed), while a background
  // revalidate brings it up to date a beat later.
  const { data, error: apiErr, pending, revalidate } = useCached<LeadsResponse>(
    key,
    () => getLeads(query).then((r) => { rememberRows(r.items); return r; }),
  );
  useEffect(() => { setMore([]); setSelectedIds(new Set()); }, [key]);

  // managers get the owner dropdown from the team roster (reps can't read it)
  const { data: teamData } = useCached(teamCacheKey(), getTeam, { maxAgeMs: 60_000, enabled: isManager });
  const team = teamData?.items ?? [];

  const rawRows = useMemo(() => [...(data?.items ?? []), ...more], [data, more]);
  const total = data?.total ?? 0;
  const busy = pending && !data;

  // Instant in-memory sorting of loaded rows (0ms latency, zero unmounts)
  const rows = useMemo(() => {
    if (!localSort || localSort === "priority") return rawRows;
    const items = [...rawRows];
    items.sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";
      if (localSort === "company") {
        va = (a.company || "").toLowerCase();
        vb = (b.company || "").toLowerCase();
      } else if (localSort === "hub_city") {
        va = (a.hub_city || "").toLowerCase();
        vb = (b.hub_city || "").toLowerCase();
      } else if (localSort === "status") {
        va = (a.status || "").toLowerCase();
        vb = (b.status || "").toLowerCase();
      } else if (localSort === "owner") {
        va = (a.owner_email || "").toLowerCase();
        vb = (b.owner_email || "").toLowerCase();
      } else if (localSort === "next_action") {
        va = a.next_action_at ? new Date(a.next_action_at).getTime() : 0;
        vb = b.next_action_at ? new Date(b.next_action_at).getTime() : 0;
      } else if (localSort === "contacted") {
        va = a.last_contacted_at ? new Date(a.last_contacted_at).getTime() : 0;
        vb = b.last_contacted_at ? new Date(b.last_contacted_at).getTime() : 0;
      }
      if (va < vb) return localDir === "desc" ? 1 : -1;
      if (va > vb) return localDir === "desc" ? -1 : 1;
      return 0;
    });
    return items;
  }, [rawRows, localSort, localDir]);

  async function loadMore() {
    setMoreBusy(true); setErr("");
    try {
      const r = await getLeads({ ...query, offset: rawRows.length });
      rememberRows(r.items);
      setMore((prev) => [...prev, ...r.items]);
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setMoreBusy(false); }
  }

  function setParam(patch: Record<string, string>) {
    const usp = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) usp.set(k, v); else usp.delete(k); }
    router.push(`/console/leads?${usp.toString()}`);
  }

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }, [rows]);

  async function bulkClaim(ids: number[]) {
    if (!ids.length) return;
    setBulkBusy(true); setErr("");
    const me = (user?.email || "").toLowerCase();
    for (const id of ids) {
      if (view === "unassigned") dropRows(id);
      else patchRows(id, { owner_email: me });
    }
    markQueuesStale();
    try {
      await assignLeads(ids);
      setSelectedIds(new Set());
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBulkBusy(false);
      revalidate();
    }
  }

  async function claim(id: number) {
    setClaiming(id); setErr("");
    // Write the outcome through to the cache first: the row leaves the unclaimed
    // pool (or shows your name) the instant you click, then the revalidate after
    // the server confirms keeps the counts honest.
    if (view === "unassigned") dropRows(id);
    else patchRows(id, { owner_email: (user?.email || "").toLowerCase() });
    markQueuesStale();
    try { await assignLeads([id]); }
    catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setClaiming(null); }
    revalidate();
  }

  const activeView = VIEWS.find((v) => v.key === view && (!v.mgr || isManager)) ? view : "mine";

  // Hovering a row warms both halves of the next screen: the route payload (Next
  // renders /console/leads/[id] on demand) and the lead record itself. By the
  // time the click lands, the page has nothing left to fetch.
  const warmTimer = useRef<number | null>(null);
  const warmed = useRef<number>(0);
  const warm = useCallback((id: number) => {
    if (warmTimer.current) window.clearTimeout(warmTimer.current);
    warmTimer.current = window.setTimeout(() => {
      warmed.current = id;
      prefetchLead(id);
      router.prefetch(`/console/leads/${id}`);
    }, 60);
  }, [router]);

  const cancelWarm = useCallback(() => {
    if (warmTimer.current) window.clearTimeout(warmTimer.current);
  }, []);

  // A click must not wait for the debounce — warm synchronously if it beats it.
  const openLead = useCallback((id: number) => {
    cancelWarm();
    if (warmed.current !== id) prefetchLead(id);
    router.push(`/console/leads/${id}`);
  }, [cancelWarm, router]);

  // Instant in-memory sort with URL synchronization (shareable/back-button-stable)
  const toggleSort = useCallback((key: string) => {
    const nextDir = localSort === key ? (localDir === "asc" ? "desc" : "asc") : "asc";
    setLocalSort(key);
    setLocalDir(nextDir);
    const usp = new URLSearchParams(sp.toString());
    usp.set("sort", key);
    usp.set("dir", nextDir);
    window.history.replaceState(null, "", `/console/leads?${usp.toString()}`);
  }, [localSort, localDir, sp]);

  const head = (label: string, key: string) => (
    <th className="sortable" onClick={() => toggleSort(key)} title={`Sort by ${label.toLowerCase()}`}>
      {label}<span className="sort-caret">{localSort === key ? (localDir === "desc" ? " ↓" : " ↑") : ""}</span>
    </th>
  );

  return (
    <>
      <div className="in-row in-wrap" style={{ gap: 8, marginBottom: 12 }}>
        {VIEWS.filter((v) => !v.mgr || isManager).map((v) => (
          <a key={v.key} className={`in-step${activeView === v.key ? " cur" : ""}`}
            onClick={() => setParam({ view: v.key })}>{v.label}</a>
        ))}
      </div>

      <div className="in-filterbar">
        <input className="in-field" style={{ maxWidth: 260 }} placeholder="Search company / city…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="in-field" style={{ maxWidth: 180 }} value={trackFilter} onChange={(e) => setParam({ track: e.target.value })}>
          <option value="">All tracks</option>
          {(meta?.tracks || []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="in-field" style={{ maxWidth: 190 }} value={statusFilter} onChange={(e) => setParam({ status: e.target.value })}>
          <option value="">Any status</option>
          {(meta?.statuses || []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className="in-field" style={{ maxWidth: 200 }} value={categoryFilter} onChange={(e) => setParam({ category: e.target.value })}>
          <option value="">All categories</option>
          {(meta?.categories || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {isManager && (
          <select className="in-field" style={{ maxWidth: 210 }} value={ownerFilter} onChange={(e) => setParam({ owner_email: e.target.value })}>
            <option value="">Anyone assigned</option>
            <option value="__unassigned__">Unassigned only</option>
            {team.map((t) => <option key={t.email} value={t.email}>{t.email}</option>)}
          </select>
        )}
        <span className="in-faint" style={{ marginLeft: "auto" }}>
          {total} leads{pending && data ? " · updating" : ""}
        </span>
      </div>

      {(() => {
        const chips: { k: string; label: string }[] = [];
        if (statusFilter) chips.push({ k: "status", label: (meta?.statuses || []).find((s) => s.key === statusFilter)?.label || statusFilter });
        if (trackFilter) chips.push({ k: "track", label: trackFilter });
        if (contactedFilter) chips.push({ k: "contacted", label: "contacted" });
        if (callableFilter) chips.push({ k: "callable", label: "callable now" });
        if (categoryFilter) chips.push({ k: "category", label: `category: ${(meta?.categories || []).find((c) => c.key === categoryFilter)?.label || categoryFilter}` });
        if (ownerFilter) chips.push({ k: "owner_email", label: ownerFilter === "__unassigned__" ? "unassigned only" : `owner: ${ownerFilter}` });
        if (!chips.length) return null;
        return (
          <div className="in-drillbar">
            <span>Drilling into</span>
            {chips.map((c) => (
              <span key={c.k} className="in-dchip">{c.label}
                <button title="Remove filter" onClick={() => setParam({ [c.k]: "" })}>×</button>
              </span>
            ))}
            <a className="in-link" style={{ cursor: "pointer" }}
              onClick={() => setParam(Object.fromEntries(chips.map((c) => [c.k, ""])))}>clear all</a>
          </div>
        );
      })()}

      {(err || apiErr) && <p className="in-err">{err || apiErr}</p>}

      {selectedIds.size > 0 && (
        <div className="in-batchbar">
          <span><b>{selectedIds.size}</b> leads selected</span>
          <button className="in-btn primary sm" disabled={bulkBusy} onClick={() => bulkClaim([...selectedIds])}>
            {bulkBusy ? "Claiming…" : `Claim ${selectedIds.size} to me`}
          </button>
          <button className="in-btn sm" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      )}

      <div className="in-card in-scroll-x" style={{ overflow: "hidden" }}>
        <table className="in-table">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selectedIds.size === rows.length}
                  onChange={toggleSelectAll}
                  title="Select all leads"
                  style={{ cursor: "pointer", width: 14, height: 14 }}
                />
              </th>
              {head("Company", "company")}{head("Hub", "hub_city")}{head("Status", "status")}
              {isManager && head("Owner", "owner")}
              {head("Next action", "next_action")}{head("Last touch", "contacted")}<th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <LeadTableRow
                key={l.id}
                l={l}
                selected={selectedIds.has(l.id)}
                onSelect={toggleSelect}
                onOpen={openLead}
                onWarm={warm}
                onCancelWarm={cancelWarm}
                isManager={isManager}
                view={view}
                claiming={claiming === l.id}
                onClaim={claim}
              />
            ))}
            {!rows.length && (
              <tr><td colSpan={isManager ? 8 : 7}><div className="in-empty">
                {busy ? "Loading leads…"
                  : view === "mine" ? <>No leads in your book yet. <Link className="in-link" href="/console/leads?view=unassigned">Claim from Unclaimed →</Link></>
                  : "No leads match this view."}
              </div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length < total && (
        <div style={{ marginTop: 12 }}>
          <button className="in-btn" onClick={loadMore} disabled={moreBusy}>
            {moreBusy ? "Loading…" : `Load more (${total - rows.length} left)`}
          </button>
        </div>
      )}
      <p className="in-faint" style={{ marginTop: 12, fontSize: 11 }}>Signed in as {user?.email} · {user?.role}</p>
    </>
  );
}

const LeadTableRow = React.memo(function LeadTableRow({
  l, selected, onSelect, onOpen, onWarm, onCancelWarm, isManager, view, claiming, onClaim,
}: {
  l: LeadRow; selected: boolean; onSelect: (id: number) => void;
  onOpen: (id: number) => void; onWarm: (id: number) => void; onCancelWarm: () => void;
  isManager: boolean; view: string; claiming: boolean; onClaim: (id: number) => void;
}) {
  const na = relTime(l.next_action_at);
  return (
    <tr className={`row${selected ? " selected" : ""}`} onClick={() => onOpen(l.id)}
      onMouseEnter={() => onWarm(l.id)} onMouseLeave={onCancelWarm}>
      <td onClick={(e) => e.stopPropagation()} style={{ width: 36, textAlign: "center" }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(l.id)}
          aria-label={`Select ${l.company}`}
          style={{ cursor: "pointer", width: 14, height: 14 }}
        />
      </td>
      <td>
        <div className="co">{l.company || <span className="in-faint">(no name)</span>}</div>
        <div className="sub">
          {l.track} · {l.category_label}
          {l.category_verified && (
            <span className="in-vchip"
              title="Sector confirmed by research, not inherited from the sector sweep">✓ researched</span>
          )}
          {l.priority_rank ? ` · #${l.priority_rank}` : ""}{!l.reachable ? " · ⚠ no contact" : ""}
        </div>
      </td>
      <td className="sub">{l.hub_city || "—"}</td>
      <td><StatusPill status={l.status} label={l.status_label} /></td>
      {isManager && <td className="sub">{l.owner_email || <span className="in-faint">unassigned</span>}</td>}
      <td className="sub">
        {l.next_action_at
          ? <span style={{ color: na.overdue ? "var(--bad)" : undefined }}>{fmtDate(l.next_action_at)} · {na.text}</span>
          : "—"}
      </td>
      <td className="sub">{l.last_contacted_at ? fmtDate(l.last_contacted_at) : <span className="in-faint">never</span>}</td>
      <td>
        {!l.owner_email && view !== "excluded" && (
          <button className="in-btn sm" disabled={claiming}
            onClick={(e) => { e.stopPropagation(); onClaim(l.id); }}>
            {claiming ? "Claiming…" : "Claim"}
          </button>
        )}
      </td>
    </tr>
  );
});

export default function LeadsPage() {
  return <Suspense fallback={null}><Queue /></Suspense>;
}
