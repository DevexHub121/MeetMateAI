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
 * mattered a second time, and Teams a third: one host table, and every gate in
 * the app widens at once rather than four regexes drifting apart.
 *
 * Recall needs no help identifying the platform — it reads the URL — so adding a
 * platform here is genuinely all that is required to support it.
 */

export type MeetingPlatform = "google_meet" | "zoom" | "microsoft_teams";

/** Human name for a platform, for buttons, errors and banners. */
export const PLATFORM_NAMES: Record<MeetingPlatform, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  microsoft_teams: "Microsoft Teams",
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
 *
 * Teams hands out two shapes of link and both land on teams.microsoft.com: the
 * long "/l/meetup-join/19%3ameeting_…%40thread.v2/0?context=…" form and the
 * newer short "/meet/<id>" one. teams.live.com is the consumer/personal-account
 * equivalent, and teams.microsoft.us is the government cloud — the same split
 * zoomgov.com represents for Zoom.
 */
const HOSTS: ReadonlyArray<{ platform: MeetingPlatform; host: RegExp }> = [
  { platform: "google_meet", host: /(^|\.)meet\.google\.com$/i },
  { platform: "zoom", host: /(^|\.)zoom\.us$/i },
  { platform: "zoom", host: /(^|\.)zoomgov\.com$/i },
  { platform: "microsoft_teams", host: /(^|\.)teams\.microsoft\.com$/i },
  { platform: "microsoft_teams", host: /(^|\.)teams\.live\.com$/i },
  { platform: "microsoft_teams", host: /(^|\.)teams\.microsoft\.us$/i },
];

/** Outlook / Defender "Safe Links" rewriting, which wraps the real URL in a query param. */
const SAFELINKS_HOST = /(^|\.)safelinks\.protection\.(outlook\.com|office365\.us)$/i;

/**
 * Undo Outlook's Safe Links rewriting, if that's what this is.
 *
 * This matters far more for Teams than for the other two, because the usual way
 * to get a Teams link is to copy it out of the Outlook calendar invite — and any
 * tenant with Defender for Office 365 turned on will have rewritten it to
 *
 *     https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams…
 *
 * on the way in. The hostname is then Microsoft's scanner, not Teams, so the
 * allowlist rejects it and the person is told to paste a meeting link while they
 * are staring at the meeting link they just pasted. Unwrapping costs one line
 * and removes a support ticket we would otherwise get from every Outlook shop.
 *
 * The unwrapped value is handed back to the normal host check rather than
 * trusted, so a Safe Link wrapping somewhere else is still rejected; and it
 * unwraps once rather than looping, so a self-referential chain can't spin.
 */
function unwrapSafeLink(url: URL): URL {
  if (!SAFELINKS_HOST.test(url.hostname)) return url;
  const inner = url.searchParams.get("url");
  if (!inner) return url;
  try {
    return new URL(inner);
  } catch {
    return url;
  }
}

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
  url = unwrapSafeLink(url);
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
 * the passcode rides in `?pwd=` and the bot cannot join without it. The same is
 * true of Teams, where `?context=` carries the tenant and organiser ids, and of
 * the percent-encoding in the Teams path: "19%3ameeting_…%40thread.v2" must
 * reach Recall still escaped, which is what URL round-tripping gives us.
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
  "Enter a Google Meet, Zoom or Microsoft Teams link (https://meet.google.com/…, https://zoom.us/j/… or https://teams.microsoft.com/l/meetup-join/…).";

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
 * Teams fails the same way for a different reason. The bot joins as an external
 * participant, and most tenants admit only their own people automatically, so it
 * lands in the lobby and waits to be let in. Nothing in the URL says whether
 * that will happen, so unlike the Zoom case this shows on every Teams link —
 * which is right, because the action it asks for (watch for the bot and admit
 * it) is needed every time and costs nothing when it turns out to be unnecessary.
 *
 * The distinction matters because the failure is silent and late: the bot
 * dispatches happily, sits outside the call, and reports back minutes later.
 */
export function meetingLinkWarning(raw: string): string | null {
  const parsed = parseMeetingUrl(raw);
  if (!parsed) return null;
  if (parsed.platform === "microsoft_teams") {
    return "Teams puts external participants in the lobby. The note-taker will wait there until someone in the meeting admits it — if nobody does, it leaves without recording.";
  }
  if (parsed.platform !== "zoom") return null;
  if (parsed.url.searchParams.get("pwd")) return null;
  return "This Zoom link has no passcode in it. If the meeting is passcode-protected the note-taker won't get in — use Zoom's “Copy Invite Link”, which includes the ?pwd= part.";
}
