/**
 * Meeting-link handling for every platform the note-taker can join, in one place.
 *
 * Deliberately NOT server-only: the same rule has to run in the browser (to
 * decide whether a "Start meeting" button is clickable) and on the server (to
 * decide whether the action runs). Those two used to be separate copies, and a
 * disagreement between them is close to invisible — the symptom is a button that
 * stays dead, or one that fails the moment it's pressed, with nothing in either
 * place looking wrong on its own.
 *
 * The original bug was exactly that. The client's test was
 *
 *     /(^|\.)meet\.google\.com/i.test(link)
 *
 * run against the whole string, which demands that "meet.google.com" sit at the
 * very start or straight after a dot. In "https://meet.google.com/abc" it comes
 * after a slash, so the pattern failed on the exact URL Google hands out — and
 * since the input is type="url", the only spellings it did accept were ones the
 * browser then refused to submit. The button could never be enabled.
 *
 * The fix is to parse and test the *hostname*, and to have one definition that
 * both sides import so they cannot drift apart again. Adding Zoom is why that
 * mattered a second time: one host table, and every gate in the app widened at
 * once rather than four regexes drifting apart.
 */

export type MeetingPlatform = "google_meet" | "zoom";

/** Human name for a platform, for buttons, errors and banners. */
export const PLATFORM_NAMES: Record<MeetingPlatform, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
};

/**
 * Hostnames we recognise, and what they are.
 *
 * Matched against the parsed hostname and anchored at both ends, so a subdomain
 * counts ("us02web.zoom.us", "acme.zoom.us" — Zoom gives every account its own)
 * but a lookalike does not: "zoom.us.evil.com" fails, and so does "notzoom.us".
 *
 * zoomgov.com is Zoom's US-government deployment. It's a genuinely different
 * domain rather than a subdomain, which is why it needs its own line.
 */
const HOSTS: ReadonlyArray<{ platform: MeetingPlatform; host: RegExp }> = [
  { platform: "google_meet", host: /(^|\.)meet\.google\.com$/i },
  { platform: "zoom", host: /(^|\.)zoom\.us$/i },
  { platform: "zoom", host: /(^|\.)zoomgov\.com$/i },
];

type ParsedLink = { platform: MeetingPlatform; url: URL };

/**
 * Parse a meeting link, tolerating the missing scheme people leave off when they
 * paste out of a chat message. Returns null if it isn't a link we can send a bot to.
 *
 * A bare host with no path is rejected: "zoom.us" and "meet.google.com" identify
 * a product, not a meeting, and dispatching a bot at one wastes a real join
 * attempt to learn what we could have known here.
 */
function parseMeetingUrl(raw: string): ParsedLink | null {
  const link = raw.trim();
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
  } catch {
    return null;
  }
  if (url.pathname === "/" || url.pathname === "") return null;
  const match = HOSTS.find((h) => h.host.test(url.hostname));
  return match ? { platform: match.platform, url } : null;
}

/** Which platform is this link for, or null if it isn't one we support. */
export function detectPlatform(raw: string | null): MeetingPlatform | null {
  return raw ? (parseMeetingUrl(raw)?.platform ?? null) : null;
}

/** The platform's display name for a stored link ("Google Meet", "Zoom"). */
export function platformName(raw: string | null): string {
  const platform = detectPlatform(raw);
  return platform ? PLATFORM_NAMES[platform] : "meeting";
}

/** Does this look like a meeting link we can send the note-taker to? Gates the UI. */
export function isMeetingLink(raw: string): boolean {
  return parseMeetingUrl(raw) !== null;
}

/**
 * The canonical absolute URL for a meeting link, or null if it isn't one.
 *
 * Validating and normalising in one step is the point. Doing them separately is
 * how the original bug survived a round of review: the check passed on a string
 * that was then stored and dispatched unchanged. Recall needs a real URL, so the
 * value we persist and send has to be the parsed one, not whatever was typed.
 *
 * The query string survives, which for Zoom is load-bearing rather than tidy —
 * the passcode rides in `?pwd=` and the bot cannot join without it.
 */
export function normalizeMeetingUrl(raw: string): string | null {
  return parseMeetingUrl(raw)?.url.toString() ?? null;
}

/**
 * Tidy what's in the input field without rejecting it — for onBlur, where
 * blanking or rewriting someone's half-typed link would be hostile. Adds the
 * scheme to a recognisable link and otherwise hands the text straight back.
 */
export function normalizeMeetingLink(raw: string): string {
  const link = raw.trim();
  if (!link || /^https?:\/\//i.test(link)) return link;
  return isMeetingLink(link) ? `https://${link}` : link;
}

/** What to tell someone whose link we won't accept. */
export const MEETING_LINK_HINT =
  "Enter a Google Meet or Zoom link (https://meet.google.com/… or https://zoom.us/j/…).";

/**
 * A caution to show beside a link that will probably fail, or null.
 *
 * Zoom puts the passcode in the URL as `?pwd=…`, and Recall is explicit that a
 * bot given a link without it "will not be able to join the call". Plenty of
 * Zoom meetings have no passcode at all, though, so this cannot be a hard
 * rejection — it would block links that work. Warning instead puts the one fact
 * that decides it in front of the person who can check, before they spend a real
 * join attempt and a billed waiting-room timeout finding out.
 *
 * The distinction matters because the failure is silent and late: the bot
 * dispatches happily, sits outside the call, and reports back minutes later.
 */
export function meetingLinkWarning(raw: string): string | null {
  const parsed = parseMeetingUrl(raw);
  if (!parsed || parsed.platform !== "zoom") return null;
  if (parsed.url.searchParams.get("pwd")) return null;
  return "This Zoom link has no passcode in it. If the meeting is passcode-protected the note-taker won't get in — use Zoom's “Copy Invite Link”, which includes the ?pwd= part.";
}
