"use client";
import { useEffect, useState } from "react";
import { authMe, changePassword, type AuthUser } from "@/lib/api";

// Authenticated account-security dialog: shows real session facts from
// /api/auth/me and lets the signed-in user change (or, for a Google/OTP-only
// account, set) their password. Rendered as an overlay from the app rail.
export default function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [me, setMe] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    authMe()
      .then((r) => { if (alive) { setMe(r.user); setLoading(false); } })
      .catch(() => { if (alive) { setError("Your session expired — please sign in again."); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function submit() {
    setError(null); setDoneMsg(null);
    if (next.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setError("New passwords don't match."); return; }
    setBusy(true);
    try {
      const r = await changePassword(current, next);
      setMe(r.user);
      setCurrent(""); setNext(""); setConfirm("");
      setDoneMsg("Password updated — use it next time you sign in.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the password.");
    } finally { setBusy(false); }
  }

  const hasPw = me?.has_password ?? false;
  const fmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <div className="pwx-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pwx-card" onClick={(e) => e.stopPropagation()}>
        <div className="lg-k mono">Account security</div>
        <h1>{hasPw ? "Change password" : "Set a password"}</h1>

        {loading ? (
          <p className="pwx-muted">Loading your account…</p>
        ) : (
          <>
            <p>
              Signed in as <b>{me?.email}</b> · {me?.role || "member"}.<br />
              Member since {fmt(me?.created_at)} · Last sign-in {fmt(me?.last_login)}.
            </p>

            {!hasPw && (
              <div className="lg-demo">
                You joined with Google or a one-time code. Set a password to also
                sign in with email + password.
              </div>
            )}

            {hasPw && (
              <>
                <label className="lg-lbl">Current password</label>
                <input className="lg-in" type="password" value={current}
                  onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" />
              </>
            )}

            <label className="lg-lbl">New password</label>
            <input className="lg-in" type="password" value={next}
              onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" />

            <label className="lg-lbl">Confirm new password</label>
            <input className="lg-in" type="password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Re-enter new password" />

            {error && <div className="lg-err">⚠ {error}</div>}
            {doneMsg && !error && <div className="pwx-ok">✓ {doneMsg}</div>}

            <div className="pwx-actions">
              <button className="lg-btn lg-btn-ghost" onClick={onClose}>Close</button>
              <button className="lg-btn"
                disabled={busy || !next || confirm.length === 0 || (hasPw && !current)}
                onClick={submit}>
                {busy ? "Saving…" : (hasPw ? "Update password" : "Set password")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
