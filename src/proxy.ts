import { NextRequest, NextResponse } from "next/server";

// Surface the requested path to server components (Next doesn't expose it via
// headers() by default). `requireUser()` reads `x-pathname` to build an exact
// `returnTo` when bouncing an unauthenticated visitor to the portal login.
// (Next 16 renamed the "middleware" convention to "proxy".)
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Run on app pages only — skip static assets, image optimization, and the
  // recording API (which does its own access control).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
