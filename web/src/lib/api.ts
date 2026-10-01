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

// ---- Auth (email OTP, mock delivery) ----
export interface AuthUser {
  id: number;
  email: string;
  name?: string;
  role: string;
  created_at?: string | null;
}

export interface OtpRequestResult {
  ok: boolean;
  email: string;
  expires_in: number;
  dev_code?: string; // present in demo mode: code shown on screen instead of emailed
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
