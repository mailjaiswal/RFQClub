"use client";
// Inside-sales "console" app frame: the auth gate, the shell, and a shared context
// so the pages under /console can read the signed-in rep and the controlled
// vocabularies without re-fetching.
//
// Access is DB-managed: the account must either carry a sales / sales_manager role
// (which only a manager can grant from the Team panel, or the one-time admin seed)
// OR be on the server's CONSOLE_ADMIN_EMAILS allowlist — the flag `is_console_admin`
// echoed by /api/auth/me. The allowlist is how the site owner keeps console access
// without giving up their existing marketplace role. Either way there is no
// self-claim: a normal signed-in account that was never provisioned simply sees a
// "not a member" screen. And even once the check passes, every data call is
// independently gated server-side by /api/sales (require_sales), so the client
// never has to "trust" itself.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { authMe, changePassword, type AuthUser } from "@/lib/api";
import { clearSession, getToken } from "@/lib/session";
import { getMeta, getSummary, type SalesMeta, type Summary } from "@/lib/sales-api";

type Status = "checking" | "needs_login" | "not_provisioned" | "must_change" | "ready" | "denied";

interface Ctx {
  user: AuthUser | null;
  isManager: boolean;
  meta: SalesMeta | null;
  reload: () => void;
}
const ConsoleCtx = createContext<Ctx | null>(null);
export function useConsole(): Ctx {
  const c = useContext(ConsoleCtx);
  if (!c) throw new Error("useConsole must be used inside <ConsoleApp>");
  return c;
}

const SALES_ROLES = new Set(["sales", "sales_manager"]);

export default function ConsoleApp({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [meta, setMeta] = useState<SalesMeta | null>(null);
  const [deniedMsg, setDeniedMsg] = useState("");

  const boot = useCallback(async () => {
    if (!getToken()) { setStatus("needs_login"); return; }
    try {
      const { user: u } = await authMe();
      setUser(u);
      // Provisioned if the account carries a sales role OR is an allowlisted
      // console owner (whose marketplace role stays untouched). Otherwise deny.
      if (!SALES_ROLES.has((u.role || "").toLowerCase()) && !u.is_console_admin) { setStatus("not_provisioned"); return; }
      // Deactivated by a manager — hold at the door.
      if (u.is_active === false) {
        setDeniedMsg("This inside-sales account has been deactivated by a manager.");
        setStatus("denied"); return;
      }
      // Still on its temporary password — force a rotation before opening the console.
      if (u.must_change_password) { setStatus("must_change"); return; }
      setMeta(await getMeta());
      setStatus("ready");
    } catch (e) {
      // A 403 from getMeta means a stale token for an account no longer allowed in.
      setDeniedMsg(e instanceof Error ? e.message : "Access denied");
      setStatus("denied");
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  const ctx = useMemo<Ctx>(
    () => ({ user, isManager: (user?.role || "").toLowerCase() === "sales_manager" || !!user?.is_console_admin, meta, reload: boot }),
    [user, meta, boot],
  );

  function signOut() { clearSession(); router.push("/login"); }

  if (status === "checking")
    return <Wrap><div className="in-empty">Connecting to the console…</div></Wrap>;

  if (status === "needs_login")
    return (
      <Wrap>
        <Gate title="Inside-sales sign-in" sub="This console is for the inside-sales team only.">
          <p className="in-muted" style={{ marginBottom: 16 }}>
            You are not signed in. Accounts are created by an admin in the console —
            sign in with the email and password you were given.
          </p>
          <button className="in-btn primary block"
            onClick={() => router.push("/login?next=/console")}>Sign in</button>
        </Gate>
      </Wrap>
    );

  if (status === "not_provisioned")
    return (
      <Wrap>
        <Gate title="Not a console member"
          sub={`Signed in as ${user?.email}. This account has no inside-sales access.`}>
          <p className="in-muted" style={{ marginBottom: 16 }}>
            Access is granted by an admin from the console's <b>Team &amp; access</b> panel.
            Only accounts that have been added there can sign in here. If you believe you
            should have access, ask your admin to add your email.
          </p>
          <div style={{ marginTop: 8 }}>
            <button className="in-btn" onClick={signOut}>Sign out / use a different account</button>
          </div>
        </Gate>
      </Wrap>
    );

  if (status === "must_change")
    return (
      <Wrap>
        <Gate title="Set your password"
          sub={`Welcome, ${user?.email}. Choose a new password before entering the console.`}>
          <ForcePasswordChange email={user?.email || ""} onDone={boot} onSignOut={signOut} />
        </Gate>
      </Wrap>
    );

  if (status === "denied")
    return (
      <Wrap>
        <Gate title="Access denied" sub="Your account could not be verified for the console.">
          <p className="in-err">{deniedMsg}</p>
          <div style={{ marginTop: 16 }}>
            <button className="in-btn" onClick={signOut}>Sign out</button>
          </div>
        </Gate>
      </Wrap>
    );

  // ready
  return (
    <ConsoleCtx.Provider value={ctx}>
      <Shell>{children}</Shell>
    </ConsoleCtx.Provider>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="internal"><div className="in-gate"><div className="in-gate-card">{children}</div></div></div>;
}

function Gate({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <>
      <div className="in-brand"><span className="dot" /><b>RFQClub · Console</b></div>
      <div className="in-tag">Inside Sales</div>
      <h2 className="display" style={{ fontSize: 20, margin: "8px 0 4px", color: "var(--txt)" }}>{title}</h2>
      <p className="in-muted" style={{ margin: "0 0 16px", fontSize: 12 }}>{sub}</p>
      {children}
    </>
  );
}

// Forced first-login (or post-admin-reset) password rotation. The member sets a new
// password with a confirm step; we surface a confirmation popup before committing.
// On success the parent re-boots, which now finds must_change_password cleared.
function ForcePasswordChange({ email, onDone, onSignOut }: {
  email: string; onDone: () => void; onSignOut: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ask, setAsk] = useState(false);

  function submit() {
    setErr("");
    if (next.length < 8) { setErr("New password must be at least 8 characters."); return; }
    if (!/[0-9]/.test(next) || !/[a-zA-Z]/.test(next)) { setErr("Use both letters and numbers."); return; }
    if (next !== confirm) { setErr("The two new passwords don't match."); return; }
    if (next === current) { setErr("New password must differ from the current one."); return; }
    setAsk(true);  // confirmation popup before committing to the DB
  }

  async function commit() {
    setAsk(false); setBusy(true); setErr("");
    try {
      await changePassword(current, next);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not change the password.");
      setBusy(false);
    }
  }

  return (
    <div className="in-form">
      <label><span className="in-lbl">Email</span>
        <input className="in-field" value={email} disabled /></label>
      <label><span className="in-lbl">Current password</span>
        <input className="in-field" type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
          placeholder="The temporary password you were given" /></label>
      <label><span className="in-lbl">New password</span>
        <input className="in-field" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label><span className="in-lbl">Confirm new password</span>
        <input className="in-field" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      {err && <p className="in-err" style={{ margin: "2px 0 0" }}>{err}</p>}
      <button className="in-btn primary block" style={{ marginTop: 8 }} onClick={submit} disabled={busy}>
        {busy ? "Updating…" : "Change password & enter"}</button>
      <button className="in-btn" onClick={onSignOut}>Use a different account</button>
      {ask && (
        <ConfirmPopup
          title="Confirm password change"
          body={`Set a new password for ${email}? This will be saved immediately.`}
          onCancel={() => setAsk(false)} onConfirm={commit} />
      )}
    </div>
  );
}

// Reusable "are you sure?" overlay shown before any password is committed to the DB.
export function ConfirmPopup({ title, body, danger, confirmLabel = "Confirm", onCancel, onConfirm }: {
  title: string; body: string; danger?: boolean; confirmLabel?: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="in-modal-backdrop" onClick={onCancel}>
      <div className="in-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="display" style={{ fontSize: 16, margin: "0 0 6px", color: "var(--txt)" }}>{title}</h3>
        <p className="in-muted" style={{ margin: "0 0 16px", fontSize: 13 }}>{body}</p>
        <div className="in-row" style={{ gap: 10, justifyContent: "flex-end" }}>
          <button className="in-btn" onClick={onCancel}>Cancel</button>
          <button className={`in-btn ${danger ? "bad" : "primary"}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { user, isManager, meta, reload } = useConsole();
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    getSummary().then((s: Summary) => setCounts(s.tiles)).catch(() => {});
  }, [pathname, reload]);

  const view = sp.get("view") || "";
  const isLeads = pathname.startsWith("/console/leads");
  const isTeam = pathname.startsWith("/console/team");
  const isReports = pathname.startsWith("/console/reports");
  const linkActive = (href: string, v?: string) => {
    if (href === "/console") return pathname === "/console";
    if (!isLeads) return false;
    return view === (v || "") || (!view && v === "mine");
  };
  const go = (href: string) => router.push(href);
  function signOut() { clearSession(); router.push("/"); }

  return (
    <div className="internal">
      <div className="in-frame">
        <aside className="in-rail">
          <div className="in-brand" style={{ padding: "4px 8px 8px" }}>
            <span className="dot" /><b>Console</b>
          </div>
          <div className="in-tag" style={{ padding: "0 8px" }}>Inside Sales</div>

          <div className="sect">Workspace</div>
          <Link className={`in-navlink${linkActive("/console") ? " on" : ""}`} href="/console">◧ Dashboard</Link>
          <Link className={`in-navlink${isReports ? " on" : ""}`} href="/console/reports">⊞ Reports</Link>
          <div className="sect">Queues</div>
          <a className={`in-navlink${linkActive("/console/leads", "mine") ? " on" : ""}`} onClick={() => go("/console/leads?view=mine")}>☰ My queue{counts.mine ? <span className="k">{counts.mine}</span> : null}</a>
          <a className={`in-navlink${linkActive("/console/leads", "unassigned") ? " on" : ""}`} onClick={() => go("/console/leads?view=unassigned")}>◨ Unclaimed{counts.unassigned ? <span className="k">{counts.unassigned}</span> : null}</a>
          <a className={`in-navlink${linkActive("/console/leads", "followups") ? " on" : ""}`} onClick={() => go("/console/leads?view=followups")}>⟳ Follow-ups{counts.followups_pending ? <span className="k">{counts.followups_pending}</span> : null}</a>

          {isManager && (<>
            <div className="sect">Manager</div>
            <a className={`in-navlink${linkActive("/console/leads", "all") ? " on" : ""}`} onClick={() => go("/console/leads?view=all")}>▦ All leads</a>
            <a className={`in-navlink${linkActive("/console/leads", "excluded") ? " on" : ""}`} onClick={() => go("/console/leads?view=excluded")}>⊘ Out of scope{counts.excluded ? <span className="k">{counts.excluded}</span> : null}</a>
            <Link className={`in-navlink${isTeam ? " on" : ""}`} href="/console/team">👥 Team &amp; access</Link>
          </>)}

          <div className="sect">Marketplace</div>
          <a className="in-navlink" onClick={() => router.push("/board")}>↗ RFQClub board</a>
        </aside>

        <div className="in-main">
          <div className="in-top">
            <span className="in-tag">{meta ? "Lead console" : "…"}</span>
            <div className="who">
              <span>{user?.email}</span>
              <span className="in-pill st-onboarding">{(user?.role || "").replace("sales_", "")}</span>
              <button className="in-btn sm" onClick={() => window.location.reload()}>↻</button>
              <button className="in-btn sm" onClick={signOut}>Sign out</button>
            </div>
          </div>
          <div className="in-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
