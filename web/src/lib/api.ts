// Typed client for the RFQClub FastAPI backend.
// Base URL comes from NEXT_PUBLIC_API_BASE (see .env.local).
import { getToken } from "@/lib/session";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000").replace(/\/+$/, "");

export interface Budget {
  status: string;
  currency: string;
  low: number | null;
  high: number | null;
  low_display: string;
  high_display: string | null;
  range_display: string;
  per_unit: string;
}

export interface RfqTag {
  label: string;
  kind: string; // sector | process | material | cert
}

export interface RfqCard {
  id: number;
  code: string;
  title: string;
  sector: { key: string; label: string; base: string; soft: string };
  material: string;
  qty: number | null;
  unit: string;
  budget: Budget;
  est_total: number | null;
  est_total_display: string;
  closes_at: string | null;
  closes_in_days: number | null;
  urgency: "green" | "amber" | "red";
  is_open: boolean;
  bid_count: number;
  bids_received: number; // real bids-received (source interest) shown on the board
  quotes_shown: number;   // blinded quotes the compare can reveal (<= routing_cap)
  routing_cap: number;
  status: string;
  tags: RfqTag[];
  hub_city: string;
  saved: boolean;
  posted_days_ago: number | null;
}

export interface RfqDetail extends RfqCard {
  process: string;
  description: string;
  attachments: unknown[];
  clarify: string[];
  spec_notes: string;
  buyer_visible: boolean;
  buyer_note: string;
}

export interface BoardResponse {
  count: number;
  open_total: number;
  demand_total: number;
  demand_total_display: string;
  items: RfqCard[];
}

export interface BlindedBid {
  code: string;
  bid_id: number;
  unit_price: number;
  unit_price_display: string;
  tooling: number;
  freight: number;
  gst_included: boolean;
  lead_weeks: number | null;
  payment_terms: string;
  validity_days: number | null;
  exception_flag: boolean;
  exception_note: string;
  tlc_cents: number;
  tlc_rupees: number;
  tlc_display: string;
  per_unit_landed_display: string | null;
  hub_city: string;
  distance_km: number | null;
  capability_tags: string[];
  certifications: string[];
  verified: boolean;
  ribbon?: string | null;
  revealed_name?: string;
}

export interface BidsResponse {
  rfq: RfqCard;
  count: number;
  cap: number;
  locked: boolean;
  revealed: boolean;
  awarded_bid_id?: number | null;
  bids: BlindedBid[];
}

export interface BidPayload {
  supplier_name: string;
  hub_city: string;
  distance_km?: number | null;
  capability_tags?: string[];
  unit_price: number;
  tooling: number;
  freight: number;
  gst_included: boolean;
  lead_weeks?: number | null;
  payment_terms: string;
  validity_days?: number | null;
  exception_flag: boolean;
  exception_note?: string;
  notes?: string;
  source?: string;
}

async function req<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  // Client: auto-attach the signed-in bearer token. Server: pass `token` explicitly
  // (server components forward the rc_token cookie). Auth headers are read once here.
  const auth = token ?? (typeof window !== "undefined" ? getToken() : null);
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
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export interface BoardParams {
  sector?: string;
  q?: string;
  sort?: "deadline" | "value" | "bidcount";
  status?: string;
}

export function getBoard(params: BoardParams = {}, token?: string | null): Promise<BoardResponse> {
  const usp = new URLSearchParams();
  if (params.sector) usp.set("sector", params.sector);
  if (params.q) usp.set("q", params.q);
  if (params.sort) usp.set("sort", params.sort);
  if (params.status) usp.set("status", params.status);
  const qs = usp.toString();
  return req<BoardResponse>(`/api/rfqs${qs ? `?${qs}` : ""}`, undefined, token ?? null);
}

export function getRfq(id: number | string, token?: string | null): Promise<RfqDetail> {
  return req<RfqDetail>(`/api/rfqs/${id}`, undefined, token ?? null);
}

export function getBids(id: number | string, token?: string | null): Promise<BidsResponse> {
  return req<BidsResponse>(`/api/rfqs/${id}/bids`, undefined, token ?? null);
}

export function submitBid(id: number | string, payload: BidPayload): Promise<{ ok: boolean; bid_id: number; bidder_code: string; tlc_rupees: number; tlc_display: string }> {
  return req(`/api/rfqs/${id}/bid`, { method: "POST", body: JSON.stringify(payload) });
}

export function toggleSave(id: number | string): Promise<{ ok: boolean; saved: boolean }> {
  return req(`/api/rfqs/${id}/save`, { method: "POST" });
}

export function awardBid(id: number | string, bid_id: number): Promise<{ ok: boolean; rfq_id: number; awarded_bid_id: number; revealed_name: string; tlc_display: string }> {
  return req(`/api/rfqs/${id}/award`, { method: "POST", body: JSON.stringify({ bid_id }) });
}

export interface OrderMilestone {
  key: string;
  label: string;
  state: "pending" | "active" | "done";
}

export interface OrderState {
  exists: boolean;
  rfq?: RfqCard;
  awarded_bid_id?: number;
  supplier_name?: string;
  supplier_hub?: string;
  tlc_rupees?: number;
  tlc_display?: string;
  awarded_at?: string | null;
  escrow_status?: string;
  qc_status?: string;
  milestones?: OrderMilestone[];
  updated_at?: string | null;
}

// Buyer-side escrow / managed-QC / milestone tracker (only present post-award).
export function getRfqOrder(id: number | string, token?: string | null): Promise<OrderState> {
  return req(`/api/rfqs/${id}/order`, undefined, token ?? null);
}

export interface OrderUpdate {
  escrow_status?: string;
  qc_status?: string;
  milestone_key?: string;
  milestone_state?: string;
}

// Concierge/operator only: advance escrow, QC, or one milestone (422 on bad state).
export function updateRfqOrder(id: number | string, body: OrderUpdate, token?: string | null): Promise<OrderState & { ok: boolean }> {
  return req(`/api/operator/rfqs/${id}/order`, { method: "POST", body: JSON.stringify(body) }, token ?? null);
}

// ---- Profile (representative supplier record; block-based panels) ----
// Loosely typed to mirror api/profile_data.py — the client renders generically
// from block.type, so unknown extra fields are tolerated.
export interface ProfileField {
  label: string;
  value?: string;
  kind?: string; // input | select | textarea | password | disabled | phone
  hint?: string;
  req?: boolean;
  full?: boolean;
  placeholder?: string;
  options?: string[];
  prefix?: string;
}

export interface ProfileBlock {
  type: string;
  label?: string;
  full?: boolean;
  note?: string;
  fields?: ProfileField[];
  items?: Record<string, unknown>[];
  cols?: string[];
  rows?: Record<string, unknown>[][];
  stats?: { num: string; label: string }[];
  rows_v?: unknown[];
}

export interface ProfilePanel {
  title: string;
  sub: string;
  blocks: ProfileBlock[];
}

export interface Profile {
  identity: { logo: string; name: string; since: string; badge: string };
  percent: number;
  strength_note: string;
  missing: { label: string; pct: string; tab: string }[];
  tabs: { id: string; label: string; icon: string; count?: number }[];
  panels: Record<string, ProfilePanel>;
}

export function getProfile(): Promise<Profile> {
  return req<Profile>("/api/profile");
}

// ---- Auth (email + password, Google, email OTP) ----
export interface AuthUser {
  id: number;
  email: string;
  name?: string;
  role: string;
  has_password?: boolean; // whether this account has an email+password set
  last_login?: string | null; // stamped on the most recent successful sign-in
  created_at?: string | null;
}

export interface OtpRequestResult {
  ok: boolean;
  email: string;
  expires_in: number;
  delivery?: string; // "email" when the code was actually sent
  dev_code?: string; // demo fallback: code shown on screen because it wasn't emailed
  delivery_warning?: string; // why email delivery was skipped/failed (demo mode)
}

export interface VerifyResult {
  token: string;
  user: AuthUser;
  is_new?: boolean; // true for a freshly-created account (register / first Google sign-in)
}

// email + password
export function register(email: string, password: string, name?: string): Promise<VerifyResult> {
  return req("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, name: name ?? "" }) });
}

export function login(email: string, password: string): Promise<VerifyResult> {
  return req("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

// password reset (emails a link; dev_reset_token is surfaced in demo mode)
export interface ForgotResult {
  ok: boolean;
  expires_in: number;
  delivery?: string; // "email" when a reset link was actually sent
  dev_reset_token?: string; // demo fallback: the link the UI follows directly
  delivery_warning?: string;
}

export function forgotPassword(email: string): Promise<ForgotResult> {
  return req("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) });
}

export function resetPassword(token: string, password: string): Promise<VerifyResult> {
  return req("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) });
}

// change (or, for a Google/OTP-only account, set) the signed-in user's password
export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; user: AuthUser }> {
  return req("/api/auth/password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
}

// Google Identity Services ID token (the `credential` from Google's button)
export function googleSignIn(credential: string): Promise<VerifyResult> {
  return req("/api/auth/google", { method: "POST", body: JSON.stringify({ credential }) });
}

export function otpRequest(email: string): Promise<OtpRequestResult> {
  return req("/api/auth/otp/request", { method: "POST", body: JSON.stringify({ email }) });
}

export function otpVerify(email: string, code: string): Promise<VerifyResult> {
  return req("/api/auth/otp/verify", { method: "POST", body: JSON.stringify({ email, code }) });
}

export function authMe(): Promise<{ user: AuthUser }> {
  return req("/api/auth/me");
}

export function authSetRole(role: string): Promise<VerifyResult> {
  return req("/api/auth/role", { method: "POST", body: JSON.stringify({ role }) });
}

// ---- Signed-in user views (token: server components only) ----
export interface MyRfqsResponse {
  count: number;
  items: RfqCard[];
}

export interface MyBidItem {
  bid_id: number;
  bidder_code: string;
  rfq: RfqCard | null;
  tlc_rupees: number;
  tlc_display: string;
  unit_price: number;
  lead_weeks: number | null;
  status: "Won" | "Lost" | "Live" | "Closed";
  created_at: string | null;
}

export interface MyBidsResponse {
  count: number;
  items: MyBidItem[];
}

export function getMyRfqs(token?: string | null): Promise<MyRfqsResponse> {
  return req("/api/auth/my/rfqs", undefined, token ?? null);
}

export function getMyBids(token?: string | null): Promise<MyBidsResponse> {
  return req("/api/auth/my/bids", undefined, token ?? null);
}

// ---- Web intake ("Post an RFQ") + concierge review workflow ----
// The web form never posts straight to the board — it files a draft that a
// concierge must approve. Publishing therefore requires an operator account
// (see api/workflow.py + the operator-only /api/operator/* endpoints).
export interface IntakePayload {
  title: string;
  description?: string;
  process?: string;
  material?: string;
  qty?: number | null;
  unit?: string;
  budget_low?: number | null;
  budget_high?: number | null;
  closes_in_days?: number | null;
  sector_key?: string;
  hub_city?: string;
}

export interface Clarification {
  key: string; // qty | material | process | budget
  question: string;
}

export interface ClarifyAnswerRec {
  answer: string;
  raw: string;
  at: string;
  by: string;
}

export interface IntakeResult {
  ok: boolean;
  draft_id: number;
  status: string; // always "in_review"
  sector_label: string;
  clarify: string[];
  clarifications?: Clarification[];
}

export function intakeRfq(payload: IntakePayload): Promise<IntakeResult> {
  return req("/api/rfqs/intake", { method: "POST", body: JSON.stringify(payload) });
}

export interface SubmissionItem {
  draft_id: number;
  status: string; // PENDING | APPROVED | REJECTED
  source: string;
  created_at: string | null;
  reviewed_at: string | null;
  reject_reason: string;
  clarify: string[];
  clarify_count: number;
  can_clarify: boolean;
  answered: number;
  title: string;
  sector_label: string;
  budget_display: string;
  qty: number | null;
  unit: string;
  duplicate_of: { id: number; code: string; title: string } | null;
}

export interface SubmissionsResponse {
  count: number;
  items: SubmissionItem[];
}

export function getMySubmissions(token?: string | null): Promise<SubmissionsResponse> {
  return req("/api/auth/my/submissions", undefined, token ?? null);
}

// Serialized intake draft (mirrors workflow.draft_out).
export interface ReviewDraft {
  id: number;
  status: string;
  source: string;
  created_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string;
  reject_reason: string;
  raw_text: string;
  fields: {
    title: string; process: string; material: string;
    qty: number | null; unit: string; low: number | null; high: number | null;
    closes_in_days: number | null; sector_key: string; sector_label: string;
    description: string; notes: string; hub_city: string;
    clarify: string[]; clarifications: Clarification[];
    clarify_answers: Record<string, ClarifyAnswerRec>;
    budget_display: string;
  };
  confidence: Record<string, number>;
  low_confidence: string[];
  duplicate_of: { id: number; code: string; title: string } | null;
}

export interface ReviewQueue {
  pending: ReviewDraft[];
  recently_reviewed: ReviewDraft[];
  rfq_drafts: RfqCard[];
  counts: { pending: number; rfq_drafts: number; published: number };
}

export interface ReviewEdits {
  title?: string | null;
  process?: string | null;
  material?: string | null;
  qty?: number | null;
  unit?: string | null;
  low?: number | null;
  high?: number | null;
  closes_in_days?: number | null;
  sector_key?: string | null;
  description?: string | null;
  notes?: string | null;
  hub_city?: string | null;
}

export function getOperatorQueue(reviewed = 8, token?: string | null): Promise<ReviewQueue> {
  return req<ReviewQueue>(`/api/operator/queue?reviewed=${reviewed}`, undefined, token ?? null);
}

export function approveDraft(draftId: number, body: { edits?: ReviewEdits; publish?: boolean; force?: boolean }): Promise<{ ok: boolean; draft_id: number; status: string; rfq: RfqCard }> {
  return req(`/api/operator/drafts/${draftId}/approve`, { method: "POST", body: JSON.stringify(body) });
}

export function rejectDraft(draftId: number, reason: string): Promise<{ ok: boolean; draft_id: number; status: string }> {
  return req(`/api/operator/drafts/${draftId}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function setRfqStatus(rfqId: number, status: "published" | "draft" | "closed"): Promise<{ ok: boolean; rfq: RfqCard; status: string }> {
  return req(`/api/operator/rfqs/${rfqId}/status`, { method: "POST", body: JSON.stringify({ status }) });
}

// Paste a BnS page-extract; each entry is filed as a concierge-review draft
// (never straight to the board). Duplicates of live/queued items are skipped.
export interface BnsImportResult {
  ok: boolean;
  parsed: number;
  dry_run: boolean;
  created: number[] | string[];
  created_count: number;
  skipped_duplicate_live: string[];
  skipped_duplicate_pending: string[];
}

export function importBns(text: string, dryRun = false): Promise<BnsImportResult> {
  return req<BnsImportResult>("/api/operator/import/bns", { method: "POST", body: JSON.stringify({ text, dry_run: dryRun }) });
}

// ---- buyer-side clarify loop (owner of an intake draft) ----
export function getIntakeDraft(draftId: number, token?: string | null): Promise<{ ok: boolean; draft: ReviewDraft }> {
  return req(`/api/rfqs/intake/${draftId}`, undefined, token ?? null);
}

export function answerClarify(draftId: number, answers: Record<string, string>): Promise<{ ok: boolean; draft: ReviewDraft }> {
  return req(`/api/rfqs/intake/${draftId}/clarify`, { method: "POST", body: JSON.stringify({ answers }) });
}
