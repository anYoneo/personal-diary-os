import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Page-level gate. API routes are NOT matched here — they authorize themselves
 * with requireUser() and return 401 JSON rather than a redirect, which is what
 * a fetch() caller needs. This proxy is convenience, not the security boundary.
 *
 * PUBLIC_PATHS is the complete list of pages reachable while signed out. Keep it
 * explicit: a new page is gated by default, so forgetting to think about access
 * fails closed rather than open.
 */
const PUBLIC_PATHS = new Set(["/login", "/register"]);
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/register"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authed = request.cookies.has("diary_session");

  const isPublic = PUBLIC_PATHS.has(pathname) || PUBLIC_API.has(pathname);

  if (!authed && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (authed && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|uploads).*)"],
};
