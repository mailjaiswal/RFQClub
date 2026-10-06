"use client";
// Tiny shared bits for the internal pages: status pill styling, date formatting,
// and the touchpoint/status label maps that mirror the server's controlled
// vocabularies.

const STATUS_CLASS: Record<string, string> = {
  uncontacted: "st-uncontacted",
  attempted_no_reply: "st-potential",
  connected: "st-conversation",
  qualified: "st-conversation",
  onboarding: "st-onboarding",
  onboarded: "st-onboarded",
  not_interested: "st-declined",
  nurture: "st-hold",
  incorrect: "st-dead",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`in-pill ${STATUS_CLASS[status] || ""}`}>{label || status}</span>;
}

export function fmtDate(iso: string | null, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  if (!withTime) return date;
  return `${date} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function relTime(iso: string | null): { text: string; overdue: boolean } {
  if (!iso) return { text: "—", overdue: false };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { text: "—", overdue: false };
  const diff = d.getTime() - Date.now();
  const days = Math.round(diff / 86_400_000);
  const overdue = diff < 0;
  let text: string;
  if (days === 0) text = "today";
  else if (days === 1) text = "tomorrow";
  else if (days === -1) text = "yesterday";
  else text = `${Math.abs(days)}d ${overdue ? "ago" : ""}`.trim();
  return { text, overdue };
}

export const KIND_ICON: Record<string, string> = {
  call: "☎", whatsapp: "✆", email: "✉", meeting: "▤", note: "✎", voicemail: "☏",
};
