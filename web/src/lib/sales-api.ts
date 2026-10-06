// Typed client for the inside-sales "internal" API (/api/sales/*).
// Mirrors lib/api.ts's bearer-token plumbing, but scoped to the lead system.
// Every call is server-gated by require_sales, so a non-allowlisted token 403s
// here exactly as it does at the route — the client never has to "trust" itself.
import { getToken } from "@/lib/session";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000").replace(/\/+$/, "");

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = typeof window !== "undefined" ? getToken() : null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

// ---- types (mirror sales_api.py serialization) ----
export type SalesView = "mine" | "unassigned" | "followups" | "all" | "excluded";

export interface StatusMeta { key: string; label: string; }
export interface SalesMeta {
  statuses: StatusMeta[];
  funnel_order: string[];
  stepper: StatusMeta[];
  tracks: string[];
  activity_kinds: string[];
  activity_outcomes: string[];
  views: string[];
}

export interface FunnelTile { key: string; label: string; count: number; }
export interface LeaderRow { owner_email: string; total: number; contacted: number; in_conversation: number; onboarded: number; }
export interface Summary {
  funnel: FunnelTile[];
  tiles: Record<string, number>;
  leaderboard?: LeaderRow[];
}

export interface LeadRow {
  id: number; track: string; status: string; status_label: string;
  company_id: number; company: string; hub_city: string; category_label: string;
  size_band: string; priority_rank: number | null; priority_score: number | null;
  owner_email: string; next_action_at: string | null; next_action_note: string;
  followup_count: number; last_contacted_at: string | null; reachable: boolean;
  excluded_from_sales: boolean; exclusion_reason: string; source: string;
}
export interface LeadsResponse { total: number; offset: number; limit: number; items: LeadRow[]; }

export interface Company {
  id: number; name: string; legal_name: string; website: string; gmb_link: string;
  linkedin_url: string; hub_city: string; country: string; address: string;
  what_they_do: string; size_band: string; cin: string; gst: string;
  category_primary: string; category_tags: string[]; category_tier: number;
  adjacency: { from_label: string; to_label: string; why: string }[];
  review_count: number | null; review_rating: number | null;
  source_system: string; source_note: string;
}
export interface Contact {
  id: number; full_name: string; designation: string; decision_maker: boolean;
  email: string; phone_primary: string; phone_secondary: string; whatsapp: string;
  preferred_channel: string; is_primary: boolean; do_not_call: boolean;
}
export interface Activity {
  id: number; kind: string; direction: string; outcome: string; summary: string;
  pain_point: string; objection: string; competitor: string; duration_seconds: number | null;
  contact_id: number | null; by_email: string; created_at: string | null;
}
export interface Task {
  id: number; title: string; due_at: string | null; status: string; overdue: boolean; completed_at: string | null;
}
export interface HistoryRow {
  id: number; from_status: string; to_status: string; from_label: string; to_label: string;
  note: string; by_email: string; changed_at: string | null;
}
export interface Script {
  name: string; version: number; opener: string[]; pitch: string;
  discovery_questions: string[]; qualification_checklist: string[];
  objection_handling: Record<string, string>; cta: string; do_not_say: string;
}
export interface LeadDetail extends Omit<LeadRow, "company"> {
  // the detail payload replaces the row's `company` name-string with the full object
  company: Company; contacts: Contact[]; activities: Activity[]; tasks: Task[];
  history: HistoryRow[]; script: Script | null; qualified_at: string | null;
  disqualify_reason: string; nurture_until: string | null; source_note: string;
}

export interface LeadQuery {
  view?: SalesView; status?: string; track?: string; category?: string;
  hub_city?: string; owner_email?: string; q?: string; sort?: string; limit?: number; offset?: number;
  contacted?: string; callable?: string;
}
function qs(p: LeadQuery): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") usp.set(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const getMeta = () => req<SalesMeta>("/api/sales/meta");
export const getSummary = () => req<Summary>("/api/sales/summary");
export const getLeads = (p: LeadQuery = {}) => req<LeadsResponse>(`/api/sales/leads${qs(p)}`);
export const getLead = (id: number | string) => req<LeadDetail>(`/api/sales/leads/${id}`);

export const setStatus = (id: number, status: string, note = "") =>
  req<{ ok: boolean; status: string; status_label: string }>(`/api/sales/leads/${id}/status`,
    { method: "POST", body: JSON.stringify({ status, note }) });

export interface ActivityIn {
  kind: string; outcome?: string; direction?: string; summary?: string; pain_point?: string;
  objection?: string; competitor?: string; contact_id?: number | null; duration_seconds?: number | null;
  next_action_at?: string | null; next_action_note?: string; set_status?: string | null;
}
export const addActivity = (id: number, body: ActivityIn) =>
  req<{ ok: boolean; activity_id: number; status: string; next_action_at: string | null }>(
    `/api/sales/leads/${id}/activity`, { method: "POST", body: JSON.stringify(body) });

export const addTask = (id: number, body: { title: string; due_at?: string | null; assigned_to_email?: string | null }) =>
  req<{ ok: boolean; task: Task }>(`/api/sales/leads/${id}/task`, { method: "POST", body: JSON.stringify(body) });
export const completeTask = (taskId: number) =>
  req<{ ok: boolean; task: Task }>(`/api/sales/tasks/${taskId}/complete`, { method: "POST" });

export const setNextStep = (id: number, body: { next_action_at: string | null; next_action_note: string }) =>
  req<{ ok: boolean }>(`/api/sales/leads/${id}/next-step`, { method: "POST", body: JSON.stringify(body) });

// owner_email omitted => claim to self; "" => unassign (mgr); other => mgr assign.
export const assignLeads = (lead_ids: number[], owner_email?: string | null) =>
  req<{ ok: boolean; assigned: number }>(`/api/sales/leads/assign`,
    { method: "POST", body: JSON.stringify(owner_email === undefined ? { lead_ids } : { lead_ids, owner_email }) });

// CSV download (manager only). Returns a filename + blob for the caller to save.
export async function exportCsv(p: { view?: SalesView; status?: string; track?: string; category?: string } = {}): Promise<Blob> {
  const auth = typeof window !== "undefined" ? getToken() : null;
  const res = await fetch(`${API_BASE}/api/sales/export${qs(p as LeadQuery)}`, {
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, cache: "no-store",
  });
  if (!res.ok) { let d = `${res.status}`; try { d = (await res.json()).detail || d; } catch { /* */ } throw new Error(d); }
  return res.blob();
}

// ---------------------------------------------------------------------------
// Team & access (manager-only) — mirror the /api/sales/team/* endpoints.
// The whole area is DB-managed: only accounts created here can enter, and every
// password set/change routes through a confirmation popup in the UI first.
// ---------------------------------------------------------------------------
export interface TeamUser {
  id: number; email: string; name: string;
  role: string;                        // sales | sales_manager
  is_active: boolean;
  must_change_password: boolean;       // true until they rotate a temp password
  is_console_admin: boolean;           // owner row: allowlisted, role/status frozen
  last_login: string | null; created_at: string | null;
}
export interface TeamList { count: number; items: TeamUser[]; }

export const getTeam = () => req<TeamList>("/api/sales/team");

export const createTeamUser = (body: { email: string; name?: string; password: string; role?: string }) =>
  req<{ ok: boolean; user: TeamUser }>("/api/sales/team/user",
    { method: "POST", body: JSON.stringify({ name: "", role: "sales", ...body }) });

// Manager sets/resets a member's password; for anyone but themselves the account
// is flagged must-change so they rotate it on first sign-in.
export const resetTeamPassword = (email: string, password: string) =>
  req<{ ok: boolean; email: string; must_change_password: boolean }>("/api/sales/team/password",
    { method: "POST", body: JSON.stringify({ email, password }) });

export const setTeamActive = (email: string, is_active: boolean) =>
  req<{ ok: boolean; user: TeamUser }>("/api/sales/team/status",
    { method: "POST", body: JSON.stringify({ email, is_active }) });

export const setTeamRole = (email: string, role: string) =>
  req<{ ok: boolean; user: TeamUser }>("/api/sales/team/role",
    { method: "POST", body: JSON.stringify({ email, role }) });
