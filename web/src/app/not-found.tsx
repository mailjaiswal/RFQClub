import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20" style={{ textAlign: "center" }}>
      <div className="display" style={{ fontSize: 30 }}>Not found</div>
      <p className="muted" style={{ marginTop: 8 }}>That RFQ doesn't exist or isn't published.</p>
      <Link href="/" className="btn btn-primary" style={{ marginTop: 16, display: "inline-flex" }}>Back to the board</Link>
    </div>
  );
}
