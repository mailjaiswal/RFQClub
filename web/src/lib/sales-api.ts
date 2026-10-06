// Typed client for the inside-sales "internal" API (/api/sales/*).
// Mirrors lib/api.ts's bearer-token plumbing, but scoped to the lead system.
// Every call is server-gated by require_sales, so a non-allowlisted token 403s
// here exactly as it does at the route — the client never has to "trust" itself.
import { getToken } from "@/lib/session";
import { cacheKeys, markStale, patch, peek, put, refresh } from "@/lib/cache";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000").replace(/\/+$/, "");

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = typeof window !== "undefined" ? getToken() : null;
  const actAs = typeof window !== "undefined" ? localStorage.getItem("rfqclub_act_as") || "" : "";
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(actAs ? { "X-Act-As": actAs } : {}),
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
  categories?: StatusMeta[];
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
  hub_city?: string; owner_email?: string; q?: string; sort?: string; dir?: string;
  limit?: number; offset?: number;
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
  const actAs = typeof window !== "undefined" ? localStorage.getItem("rfqclub_act_as") || "" : "";
  const res = await fetch(`${API_BASE}/api/sales/export${qs(p as LeadQuery)}`, {
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(actAs ? { "X-Act-As": actAs } : {}) }, cache: "no-store",
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

// ---------------------------------------------------------------------------
// Reports — time-period activity aggregation
// ---------------------------------------------------------------------------
export interface ReportSummary {
  total_activities: number;
  total_status_changes: number;
  tasks_completed: number;
  unique_leads_contacted: number;
}
export interface TeamBreakRow {
  owner_email: string;
  activities: number;
  status_changes: number;
  tasks_completed: number;
}
export interface ReportData {
  period: { from: string; to: string };
  owner_email: string;
  summary: ReportSummary;
  activities_by_kind: Record<string, number>;
  status_changes: Record<string, number>;
  current_pipeline: Record<string, number>;
  team_breakdown?: TeamBreakRow[];
}
export const getReports = (p: { from?: string; to?: string; owner_email?: string } = {}) => {
  const usp = new URLSearchParams();
  if (p.from) usp.set("from", p.from);
  if (p.to) usp.set("to", p.to);
  if (p.owner_email) usp.set("owner_email", p.owner_email);
  const s = usp.toString();
  return req<ReportData>(`/api/sales/reports${s ? `?${s}` : ""}`);
};

// ---------------------------------------------------------------------------
// Cache keys + write-through helpers (see lib/cache.ts)
//
// Keys carry the impersonation scope, so an owner's "View As" data can never
// bleed into their own cached screens. Switching scope reloads the page, which
// also clears the in-memory store.
// ---------------------------------------------------------------------------
const LEADS_PREFIX = "leads:";
function scopeTag(): string {
  const actAs = typeof window !== "undefined" ? localStorage.getItem("rfqclub_act_as") || "" : "";
  return actAs ? `@${actAs}` : "";
}
export const queueKey = (p: LeadQuery): string => {
  const parts = [p.view || "mine", p.status || "", p.track || "", p.category || "", p.contacted || "",
    p.callable || "", p.owner_email || "", p.sort || "", p.dir || "", (p.q || "").trim(),
    String(p.offset ?? 0), String(p.limit ?? 100)];
  return `${LEADS_PREFIX}${scopeTag()}|${parts.join("|")}`;
};
export const detailKey = (id: number | string) => `lead:${scopeTag()}|${id}`;
export const rowKey = (id: number | string) => `leadrow:${scopeTag()}|${id}`;
export const summaryCacheKey = () => `summary:${scopeTag()}`;
export const teamCacheKey = () => `team:${scopeTag()}`;
export const reportsCacheKey = (from: string, to: string, owner: string) =>
  `reports:${scopeTag()}|${from}|${to}|${owner || "me"}`;

/** Stash the queue's rows so a click can paint the lead header from them instantly. */
export function rememberRows(items: LeadRow[]) {
  for (const r of items) put(rowKey(r.id), r);
}

/** Drop keys whose value is `undefined` so a partial write can never blank out a
 *  field the caller didn't actually change. */
function defined<T extends object>(p: T): Partial<T> {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Apply a field change to every cached queue page that shows this lead. */
export function patchRows(id: number, p: Partial<LeadRow>) {
  const clean = defined(p);
  if (!Object.keys(clean).length) return;
  for (const key of cacheKeys(LEADS_PREFIX)) {
    patch<LeadsResponse>(key, (cur) => ({ ...cur, items: cur.items.map((r) => (r.id === id ? { ...r, ...clean } : r)) }));
  }
}

/** Remove a lead from every cached queue — it has left those views entirely. */
export function dropRows(id: number) {
  for (const key of cacheKeys(LEADS_PREFIX)) {
    patch<LeadsResponse>(key, (cur) => (cur.items.some((r) => r.id === id)
      ? { ...cur, total: Math.max(0, cur.total - 1), items: cur.items.filter((r) => r.id !== id) }
      : cur));
  }
}

/** A write happened somewhere: the next queue mount must revalidate. */
export function markQueuesStale() {
  markStale(LEADS_PREFIX);
}

/** Apply a field change to the cached detail record (and mark counts dirty). */
export function patchDetail(id: number, p: Partial<LeadDetail>) {
  const clean = defined(p);
  if (Object.keys(clean).length) patch<LeadDetail>(detailKey(id), (cur) => ({ ...cur, ...clean }));
  markStale(`summary:${scopeTag()}`);
}

/** Functional edit of the cached detail — for lists (activities, tasks) that a
 *  write appends to and that the server will confirm on revalidate. */
export function mutateDetail(id: number, fn: (cur: LeadDetail) => LeadDetail) {
  patch<LeadDetail>(detailKey(id), fn);
  markStale(`summary:${scopeTag()}`);
}

/** Read the row snapshot for a lead (used for the instant header on deep links). */
export const peekRow = (id: number | string) => peek<LeadRow>(rowKey(id));

/** Warm the detail cache ahead of a click (hover / focus). Safe to repeat. */
export function prefetchLead(id: number) {
  if (peek<LeadDetail>(detailKey(id)) !== undefined) return;
  refresh(detailKey(id), () => getLead(id)).catch(() => { /* best effort */ });
}
