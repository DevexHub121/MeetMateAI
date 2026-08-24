import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

// Clears the session cookie and returns to the landing page. A route, not an
// action, so a plain link works from anywhere including the nav.
export async function GET(req: Request) {
  await destroySession();
  return NextResponse.redirect(new URL("/", req.url));
}
