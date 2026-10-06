"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useConsole } from "@/components/console/ConsoleApp";
import { StatusPill, fmtDate, relTime } from "@/components/console/ui";
import { assignLeads, getLeads, type LeadRow, type SalesView } from "@/lib/sales-api";

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

  const [rows, setRows] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async (offset = 0) => {
    setBusy(true); setErr("");
    try {
      const r = await getLeads({ view, status: statusFilter, track: trackFilter, contacted: contactedFilter, callable: callableFilter, owner_email: ownerFilter, q: q.trim() || undefined, limit: 100, offset });
      setTotal(r.total);
      setRows((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  }, [view, statusFilter, trackFilter, contactedFilter, callableFilter, ownerFilter, q]);

  useEffect(() => { load(0); }, [load]);

  function setParam(patch: Record<string, string>) {
    const usp = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) usp.set(k, v); else usp.delete(k); }
    router.push(`/console/leads?${usp.toString()}`);
  }

  async function claim(id: number) {
    setBusy(true);
    try { await assignLeads([id]); await load(0); }
    catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  }

  const activeView = VIEWS.find((v) => v.key === view && (!v.mgr || isManager)) ? view : "mine";

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
        <span className="in-faint" style={{ marginLeft: "auto" }}>{total} leads</span>
      </div>

      {(() => {
        const chips: { k: string; label: string }[] = [];
        if (statusFilter) chips.push({ k: "status", label: (meta?.statuses || []).find((s) => s.key === statusFilter)?.label || statusFilter });
        if (trackFilter) chips.push({ k: "track", label: trackFilter });
        if (contactedFilter) chips.push({ k: "contacted", label: "contacted" });
        if (callableFilter) chips.push({ k: "callable", label: "callable now" });
        if (ownerFilter) chips.push({ k: "owner_email", label: `owner: ${ownerFilter}` });
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

      {err && <p className="in-err">{err}</p>}

      <div className="in-card in-scroll-x" style={{ overflow: "hidden" }}>
        <table className="in-table">
          <thead>
            <tr>
              <th>Company</th><th>Hub</th><th>Status</th>
              {isManager && <th>Owner</th>}
              <th>Next action</th><th>Last touch</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const na = relTime(l.next_action_at);
              return (
                <tr key={l.id} className="row" onClick={() => router.push(`/console/leads/${l.id}`)}>
                  <td>
                    <div className="co">{l.company || <span className="in-faint">(no name)</span>}</div>
                    <div className="sub">{l.track} · {l.category_label}{l.priority_rank ? ` · #${l.priority_rank}` : ""}{!l.reachable ? " · ⚠ no contact" : ""}</div>
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
                      <button className="in-btn sm" onClick={(e) => { e.stopPropagation(); claim(l.id); }}>Claim</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && !busy && (
              <tr><td colSpan={isManager ? 7 : 6}><div className="in-empty">
                {view === "mine" ? <>No leads in your book yet. <Link className="in-link" href="/console/leads?view=unassigned">Claim from Unclaimed →</Link></>
                  : "No leads match this view."}
              </div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length < total && (
        <div style={{ marginTop: 12 }}>
          <button className="in-btn" onClick={() => load(rows.length)} disabled={busy}>
            {busy ? "Loading…" : `Load more (${total - rows.length} left)`}
          </button>
        </div>
      )}
      <p className="in-faint" style={{ marginTop: 12, fontSize: 11 }}>Signed in as {user?.email} · {user?.role}</p>
    </>
  );
}

export default function LeadsPage() {
  return <Suspense fallback={null}><Queue /></Suspense>;
}
