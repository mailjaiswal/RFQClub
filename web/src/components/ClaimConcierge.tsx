"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authSetRole } from "@/lib/api";
import { getUser, setSession } from "@/lib/session";

// Shown on /review when the signed-in account isn't (yet) an operator. Claiming
// the staff role round-trips the API, which enforces OPERATOR_EMAILS — so this
// button succeeds only where the deployment actually permits it.
export default function ClaimConcierge({ message }: { message: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const user = getUser();

  async function claim() {
    setBusy(true);
    setErr(null);
    try {
      const r = await authSetRole("operator");
      setSession(r.token, r.user);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not claim the concierge role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface-card" style={{ padding: 28, maxWidth: 560 }}>
      <div className="display" style={{ fontSize: 20 }}>Concierge access only</div>
      <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
        The review queue is the human gate in front of the board and is limited to RFQClub staff accounts.
        {message && <> The server said: <b>{message}</b>.</>}
      </p>
      {user ? (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            Signed in as <b>{user.email}</b> (role: {user.role || "member"}).
          </p>
          <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={claim}>
            {busy ? "Claiming…" : "Claim concierge role"}
          </button>
          {err && <div className="chip urgency-red" style={{ marginTop: 12, width: "fit-content" }}>⚠ {err}</div>}
        </>
      ) : (
        <Link href="/login?next=/review" className="btn btn-primary" style={{ marginTop: 14 }}>Sign in as staff</Link>
      )}
      <div style={{ marginTop: 14 }}>
        <Link href="/board" className="btn btn-outline">Back to the board</Link>
      </div>
    </div>
  );
}
