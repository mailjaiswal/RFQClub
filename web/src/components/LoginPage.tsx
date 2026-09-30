"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { otpRequest, otpVerify, authSetRole, type AuthUser } from "@/lib/api";
import { setSession } from "@/lib/session";

type Step = "email" | "code" | "role";

function Inner() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step === "code" && devCode) setCode(devCode); // demo: auto-fill the mock-delivered code
  }, [step, devCode]);

  async function sendCode() {
    setBusy(true); setError(null);
    try {
      const r = await otpRequest(email.trim());
      setDevCode(r.dev_code ?? null);
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code.");
    } finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setError(null);
    try {
      const r = await otpVerify(email.trim(), code.trim());
      setUser(r.user);
      setSession(r.token, r.user);
      setStep("role");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally { setBusy(false); }
  }

  async function chooseRole(role: string) {
    setBusy(true); setError(null);
    try {
      const r = await authSetRole(role);
      setSession(r.token, r.user);
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update role.");
    } finally { setBusy(false); }
  }

  return (
    <div className="lg-wrap">
      <div className="lg-card">
        <div className="lg-k mono">RFQClub access</div>
        {step === "email" && (
          <>
            <h1>Sign in to track your RFQs</h1>
            <p>We&apos;ll send a one-time code to your email. No passwords in the demo.</p>
            <label className="lg-lbl">Work email</label>
            <input className="lg-in" type="email" placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.includes("@") && sendCode()} />
            {error && <div className="lg-err">⚠ {error}</div>}
            <button className="lg-btn" disabled={!email.includes("@") || busy} onClick={sendCode}>
              {busy ? "Sending…" : "Send code →"}
            </button>
          </>
        )}
        {step === "code" && (
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
            <button className="lg-again" onClick={() => { setStep("email"); setError(null); }}>← use a different email</button>
          </>
        )}
        {step === "role" && (
          <>
            <h1>How will you use RFQClub?</h1>
            <p>You can switch this later. Welcome, <b>{user?.email}</b>.</p>
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
