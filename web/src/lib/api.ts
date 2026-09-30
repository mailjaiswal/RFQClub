// Typed client for the RFQClub FastAPI backend.
// Base URL comes from NEXT_PUBLIC_API_BASE (see .env.local).

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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
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
}

export function getBoard(params: BoardParams = {}): Promise<BoardResponse> {
  const usp = new URLSearchParams();
  if (params.sector) usp.set("sector", params.sector);
  if (params.q) usp.set("q", params.q);
  if (params.sort) usp.set("sort", params.sort);
  const qs = usp.toString();
  return req<BoardResponse>(`/api/rfqs${qs ? `?${qs}` : ""}`);
}

export function getRfq(id: number | string): Promise<RfqDetail> {
  return req<RfqDetail>(`/api/rfqs/${id}`);
}

export function getBids(id: number | string): Promise<BidsResponse> {
  return req<BidsResponse>(`/api/rfqs/${id}/bids`);
}

export function submitBid(id: number | string, payload: BidPayload): Promise<{ ok: boolean; bid_id: number; bidder_code: string; tlc_rupees: number; tlc_display: string }> {
  return req(`/api/rfqs/${id}/bid`, { method: "POST", body: JSON.stringify(payload) });
}
