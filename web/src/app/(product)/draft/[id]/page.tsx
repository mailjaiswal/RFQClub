import Link from "next/link";
import { getIntakeDraft } from "@/lib/api";
import { reqToken } from "@/lib/server-token";
import ClarifyForm from "@/components/ClarifyForm";

export const dynamic = "force-dynamic";

// The buyer-side "add the missing details" page for one of their own intake
// drafts. The API enforces ownership (404 otherwise) and the PENDING gate, so
// a stale or someone-else's id simply renders the friendly not-found card.
export default async function DraftClarifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draftId = Number(id);
  let draft = null;
  let denied = "";
  if (Number.isInteger(draftId) && draftId > 0) {
    try {
      const res = await getIntakeDraft(draftId, await reqToken());
      draft = res.draft;
    } catch (err) {
      denied = err instanceof Error ? err.message : "We couldn't load that draft.";
    }
  } else {
    denied = "We couldn't find that draft.";
  }

  return (
    <>
      <div className="ap-subbar">
        <Link href="/my-rfqs" className="ap-back">← My RFQs</Link>
      </div>

      <div className="ap-detail">
        {draft ? (
          <ClarifyForm initial={draft} />
        ) : (
          <div className="surface-card" style={{ padding: 28, textAlign: "center" }}>
            <div className="display" style={{ fontSize: 20 }}>Nothing to clarify here</div>
            <p className="muted" style={{ marginTop: 8 }}>
              {denied} It may already be decided, or it isn&apos;t a draft on your account.
            </p>
            <Link href="/my-rfqs" className="btn btn-primary" style={{ marginTop: 14 }}>Back to my RFQs</Link>
          </div>
        )}
      </div>
    </>
  );
}
