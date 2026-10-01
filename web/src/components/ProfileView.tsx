"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import type { Profile, ProfileBlock, ProfileField } from "@/lib/api";

const SUN = <svg className="ic-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
const MOON = <svg className="ic-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;

const TAB_ICON: Record<string, React.ReactNode> = {
  building: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M3 9h5M3 14h5" /></svg>,
  contact: <svg viewBox="0 0 24 24"><path d="M16 3h5v5M21 3l-7 7M11 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" /></svg>,
  tool: <svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z" /></svg>,
  medal: <svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="6" /><path d="m9 21 3-3 3 3" /></svg>,
  shield: <svg viewBox="0 0 24 24"><path d="M12 2 4 6v6c0 5 3.4 8 8 10 4.6-2 8-5 8-10V6z" /></svg>,
  card: <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>,
  gear: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z" /></svg>,
  chart: <svg viewBox="0 0 24 24"><path d="M3 3v18h18M7 14l3-4 3 3 5-6" /></svg>,
};

const PILL_CLASS: Record<string, string> = {
  won: "pf-won", ok: "pf-won", open: "pf-open", act: "pf-open",
  lost: "pf-lost", pend: "pf-close", close: "pf-close",
};

const VER_ICON: Record<string, React.ReactNode> = {
  email: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m4 7 8 6 8-6" /></svg>,
  phone: <svg viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>,
  gst: <svg viewBox="0 0 24 24"><path d="M12 2 4 6v6c0 5 3.4 8 8 10 4.6-2 8-5 8-10V6z" /><path d="M12 8v5M12 16h.01" /></svg>,
};

function Field({ f }: { f: ProfileField }) {
  const kind = f.kind || "input";
  return (
    <div className={`pf-f${f.full ? " full" : ""}`}>
      <label>{f.label}{f.req ? <span className="req"> *</span> : null}</label>
      {kind === "select" ? (
        <select defaultValue={f.value || f.options?.[0]}>
          {(f.options || []).map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : kind === "textarea" ? (
        <textarea defaultValue={f.value || ""} placeholder={f.placeholder} />
      ) : kind === "phone" ? (
        <div className="pf-pre"><span className="cc">{f.prefix || "+91"}</span><input defaultValue={f.value || ""} /></div>
      ) : (
        <input
          type={kind === "password" ? "password" : "text"}
          defaultValue={f.value || ""}
          placeholder={f.placeholder}
          disabled={kind === "disabled"}
        />
      )}
      {f.hint ? <div className="hint">{f.hint}</div> : null}
    </div>
  );
}

function Chip({ text, on, proc }: { text: string; on?: boolean; proc?: boolean }) {
  const [active, setActive] = useState(!!on);
  return (
    <span
      className={`pf-chip${proc ? " proc" : ""}${active ? " on" : ""}`}
      onClick={() => setActive((v) => !v)}
    >
      {text}
    </span>
  );
}

function VerifyRow({ row }: { row: Record<string, any> }) {
  const [otp, setOtp] = useState(false);
  const stateClass = row.state?.kind === "ok" ? "st-ok" : row.state?.kind === "pend" ? "st-pend" : "st-act";
  const amber = row.amber;
  const tint = amber ? { background: "rgba(183,122,27,.05)", borderColor: "rgba(183,122,27,.3)" } : undefined;
  const icBg = amber ? "rgba(183,122,27,.15)" : "rgba(46,125,70,.13)";
  const icStroke = amber ? "#B77A1B" : "#266B3C";
  const otpData = row.otp;
  return (
    <>
      <div className="pf-vv" style={tint}>
        <div className="vic" style={{ background: icBg }}>
          <span style={{ display: "grid", color: icStroke }}>{VER_ICON[row.kind]}</span>
        </div>
        <div className="vtx"><b>{row.title}</b><p>{row.desc}</p></div>
        <div className="vst">
          <span className={`st-pill ${stateClass}`}>● {row.state?.text}</span>
          {row.action ? (
            <button
              className={`pf-vbtn${otpData ? " link" : ""}`}
              onClick={() => otpData && setOtp((v) => !v)}
            >
              {row.action}
            </button>
          ) : null}
        </div>
      </div>
      {otpData && (
        <div className={`pf-otp${otp ? " show" : ""}`} id={`otp-${row.kind}`}>
          <p>{otpData.desc}</p>
          <div className="boxes">
            {(otpData.preset || ["", "", "", "", "", ""]).map((v: string, i: number) => (
              <input key={i} maxLength={1} defaultValue={v} readOnly={false} />
            ))}
          </div>
          <div className="row">
            <button className="pf-cf" onClick={() => setOtp(false)}>Confirm</button>
            <button className="pf-vbtn link">Resend code</button>
            <b>{otpData.timer}</b>
          </div>
        </div>
      )}
    </>
  );
}

function Block({ b }: { b: ProfileBlock }) {
  if (b.type === "grid") {
    return (
      <>
        {b.label ? <div className="pf-grouplbl">{b.label}</div> : null}
        <div className="pf-grid">
          {(b.fields || []).map((f, i) => <Field key={i} f={f} />)}
        </div>
      </>
    );
  }
  if (b.type === "chips") {
    const items = (b.items || []) as { text: string; on?: boolean; proc?: boolean }[];
    return (
      <>
        {b.label ? <div className="pf-grouplbl">{b.label}</div> : null}
        <div className="pf-chips">
          {items.map((c, i) => <Chip key={i} text={c.text} on={c.on} proc={c.proc} />)}
        </div>
        {b.note ? <div className="hint" style={{ marginTop: 8 }}>{b.note}</div> : null}
      </>
    );
  }
  if (b.type === "table") {
    return (
      <>
        {b.label ? <div className="pf-grouplbl">{b.label}</div> : null}
        <table className="pf-tbl">
          <thead><tr>{(b.cols || []).map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {(b.rows || []).map((row, ri) => (
              <tr key={ri}>
                {row.map((cell: any, ci) => {
                  if (cell.pill) return <td key={ci}><span className={`pf-pill ${PILL_CLASS[cell.pill.state] || "pf-close"}`}>{cell.pill.text}</span></td>;
                  if (cell.sec) return (
                    <td key={ci}>
                      <span className="pf-sec" style={{ color: cell.sec.color }}><i style={{ background: cell.sec.color }} />{cell.sec.label}</span>
                      {cell.text}
                    </td>
                  );
                  return <td key={ci} className={cell.rt ? "pf-rt" : undefined}>{cell.text}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }
  if (b.type === "verify") {
    return (
      <>
        {(b.rows || []).map((row: any, i) => <VerifyRow key={i} row={row} />)}
      </>
    );
  }
  if (b.type === "stats") {
    const items = (b.items || []) as { num: string; label: string }[];
    return (
      <div className="pf-stats">
        {items.map((s, i) => <div className="pf-stat" key={i}><b>{s.num}</b><span>{s.label}</span></div>)}
      </div>
    );
  }
  if (b.type === "addrow") {
    return <div className="pf-addrow"><button onClick={(e) => e.preventDefault()}>{b.label}</button></div>;
  }
  return null;
}

export default function ProfileView({ profile }: { profile: Profile }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState(profile.tabs[0]?.id || "company");
  const [saved, setSaved] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";

  const panel = profile.panels[tab];

  return (
    <div className={`pf${dark ? " dark" : ""}`} id="pfScope">
      <div className="pf-top">
        <span className="pf-mark">RFQ<b>Club</b>.</span>
        <span className="pf-crumb"><Link href="/board">Board</Link> / My profile</span>
        <span className="sp" />
        <button className="icbtn" title="Toggle light / dark theme" aria-label="Toggle theme"
          onClick={() => setTheme(dark ? "light" : "dark")}>{SUN}{MOON}</button>
        <button className="pf-ghost" onClick={(e) => e.preventDefault()}>View public page</button>
        <button className="pf-save" onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1600); }}>
          {saved ? "Saved ✓" : "Save changes"}
        </button>
      </div>

      <div className="pf-wrap">
        <aside className="pf-side">
          <div className="pf-card">
            <div className="pf-id">
              <div className="pf-logo">{profile.identity.logo}</div>
              <div>
                <h3>{profile.identity.name}</h3>
                <p>{profile.identity.since}</p>
                <span className="pf-badge"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>{profile.identity.badge}</span>
              </div>
            </div>
            <div className="pf-ringrow" style={{ marginTop: 16 }}>
              <div className="pf-ring" style={{ ["--p" as any]: profile.percent }}><i>{profile.percent}%</i></div>
              <div className="pf-ringtxt"><b>Profile strength</b><p>{profile.strength_note}</p></div>
            </div>
            <div className="pf-miss">
              {profile.missing.map((m, i) => (
                <a key={i} href="#" onClick={(e) => { e.preventDefault(); setTab(m.tab); }}>
                  <span className="d" />{m.label}<b>{m.pct}</b>
                </a>
              ))}
            </div>
          </div>

          <div className="pf-card pf-tabs" style={{ padding: 10 }}>
            {profile.tabs.map((t) => (
              <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {TAB_ICON[t.icon]}{t.label}
                {t.count ? <span className="n">{t.count}</span> : null}
              </button>
            ))}
          </div>
        </aside>

        <div className="pf-main">
          <div className="pf-panel on">
            <div className="pf-h">{panel.title}</div>
            <p className="pf-sub">{panel.sub}</p>
            {panel.blocks.map((b, i) => <Block key={i} b={b} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
