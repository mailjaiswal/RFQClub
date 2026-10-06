"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useConsole } from "@/components/console/ConsoleApp";
import { StatusPill } from "@/components/console/ui";
import { exportCsv, getSummary, type Summary } from "@/lib/sales-api";

const TILE_ORDER: { key: string; label: string; hint: string }[] = [
  { key: "mine", label: "My book", hint: "leads you own" },
  { key: "uncontacted", label: "Not contacted", hint: "never dialled" },
  { key: "contacted", label: "Contacted", hint: "at least one touch" },
  { key: "followups_pending", label: "Follow-ups due", hint: "next-action now/past" },
  { key: "unassigned", label: "Unclaimed", hint: "open pool" },
  { key: "callable_now", label: "Callable now", hint: "has a number/email" },
  { key: "onboarded", label: "Onboarded", hint: "won" },
  { key: "excluded", label: "Out of scope", hint: "hidden from reps" },
];

export default function ConsoleDashboard() {
  const { user, isManager } = useConsole();
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { getSummary().then(setData).catch((e) => setErr(String(e?.message || e))); }, []);

  async function download() {
    setBusy(true); setErr("");
    try {
      const blob = await exportCsv({ view: "all" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `rfqclub_console_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setBusy(false); }
  }

  const first = (user?.email || "").split("@")[0];

  return (
    <>
      <div className="in-row in-wrap" style={{ marginBottom: 6 }}>
        <h1 className="display" style={{ fontSize: 20, margin: 0 }}>Good day, {first}</h1>
        <div className="in-right in-row">
          {isManager && <button className="in-btn" onClick={download} disabled={busy}>⭳ Export CSV</button>}
          <Link className="in-btn primary" href="/console/leads?view=followups">Work follow-ups →</Link>
        </div>
      </div>
      {err && <p className="in-err">{err}</p>}
      {!data && !err && <p className="in-faint">Loading dashboard…</p>}

      {data && (<>
        <div className="in-grid in-tiles">
          {TILE_ORDER.filter((t) => (t.key !== "excluded" || isManager)).map((t) => (
            <div key={t.key} className="in-card in-tile">
              <div className="d">{t.hint}</div>
              <div className="n">{data.tiles[t.key] ?? 0}</div>
              <div className="l">{t.label}</div>
            </div>
          ))}
        </div>

        <div className="in-sec-h">Pipeline funnel</div>
        <div className="in-funnel">
          {data.funnel.map((f) => (
            <Link key={f.key} href={`/console/leads?view=${isManager ? "all" : "mine"}&status=${f.key}`} className="in-fstage">
              <div className="n">{f.count}</div>
              <div className="l">{f.label}</div>
            </Link>
          ))}
        </div>

        {isManager && data.leaderboard && (
          <>
            <div className="in-sec-h">Team leaderboard</div>
            <div className="in-card" style={{ overflow: "hidden" }}>
              <table className="in-table">
                <thead><tr>
                  <th>Rep</th><th>Book</th><th>Contacted</th><th>In conversation</th><th>Onboarded</th>
                </tr></thead>
                <tbody>
                  {data.leaderboard.map((r) => (
                    <tr key={r.owner_email}>
                      <td className="co">{r.owner_email || <span className="in-faint">unassigned</span>}</td>
                      <td>{r.total}</td><td>{r.contacted}</td>
                      <td>{r.in_conversation}</td>
                      <td style={{ color: "var(--good)" }}>{r.onboarded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="in-sec-h">Legend</div>
        <div className="in-row in-wrap" style={{ gap: 8 }}>
          {data.funnel.slice(0, 6).map((f) => <StatusPill key={f.key} status={f.key} label={f.label} />)}
        </div>
      </>)}
    </>
  );
}
