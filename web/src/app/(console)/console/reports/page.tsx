"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useConsole } from "@/components/console/ConsoleApp";
import { useCached } from "@/lib/cache";
import { getReports, getTeam, reportsCacheKey, teamCacheKey, type ReportData } from "@/lib/sales-api";

const KIND_LABELS: Record<string, string> = {
  call: "Calls", whatsapp: "WhatsApp", email: "Emails", meeting: "Meetings",
  note: "Notes", voicemail: "Voicemails",
};
const STATUS_LABELS: Record<string, string> = {
  uncontacted: "Uncontacted", attempted_no_reply: "No reply", connected: "Connected",
  qualified: "Qualified", onboarding: "Onboarding", onboarded: "Onboarded",
  not_interested: "Declined", nurture: "Nurture", incorrect: "Incorrect",
};

// Date-range shortcuts
function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function weekStartStr() { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); }
function monthStartStr() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }

const SHORTCUTS: { label: string; from: () => string; to: () => string }[] = [
  { label: "Today", from: todayStr, to: todayStr },
  { label: "Last 7 days", from: () => daysAgo(6), to: todayStr },
  { label: "This week", from: weekStartStr, to: todayStr },
  { label: "This month", from: monthStartStr, to: todayStr },
  { label: "Last 30 days", from: () => daysAgo(29), to: todayStr },
];

function ReportsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { isManager, user } = useConsole();

  const from = sp.get("from") || daysAgo(6);
  const to = sp.get("to") || todayStr();
  const ownerEmail = sp.get("owner_email") || "";

  // Same cached shape as the queue: a period you have already opened paints at
  // once, and re-opening "This month" after editing a date is a background hit.
  const { data, error: err, pending } = useCached<ReportData>(
    reportsCacheKey(from, to, ownerEmail),
    () => getReports({ from, to, owner_email: ownerEmail || undefined }),
  );
  const loading = pending && !data;

  // Manager dropdown roster, shared with the console shell's copy
  const { data: teamData } = useCached(teamCacheKey(), getTeam, { maxAgeMs: 120_000, enabled: isManager });
  const team = teamData?.items ?? [];

  function setParams(patch: Record<string, string>) {
    const usp = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) usp.set(k, v); else usp.delete(k); }
    router.push(`/console/reports?${usp.toString()}`);
  }

  const pipelineTotal = data ? Object.values(data.current_pipeline).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <h2 className="in-h">Activity Report</h2>

      {/* Date range bar */}
      <div className="in-filterbar" style={{ marginBottom: 6 }}>
        <label className="in-tag">From</label>
        <input type="date" className="in-field" style={{ maxWidth: 150 }} value={from}
          onChange={(e) => setParams({ from: e.target.value })} />
        <label className="in-tag">To</label>
        <input type="date" className="in-field" style={{ maxWidth: 150 }} value={to}
          onChange={(e) => setParams({ to: e.target.value })} />
        {isManager && (
          <select className="in-field" style={{ maxWidth: 200 }} value={ownerEmail}
            onChange={(e) => setParams({ owner_email: e.target.value })}>
            <option value="">My activity</option>
            <option value="__team__">Entire team</option>
            {team.map((t) => <option key={t.email} value={t.email}>{t.email}</option>)}
          </select>
        )}
      </div>

      {/* Shortcut buttons */}
      <div className="in-row" style={{ gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {SHORTCUTS.map((s) => (
          <button key={s.label} className={`in-btn sm${from === s.from() && to === s.to() ? " primary" : ""}`}
            onClick={() => setParams({ from: s.from(), to: s.to() })}>{s.label}</button>
        ))}
      </div>

      {err && <p className="in-err">{err}</p>}
      {loading && (
        <div className="in-grid in-tiles" style={{ marginBottom: 20 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="in-card in-tile" style={{ opacity: 0.75 }}>
              <span className="ic" style={{ opacity: 0.3 }} aria-hidden>◉</span>
              <div className="n"><span className="in-skel" style={{ width: 44, height: 26 }} /></div>
              <div className="l" style={{ marginTop: 4 }}><span className="in-skel" style={{ width: 88, height: 12 }} /></div>
            </div>
          ))}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary tiles */}
          <div className="in-grid in-tiles" style={{ marginBottom: 20 }}>
            <div className="in-card in-tile" style={{ "--tint": "var(--sky)" } as React.CSSProperties}>
              <span className="ic">☎</span>
              <div className="n">{data.summary.total_activities}</div>
              <div className="l">Activities logged</div>
            </div>
            <div className="in-card in-tile" style={{ "--tint": "var(--good)" } as React.CSSProperties}>
              <span className="ic">◉</span>
              <div className="n">{data.summary.unique_leads_contacted}</div>
              <div className="l">Leads contacted</div>
            </div>
            <div className="in-card in-tile" style={{ "--tint": "var(--accent-2)" } as React.CSSProperties}>
              <span className="ic">△</span>
              <div className="n">{data.summary.total_status_changes}</div>
              <div className="l">Status changes</div>
            </div>
            <div className="in-card in-tile" style={{ "--tint": "var(--warn)" } as React.CSSProperties}>
              <span className="ic">✓</span>
              <div className="n">{data.summary.tasks_completed}</div>
              <div className="l">Tasks completed</div>
            </div>
          </div>

          {/* Details section: 2 columns */}
          <div className="in-detail">
            {/* Left: Activity + Status breakdowns */}
            <div className="in-col">
              <div className="in-card">
                <h3 className="in-h3">Activities by type</h3>
                {Object.keys(data.activities_by_kind).length === 0 && (
                  <p className="in-faint">No activities logged in this period.</p>
                )}
                {Object.entries(data.activities_by_kind).sort(([, a], [, b]) => b - a).map(([kind, count]) => {
                  const pct = Math.max(2, Math.round((count / data.summary.total_activities) * 100));
                  return (
                    <div key={kind} className="in-rbar">
                      <span className="lbl">{KIND_LABELS[kind] || kind}</span>
                      <div className="bar-wrap"><div className="bar" style={{ width: `${pct}%` }} /></div>
                      <span className="num">{count}</span>
                    </div>
                  );
                })}
              </div>

              <div className="in-card">
                <h3 className="in-h3">Status transitions</h3>
                {Object.keys(data.status_changes).length === 0 && (
                  <p className="in-faint">No status changes in this period.</p>
                )}
                {Object.entries(data.status_changes).sort(([, a], [, b]) => b - a).map(([st, count]) => {
                  const pct = Math.max(2, Math.round((count / data.summary.total_status_changes) * 100));
                  return (
                    <div key={st} className="in-rbar">
                      <span className="lbl">{STATUS_LABELS[st] || st}</span>
                      <div className="bar-wrap"><div className="bar" style={{ width: `${pct}%` }} /></div>
                      <span className="num">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Pipeline + Team */}
            <div className="in-col">
              <div className="in-card">
                <h3 className="in-h3">Current pipeline ({pipelineTotal} leads)</h3>
                {Object.keys(data.current_pipeline).length === 0 && (
                  <p className="in-faint">No leads in the pipeline{ownerEmail ? ` for ${ownerEmail}` : ""}.</p>
                )}
                {Object.entries(data.current_pipeline).sort(([, a], [, b]) => b - a).map(([st, count]) => {
                  const pct = Math.max(2, Math.round((count / pipelineTotal) * 100));
                  return (
                    <div key={st} className="in-rbar">
                      <span className="lbl">{STATUS_LABELS[st] || st}</span>
                      <div className="bar-wrap"><div className="bar pipe" style={{ width: `${pct}%` }} /></div>
                      <span className="num">{count}</span>
                    </div>
                  );
                })}
              </div>

              {data.team_breakdown && data.team_breakdown.length > 0 && (
                <div className="in-card">
                  <h3 className="in-h3">Per-rep breakdown</h3>
                  <table className="in-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr><th>Rep</th><th>Activities</th><th>Transitions</th><th>Tasks</th></tr>
                    </thead>
                    <tbody>
                      {data.team_breakdown.map((r) => (
                        <tr key={r.owner_email}>
                          <td>{r.owner_email}</td>
                          <td>{r.activities}</td>
                          <td>{r.status_changes}</td>
                          <td>{r.tasks_completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <p className="in-faint" style={{ marginTop: 16, fontSize: 11 }}>
            Period: {data.period.from} → {data.period.to} · Showing: {data.owner_email === "__team__" ? "Entire team" : data.owner_email}
          </p>
        </>
      )}
    </>
  );
}

export default function ReportsPage() {
  return <Suspense fallback={null}><ReportsInner /></Suspense>;
}
