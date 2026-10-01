import PostForm from "@/components/PostForm";

export const metadata = { title: "Post an RFQ — RFQClub" };

// Gated by middleware (requires a signed-in member). The form files a review
// draft; publishing still requires a concierge (see /review).
export default function PostPage() {
  return (
    <>
      <div className="ap-subbar">
        <span className="code" style={{ marginLeft: 0 }}>Post an RFQ</span>
        <span className="code">Reviewed before it goes live</span>
      </div>
      <div className="ap-detail">
        <div className="mr-head">
          <h1>Tell us what you need made</h1>
          <p>Send the requirement in your own words. A concierge structures it, checks it, and publishes it to a
            capped set of verified suppliers — nothing reaches the board unreviewed.</p>
        </div>
        <div style={{ marginTop: 8 }}>
          <PostForm />
        </div>
      </div>
    </>
  );
}
