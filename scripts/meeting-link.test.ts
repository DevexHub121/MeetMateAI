/**
 * Which links the note-taker will accept, and what it warns about.
 *
 *   node --test scripts/meeting-link.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectPlatform,
  isMeetingLink,
  meetingLinkWarning,
  normalizeMeetingUrl,
  platformName,
} from "../src/lib/meetingLink.ts";

const TEAMS_LONG =
  "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NTg3ZTk%40thread.v2/0?context=%7B%22Tid%22%3A%22abc%22%2C%22Oid%22%3A%22def%22%7D";
const TEAMS_SHORT = "https://teams.microsoft.com/meet/839571234?p=xyz";

test("both shapes of Teams link Microsoft hands out are accepted", () => {
  assert.equal(detectPlatform(TEAMS_LONG), "microsoft_teams");
  assert.equal(detectPlatform(TEAMS_SHORT), "microsoft_teams");
  assert.equal(platformName(TEAMS_LONG), "Microsoft Teams");
});

test("consumer and government Teams domains count too", () => {
  assert.equal(detectPlatform("https://teams.live.com/meet/93812"), "microsoft_teams");
  assert.equal(
    detectPlatform("https://teams.microsoft.us/l/meetup-join/19%3ameeting_x%40thread.v2/0"),
    "microsoft_teams",
  );
});

test("the escaping and ?context= survive normalisation", () => {
  // Both are load-bearing: Recall gets this string verbatim, and a Teams join
  // fails without the thread id still escaped or without the tenant context.
  const out = normalizeMeetingUrl(TEAMS_LONG);
  assert.ok(out?.includes("19%3ameeting_NTg3ZTk%40thread.v2"), out ?? "null");
  assert.ok(out?.includes("context="), out ?? "null");
});

test("a Teams lookalike is not a Teams link", () => {
  assert.equal(isMeetingLink("https://teams.microsoft.com.evil.com/l/meetup-join/19%3ax"), false);
  assert.equal(isMeetingLink("https://notteams.microsoft.com/meet/1"), false);
});

test("a bare Teams host is a product, not a meeting", () => {
  assert.equal(isMeetingLink("https://teams.microsoft.com"), false);
  assert.equal(isMeetingLink("https://teams.microsoft.com/"), false);
});

test("Outlook Safe Links are unwrapped, because that is how Teams links arrive", () => {
  const wrapped =
    "https://nam12.safelinks.protection.outlook.com/?url=" +
    encodeURIComponent(TEAMS_SHORT) +
    "&data=05%7C01%7C&sdata=x&reserved=0";
  assert.equal(detectPlatform(wrapped), "microsoft_teams");
  assert.equal(normalizeMeetingUrl(wrapped), TEAMS_SHORT);
});

test("a Safe Link wrapping something else is still rejected", () => {
  // Unwrapping must not become a way past the allowlist.
  const wrapped =
    "https://nam12.safelinks.protection.outlook.com/?url=" +
    encodeURIComponent("https://evil.com/steal");
  assert.equal(isMeetingLink(wrapped), false);
});

test("Teams always warns about the lobby", () => {
  // Unlike the Zoom passcode this is not visible in the URL, so it shows every
  // time — the bot waits outside until a human admits it.
  assert.match(meetingLinkWarning(TEAMS_LONG) ?? "", /lobby/i);
  assert.match(meetingLinkWarning(TEAMS_SHORT) ?? "", /lobby/i);
});

test("adding Teams did not disturb Google Meet or Zoom", () => {
  assert.equal(detectPlatform("https://meet.google.com/abc-defg-hij"), "google_meet");
  assert.equal(detectPlatform("https://us02web.zoom.us/j/123"), "zoom");
  assert.equal(detectPlatform("https://zoom.us.evil.com/j/123"), null);
  assert.equal(meetingLinkWarning("https://zoom.us/j/123?pwd=secret"), null);
  assert.match(meetingLinkWarning("https://zoom.us/j/123") ?? "", /passcode/i);
  assert.equal(meetingLinkWarning("https://meet.google.com/abc-defg-hij"), null);
});
