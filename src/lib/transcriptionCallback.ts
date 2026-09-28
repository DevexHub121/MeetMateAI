import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signing for the Deepgram callback URL.
 *
 * The callback is a public endpoint that writes a meeting's transcript, so the
 * meeting id travelling in the query string cannot be the only thing
 * authorising the write — anyone could POST a transcript over anyone's meeting.
 * The id is signed with AUTH_SECRET, using the same b64url + HMAC-SHA256 scheme
 * the Orbit session cookie uses (see lib/auth.ts), so a URL we did not mint is
 * rejected before the body is even read.
 *
 * Deliberately not Deepgram's own signature: we control the URL, we know what we
 * put in it, and this needs no shared secret with them.
 */

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

export function signMeetingId(meetingId: string): string {
  return b64url(createHmac("sha256", secret()).update(meetingId).digest());
}

export function verifyMeetingId(meetingId: string, token: string): boolean {
  const expected = Buffer.from(signMeetingId(meetingId));
  const got = Buffer.from(token);
  // Length check first: timingSafeEqual throws rather than returning false when
  // the buffers differ in length.
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/**
 * The absolute URL Deepgram should POST results to, or null when this
 * deployment has no publicly reachable address for it to reach.
 *
 * Null is the signal to stay on the synchronous path — which is what happens in
 * local development, where nothing outside the machine can call back.
 */
export function callbackUrlFor(meetingId: string): string | null {
  const base = process.env.APP_URL?.trim();
  if (!base) return null;
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    return null;
  }
  if (origin.hostname === "localhost" || origin.hostname === "127.0.0.1") {
    return null;
  }
  const url = new URL("/api/deepgram/callback", origin);
  url.searchParams.set("meetingId", meetingId);
  url.searchParams.set("token", signMeetingId(meetingId));
  return url.toString();
}
