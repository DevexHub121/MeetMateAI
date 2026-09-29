// Server components render in the host's timezone (UTC on DigitalOcean), which
// made recording timestamps look wrong. Force IST (Asia/Kolkata) everywhere so
// dates/times match what the team expects, regardless of server TZ.

export function formatIST(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export function formatISTDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

const IST = "Asia/Kolkata";

/** The IST calendar day a moment falls on, as YYYY-MM-DD. */
export function istDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Clock time only — the date is carried by the group heading above the row. */
export function formatISTTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * A heading a reader can place without doing arithmetic.
 *
 * "Today" and "Yesterday" rather than a date, because those are the two days
 * anybody is actually oriented around; everything else gets a weekday and a
 * date. Anything still to come is grouped as "Upcoming" regardless of how far
 * out it is — a scheduled meeting's exact date matters less than the fact that
 * it has not happened yet.
 */
export function istDayLabel(date: Date, now = new Date()): string {
  const key = istDayKey(date);
  const today = istDayKey(now);
  if (key > today) return "Upcoming";
  if (key === today) return "Today";

  const y = new Date(now);
  y.setUTCDate(y.getUTCDate() - 1);
  if (key === istDayKey(y)) return "Yesterday";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    weekday: "long",
    day: "numeric",
    month: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month").replace(/\.$/, "").slice(0, 3)}`;
}

/**
 * Is this moment still ahead of us?
 *
 * The clock read lives in here, behind a default parameter, rather than in a
 * component body — reading the time while rendering is the kind of impurity
 * that makes a render non-reproducible, and the lint rules rightly object.
 */
export function isUpcoming(date: Date, now = new Date()): boolean {
  return date.getTime() > now.getTime();
}
