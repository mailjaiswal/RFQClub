// Route guard for the RFQClub app. The RFQ board and all product pages are
// for signed-in members only; unauthenticated visitors are redirected to the
// login page (which returns them to their intended path afterwards). Presence
// of the mirrored `rc_token` cookie (set on login, cleared on logout — see
// lib/session.ts) is treated as "signed in". Token *validity* is enforced by
// the API on every data call; this is the visibility gate.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get("rc_token")?.value;

  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Only these app routes are protected. Public: / (landing), /login,
// /how-it-works, /api (Vercel rewrites), and all static assets.
// (/review is additionally operator-only, /draft owner-only — both enforced by
// the API, not here; middleware is just the sign-in visibility gate.)
// /console (the inside-sales area) additionally requires a sales role: the
// in-app guard and the /api/sales/* server gate enforce that — middleware only
// makes sure an anonymous visitor is bounced to sign-in first, so the shell is
// never even rendered for a logged-out user.
export const config = {
  matcher: ["/rfq/:path*", "/bid/:path*", "/my-rfqs/:path*", "/post/:path*", "/review/:path*", "/draft/:path*", "/console/:path*"],
};
