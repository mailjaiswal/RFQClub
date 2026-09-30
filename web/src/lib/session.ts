// Client-side session store for the RFQClub demo auth (email OTP).
// The bearer token lives in localStorage and is mirrored to a readable
// cookie (rc_token) so Next server components can forward it as an
// Authorization header. This is a demo mechanism by design.

const TOKEN_KEY = "rc_token";
const USER_KEY = "rc_user";

export type SessionUser = { id: number; email: string; role: string };

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: SessionUser) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  // 7 days, matching the server token TTL; SameSite=Lax is fine (never used for cross-site POSTs)
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${7 * 86400}; samesite=lax`;
  window.dispatchEvent(new Event("rc:session"));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`;
  window.dispatchEvent(new Event("rc:session"));
}

// Cookie name mirrored for server components (read via next/headers there).
export const TOKEN_COOKIE = TOKEN_KEY;
