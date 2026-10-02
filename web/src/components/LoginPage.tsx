"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  otpRequest, otpVerify, authSetRole,
  register as apiRegister, login as apiLogin, googleSignIn,
  forgotPassword, resetPassword,
  type AuthUser, type VerifyResult,
} from "@/lib/api";
import { setSession } from "@/lib/session";

// Google Identity Services (ID-token). Absent env → the Google block is hidden
// entirely (never show a broken button). Value is public (client ID, not secret).
const GOOGLE_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "").trim();

type View = "signin" | "register" | "code" | "role" | "forgot" | "reset";

/* minimal shape of the GSI global we touch, so we need no extra @types dep */
type GoogleCredentialResponse = { credential?: string };

function Inner() {
  const router = useRouter();
  const rawNext = useSearchParams().get("next");
  const rawReset = useSearchParams().get("reset");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/board";

  const [view, setView] = useState<View>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  // true when the token arrived via a real emailed ?reset= link (not demo fallback)
  const [resetViaLink, setResetViaLink] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Demo OTP auto-fill when a code is surfaced on-screen, and following a real
  // password-reset link that lands here as /login?reset=<token>.
  useEffect(() => {
    if (view === "code" && devCode) setCode(devCode);
  }, [view, devCode]);

  useEffect(() => {
    if (rawReset) {
      setResetToken(rawReset);
      setResetViaLink(true);
      setPassword(""); setConfirm(""); setError(null);
      setView("reset");
    }
  }, [rawReset]);

  // ---- helpers ----
  function done(v: VerifyResult, forceRole = false) {
    setSession(v.token, v.user);
    setUser(v.user);
    if (forceRole || v.is_new) {
      setView("role");
    } else {
      router.push(next);
      router.refresh();
    }
  }

  async function doLogin() {
    setBusy(true); setError(null);
    try { done(await apiLogin(email.trim(), password)); }
    catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }

  async function doRegister() {
    setError(null);
    if (!email.includes("@")) { setError("Enter a valid email address."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try { done(await apiRegister(email.trim(), password, name.trim()), true); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create the account."); }
    finally { setBusy(false); }
  }

  // ---- forgot password / reset ----
  async function startForgot() {
    setBusy(true); setError(null); setResetSent(false);
    try {
      const r = await forgotPassword(email.trim());
      if (r.dev_reset_token) {
        // demo fallback (no mailer configured): follow the link straight away
        setResetToken(r.dev_reset_token);
        setResetViaLink(false);
        setPassword(""); setConfirm("");
        setView("reset");
      } else {
        setResetSent(true); // a real reset link was emailed (never reveals if account exists)
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start the reset."); }
    finally { setBusy(false); }
  }

  async function doReset() {
    setError(null);
    if (!resetToken) { setError("Reset link missing — start over."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try { done(await resetPassword(resetToken, password)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not reset the password."); }
    finally { setBusy(false); }
  }

  async function handleGoogle(credential?: string) {
    if (!credential) { setError("Google didn't return a credential."); return; }
    setBusy(true); setError(null);
    try { done(await googleSignIn(credential)); }
    catch (e) { setError(e instanceof Error ? e.message : "Google sign-in failed."); }
    finally { setBusy(false); }
  }

  // Mount the official Google button when a client ID is configured.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || (view !== "signin" && view !== "register")) return;
    const el = googleBtnRef.current;
    if (!el) return;
    const node: HTMLDivElement = el;
    const g = () => (window as unknown as { google?: { accounts?: { id?: unknown } } }).google;
    function render() {
      const grp = (window as unknown as {
        google?: { accounts?: { id?: {
          initialize: (o: { client_id: string; callback: (r: GoogleCredentialResponse) => void }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        } } };
      }).google;
      if (!grp?.accounts?.id) return;
      grp.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp) => handleGoogle(resp?.credential),
      });
      // Mount the button into a host we create imperatively. React never owns
      // children of `node`, so it can't try to removeChild a node GSI replaced
      // (that mismatch was crashing /login with a 'removeChild' NotFoundError).
      node.textContent = "";
      const host = document.createElement("div");
      node.appendChild(host);
      try {
        grp.accounts.id.renderButton(host, { theme: "outline", size: "large", width: 300, text: "continue_with" });
      } catch {
        /* GSI failed to render — leave the fallback visible, don't throw */
      }
      setGoogleReady(true);
    }
    if (g()?.accounts?.id) { render(); return; }
    if (!document.getElementById("ggs-gsi")) {
      const s = document.createElement("script");
      s.id = "ggs-gsi"; s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true;
      s.onload = render;
      document.head.appendChild(s);
    } else {
      const t = setInterval(() => { if (g()?.accounts?.id) { render(); clearInterval(t); } }, 150);
      return () => clearInterval(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ---- one-time code (OTP) path, retained ----
  async function sendCode() {
    setBusy(true); setError(null);
    try {
      const r = await otpRequest(email.trim());
      setDevCode(r.dev_code ?? null);
      setView("code");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send the code."); }
    finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setError(null);
    try { done(await otpVerify(email.trim(), code.trim()), true); }
    catch (e) { setError(e instanceof Error ? e.message : "Verification failed."); }
    finally { setBusy(false); }
  }
  async function chooseRole(role: string) {
    setBusy(true); setError(null);
    try {
      const r = await authSetRole(role);
      setSession(r.token, r.user);
      router.push(next); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update role."); }
    finally { setBusy(false); }
  }

  // One-click demo instant sign-in (needs OTP_MODE=dev).
  async function quickDemo(role: "buyer" | "supplier") {
    setBusy(true); setDemoBusy(role); setError(null);
    try {
      const demoEmail = `demo.${role}@rfqclub.app`;
      const r = await otpRequest(demoEmail);
      if (!r.dev_code) throw new Error("Demo sign-in needs dev code delivery (OTP_MODE=dev).");
      const v = await otpVerify(demoEmail, r.dev_code);
      setSession(v.token, v.user); // store first so authSetRole carries the bearer
      const rv = await authSetRole(role);
      setSession(rv.token, rv.user);
      router.push(next); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Demo sign-in failed."); }
    finally { setBusy(false); setDemoBusy(null); }
  }

  const tabs = (
    <div className="lg-tabs">
      <button className={`lg-tab${view === "signin" ? " on" : ""}`} onClick={() => { setView("signin"); setError(null); }}
        disabled={view === "role"}>Sign in</button>
      <button className={`lg-tab${view === "register" ? " on" : ""}`} onClick={() => { setView("register"); setError(null); }}
        disabled={view === "role"}>Register</button>
    </div>
  );

  const googleBlock = GOOGLE_CLIENT_ID && (view === "signin" || view === "register") ? (
    <div className="lg-google">
      {/* React renders this node EMPTY and never reconciles its children — GSI
          owns everything inside. The loading fallback is a sibling. */}
      <div className="lg-google-btn" ref={googleBtnRef} />
      {!googleReady && <span className="lg-google-fallback">Loading Google sign-in…</span>}
    </div>
  ) : null;

  const demoBlock = (view === "signin" || view === "register") ? (
    <>
      <div className="lg-or"><span>or explore instantly</span></div>
      <div className="lg-demo-row">
        <button className="lg-btn lg-btn-ghost" disabled={busy} onClick={() => quickDemo("buyer")}>
          {demoBusy === "buyer" ? "Signing in…" : "Continue as demo Buyer →"}
        </button>
        <button className="lg-btn lg-btn-ghost" disabled={busy} onClick={() => quickDemo("supplier")}>
          {demoBusy === "supplier" ? "Signing in…" : "Continue as demo Supplier →"}
        </button>
      </div>
      <p className="lg-hint">No password needed — signs into a shared <span className="mono">demo.{demoBusy ?? "role"}</span> account so saved RFQs, posts and bids persist across the demo.</p>
      <button className="lg-switch" onClick={() => { setError(null); sendCode(); }}>Use a one-time email code instead →</button>
    </>
  ) : null;

  return (
    <div className="lg-wrap">
      <div className="lg-card">
        <div className="lg-k mono">RFQClub access</div>

        {view === "signin" && (
          <>
            {tabs}
            <h1>Welcome back</h1>
            <p>Sign in with your email and password to track your RFQs.</p>
            <label className="lg-lbl">Email</label>
            <input className="lg-in" type="email" placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.includes("@") && password && doLogin()} />
            <label className="lg-lbl">Password</label>
            <input className="lg-in" type="password" placeholder="••••••••" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()} />
            <div style={{ textAlign: "right", marginTop: "-4px" }}>
              <button className="lg-switch" style={{ display: "inline" }} onClick={() => { setView("forgot"); setError(null); setResetSent(false); }}>Forgot password?</button>
            </div>
            {error && <div className="lg-err">⚠ {error}</div>}
            <button className="lg-btn" disabled={!email.includes("@") || !password || busy} onClick={doLogin}>
              {busy ? "Signing in…" : "Sign in →"}
            </button>
            <p className="lg-hint">New here? <button className="lg-switch" style={{ display: "inline" }} onClick={() => { setView("register"); setError(null); }}>Create an account</button></p>
            {googleBlock}
            {demoBlock}
          </>
        )}

        {view === "register" && (
          <>
            {tabs}
            <h1>Create your account</h1>
            <p>Post RFQs, place blinded bids and track everything on one board.</p>
            <label className="lg-lbl">Name</label>
            <input className="lg-in" type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="lg-lbl">Email</label>
            <input className="lg-in" type="email" placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.includes("@") && doRegister()} />
            <label className="lg-lbl">Password</label>
            <input className="lg-in" type="password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
            <label className="lg-lbl">Confirm password</label>
            <input className="lg-in" type="password" placeholder="Re-enter password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doRegister()} />
            {error && <div className="lg-err">⚠ {error}</div>}
            <button className="lg-btn" disabled={!email.includes("@") || password.length < 8 || confirm.length === 0 || busy} onClick={doRegister}>
              {busy ? "Creating…" : "Create account →"}
            </button>
            <p className="lg-hint">Already registered? <button className="lg-switch" style={{ display: "inline" }} onClick={() => { setView("signin"); setError(null); }}>Sign in</button></p>
            {googleBlock}
            {demoBlock}
          </>
        )}

        {view === "code" && (
          <>
            <h1>Enter your code</h1>
            <p>Sent to <b>{email.trim()}</b>. The code expires in 10 minutes.</p>
            {devCode && (
              <div className="lg-demo">
                <b>Demo mode</b> — email delivery isn&apos;t wired up, so the code is shown right here:{" "}
                <span className="mono lg-code">{devCode}</span>
              </div>
            )}
            <label className="lg-lbl">6-digit code</label>
            <input className="lg-in mono" inputMode="numeric" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && code.length === 6 && verify()} />
            {error && <div className="lg-err">⚠ {error}</div>}
            <button className="lg-btn" disabled={code.length !== 6 || busy} onClick={verify}>
              {busy ? "Verifying…" : "Verify code →"}
            </button>
            <button className="lg-again" onClick={() => { setView("signin"); setError(null); }}>← back to email &amp; password</button>
          </>
        )}

        {view === "forgot" && (
          <>
            <h1>Reset your password</h1>
            <p>Enter the email on your account and we&apos;ll send a secure reset link.</p>
            <label className="lg-lbl">Email</label>
            <input className="lg-in" type="email" placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.includes("@") && startForgot()} />
            {resetSent && (
              <div className="lg-demo"><b>Check your inbox</b> — if an account exists for{" "}
                <span className="mono">{email.trim()}</span>, a reset link is on its way.</div>
            )}
            {error && <div className="lg-err">⚠ {error}</div>}
            <button className="lg-btn" disabled={!email.includes("@") || busy} onClick={startForgot}>
              {busy ? "Sending…" : "Send reset link →"}
            </button>
            <button className="lg-again" onClick={() => { setView("signin"); setError(null); setResetSent(false); }}>← back to sign in</button>
          </>
        )}

        {view === "reset" && (
          <>
            <h1>Choose a new password</h1>
            {email.trim()
              ? <p>Resetting the password for <b>{email.trim()}</b>.</p>
              : <p>Set a new password for the account this reset link belongs to.</p>}
            {!resetViaLink && (
              <div className="lg-demo">
                <b>Demo mode</b> — email delivery isn&apos;t wired up, so we opened your reset link right here:{" "}
                <span className="mono lg-code">{(resetToken || "").slice(0, 8)}…</span>
              </div>
            )}
            <label className="lg-lbl">New password</label>
            <input className="lg-in" type="password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
            <label className="lg-lbl">Confirm new password</label>
            <input className="lg-in" type="password" placeholder="Re-enter password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doReset()} />
            {error && <div className="lg-err">⚠ {error}</div>}
            <button className="lg-btn" disabled={password.length < 8 || confirm.length === 0 || busy} onClick={doReset}>
              {busy ? "Updating…" : "Reset password →"}
            </button>
            <button className="lg-again" onClick={() => { setView("signin"); setError(null); setResetToken(null); }}>← cancel</button>
          </>
        )}

        {view === "role" && (
          <>
            <h1>How will you use RFQClub?</h1>
            <p>You can switch this later. Welcome, <b>{user?.name || user?.email}</b>.</p>
            <div className="lg-roles">
              <button className="lg-role" disabled={busy} onClick={() => chooseRole("buyer")}>
                <b>I&apos;m a Buyer</b>
                <span>Post RFQs, compare blinded bids, award the best total landed cost.</span>
              </button>
              <button className="lg-role" disabled={busy} onClick={() => chooseRole("supplier")}>
                <b>I&apos;m a Supplier</b>
                <span>Browse the board, watch sectors, quote on the work your shop makes.</span>
              </button>
            </div>
            <button className="lg-role lg-role-staff" disabled={busy} onClick={() => chooseRole("operator")}>
              <b>Concierge / staff</b>
              <span>Review incoming requirements and publish them to the board. Only works if this account is
                allowlisted (or the demo allows any staff claim).</span>
            </button>
            {error && <div className="lg-err">⚠ {error}</div>}
          </>
        )}

        <div className="lg-foot mono">Demo auth · data is shared and resets with the seed</div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
