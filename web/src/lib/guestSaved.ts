"use client";
// Guest (signed-out) watchlist, kept private to this browser.
// Guests have no server identity, so their saves used to hit a shared global
// `rfq.saved` flag that leaked one visitor's bookmarks to everyone. Instead we
// hold the saved RFQ ids in localStorage; signed-in users still use the server
// per-user SaveItem. See components/BoardClient.tsx.

const KEY = "rc_saved";

export function getGuestSaved(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

export function toggleGuestSaved(id: number): boolean {
  const cur = new Set(getGuestSaved());
  const nowSaved = !cur.has(id);
  if (nowSaved) cur.add(id);
  else cur.delete(id);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...cur]));
  } catch {
    /* storage full / disabled — the in-memory toggle still applies for the session */
  }
  return nowSaved;
}
