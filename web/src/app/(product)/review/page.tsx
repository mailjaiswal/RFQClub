import { getOperatorQueue } from "@/lib/api";
import { reqToken } from "@/lib/server-token";
import ReviewClient from "@/components/ReviewClient";
import ClaimConcierge from "@/components/ClaimConcierge";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const token = await reqToken();
  let queue = null;
  let denied = "";
  try {
    queue = await getOperatorQueue(8, token);
  } catch (err) {
    denied = err instanceof Error ? err.message : "Not available.";
  }

  if (queue) return <ReviewClient initial={queue} />;

  // Signed-in but not an operator (or token rejected). Offer the staff claim —
  // the backend enforces OPERATOR_EMAILS, so this only works where it should.
  return (
    <>
      <div className="ap-subbar">
        <span className="code" style={{ marginLeft: 0 }}>Concierge review</span>
      </div>
      <div className="ap-detail">
        <ClaimConcierge message={denied} />
      </div>
    </>
  );
}
