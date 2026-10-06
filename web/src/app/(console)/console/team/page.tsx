"use client";
// Manager-only "Team & access" panel — the control surface that decides who can
// enter the console at all. Everything here is DB-managed: create a user (they can
// now sign in), reset a password, change a role, deactivate/restore access.
//
// Per the product rule, EVERY password being created or changed is routed through
// a confirmation popup before it is committed — nothing writes to the DB until the
// manager confirms in that overlay.
import { useCallback, useEffect, useState } from "react";
import { ConfirmPopup, useConsole } from "@/components/console/ConsoleApp";
import { fmtDate } from "@/components/console/ui";
import {
  createTeamUser, getTeam, resetTeamPassword, setTeamActive, setTeamRole,
  type TeamUser,
} from "@/lib/sales-api";

const msg = (e: unknown) => String((e as Error)?.message || e);
// Mirror the server's _password_ok so the manager isn't surprised by a 422.
const pwOk = (pw: string) => pw.length >= 8 && /[0-9]/.test(pw) && /[a-zA-Z]/.test(pw);
const roleLabel = (r: string) => (r === "sales_manager" ? "Manager" : "Sales rep");

type Pending = { title: string; body: string; danger?: boolean; run: () => Promise<void> };

export default function TeamPage() {
  const { user, isManager } = useConsole();
  const me = (user?.email || "").toLowerCase();

  const [rows, setRows] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

  // "add member" form
  const [nEmail, setNEmail] = useState("");
  const [nName, setNName] = useState("");
  const [nPw, setNPw] = useState("");
  const [nRole, setNRole] = useState("sales");

  // inline password reset for one row
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pwVal, setPwVal] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { const r = await getTeam(); setRows(r.items); }
    catch (e) { setErr(msg(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isManager) load(); }, [isManager, load]);

  async function runConfirm() {
    if (!pending) return;
    const p = pending; setPending(null); setErr(""); setFlash("");
    try { await p.run(); await load(); }
    catch (e) { setErr(msg(e)); }
  }

  function submitAdd() {
    setErr(""); setFlash("");
    const email = nEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) { setErr("Enter a valid email address."); return; }
    if (!pwOk(nPw)) { setErr("Password needs at least 8 characters and both letters and numbers."); return; }
    setPending({
      title: "Confirm — create user",
      body: `Create ${roleLabel(nRole).toLowerCase()} ${email} with the password you entered? ` +
        `They can sign in immediately and will be asked to set their own password on first entry.`,
      run: async () => {
        await createTeamUser({ email, name: nName.trim(), password: nPw, role: nRole });
        setNEmail(""); setNName(""); setNPw(""); setNRole("sales");
        setFlash(`${email} added — share the password you set. Their sign-in is now open.`);
      },
    });
  }

  function submitReset(email: string) {
    if (!pwOk(pwVal)) { setErr("Password needs at least 8 characters and both letters and numbers."); return; }
    const self = email === me;
    setPending({
      title: "Confirm — set password",
      body: self
        ? `Reset your own password for ${email}? You'll stay signed in; no forced change.`
        : `Set a new temporary password for ${email}? They'll be required to change it at their next sign-in.`,
      run: async () => {
        await resetTeamPassword(email, pwVal);
        setPwFor(null); setPwVal("");
        setFlash(self ? "Your password was updated." : `${email}'s password was reset.`);
      },
    });
  }

  function toggleActive(u: TeamUser) {
    setErr(""); setFlash("");
    if (u.is_active) {
      setPending({
        title: "Confirm — deactivate access", danger: true,
        body: `Deactivate ${u.email}? Their leads return to the unclaimed pool and they can no longer sign in.`,
        run: async () => { await setTeamActive(u.email, false); setFlash(`${u.email} deactivated.`); },
      });
    } else {
      setPending({
        title: "Confirm — restore access",
        body: `Reactivate ${u.email} so they can sign in to the console again?`,
        run: async () => { await setTeamActive(u.email, true); },
      });
    }
  }

  function changeRole(u: TeamUser, role: string) {
    if (role === u.role) return;
    setErr(""); setFlash("");
    setPending({
      title: "Confirm — change role",
      body: `Change ${u.email} from ${roleLabel(u.role)} to ${roleLabel(role)}?`,
      run: async () => { await setTeamRole(u.email, role); },
    });
  }

  if (!isManager)
    return <div className="in-empty">This panel is for console managers only.</div>;

  return (
    <>
      <div className="in-row in-wrap" style={{ marginBottom: 8 }}>
        <h1 className="display" style={{ fontSize: 20, margin: 0 }}>Team &amp; access</h1>
        <span className="in-tag" style={{ marginLeft: "auto" }}>{rows.length} members</span>
      </div>
      <p className="in-muted" style={{ margin: "0 0 16px", fontSize: 12 }}>
        Only the accounts created here can open the console. Set a starter password for each
        person and share it with them — they must change it the first time they sign in.
      </p>

      {err && <p className="in-err" style={{ marginBottom: 12 }}>{err}</p>}
      {flash && <p className="in-ok" style={{ marginBottom: 12 }}>{flash}</p>}

      {/* ---- add member ---- */}
      <div className="in-card in-pad" style={{ marginBottom: 18 }}>
        <div className="in-sec-h" style={{ marginTop: 0 }}>Add a member</div>
        <div className="in-grid3">
          <label><span className="in-lbl">Email (their login)</span>
            <input className="in-field" type="email" value={nEmail} onChange={(e) => setNEmail(e.target.value)}
              placeholder="intern@company.com" /></label>
          <label><span className="in-lbl">Name (optional)</span>
            <input className="in-field" value={nName} onChange={(e) => setNName(e.target.value)}
              placeholder="Display name" /></label>
          <label><span className="in-lbl">Role</span>
            <select className="in-field" value={nRole} onChange={(e) => setNRole(e.target.value)}>
              <option value="sales">Sales rep</option>
              <option value="sales_manager">Manager</option>
            </select></label>
        </div>
        <div className="in-row in-wrap" style={{ marginTop: 10, gap: 10 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <span className="in-lbl">Starter password</span>
            <input className="in-field" value={nPw} onChange={(e) => setNPw(e.target.value)}
              placeholder="8+ chars, letters and numbers" />
          </div>
          <button className="in-btn primary" style={{ alignSelf: "flex-end" }} onClick={submitAdd}>
            + Create user</button>
        </div>
      </div>

      {/* ---- members ---- */}
      {loading ? <p className="in-faint">Loading team…</p> : (
        <div className="in-card in-scroll-x" style={{ overflow: "hidden" }}>
          <table className="in-table">
            <thead>
              <tr>
                <th>Member</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const self = u.email === me;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="co">{u.name || u.email}{self ? " · you" : ""}</div>
                      {u.name && <div className="sub">{u.email}</div>}
                    </td>
                    <td>
                      <select className="in-field" style={{ maxWidth: 150 }} value={u.role}
                        onChange={(e) => changeRole(u, e.target.value)}>
                        <option value="sales">Sales rep</option>
                        <option value="sales_manager">Manager</option>
                      </select>
                    </td>
                    <td>
                      <div className="in-row" style={{ gap: 6 }}>
                        <span className={`in-pill ${u.is_active ? "st-onboarded" : "st-dead"}`}>
                          {u.is_active ? "active" : "deactivated"}</span>
                        {u.must_change_password && u.is_active &&
                          <span className="in-pill st-potential" title="Has not set their own password yet">temp password</span>}
                      </div>
                    </td>
                    <td className="sub">{fmtDate(u.last_login)}</td>
                    <td>
                      <div className="in-row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {pwFor === u.email ? (
                          <>
                            <input className="in-field" style={{ maxWidth: 160 }} value={pwVal}
                              onChange={(e) => setPwVal(e.target.value)} placeholder="new password" />
                            <button className="in-btn sm primary" onClick={() => submitReset(u.email)}>Save</button>
                            <button className="in-btn sm" onClick={() => { setPwFor(null); setPwVal(""); }}>Cancel</button>
                          </>
                        ) : (
                          <button className="in-btn sm" onClick={() => { setPwFor(u.email); setPwVal(""); setFlash(""); setErr(""); }}>
                            {self ? "Change my password" : "Reset password"}</button>
                        )}
                        {!self && (
                          <button className={`in-btn sm ${u.is_active ? "bad" : "good"}`} onClick={() => toggleActive(u)}>
                            {u.is_active ? "Deactivate" : "Restore"}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={5}><div className="in-empty">No members yet — add your first one above.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pending && (
        <ConfirmPopup
          title={pending.title}
          body={pending.body}
          danger={pending.danger}
          confirmLabel="Yes, save it"
          onCancel={() => setPending(null)}
          onConfirm={runConfirm} />
      )}
    </>
  );
}
