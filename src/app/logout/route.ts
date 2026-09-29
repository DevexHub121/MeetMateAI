import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { siteUrl } from "@/lib/url";

// Clears the session cookie and returns to the landing page. A route, not an
// action, so a plain link works from anywhere including the nav.
export async function GET(req: Request) {
  await destroySession();
  // Not new URL("/", req.url): behind the platform's proxy that resolves to the
  // internal address, which sent people to localhost:8080 on sign-out.
  return NextResponse.redirect(siteUrl(req, "/"));
}
