import { db } from "@/db";
import { meetings, type Meeting, type MeetingType } from "@/db/schema";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { and, count, desc, eq } from "drizzle-orm";

/**
 * Tenant boundary. A meeting belongs to an organization, and every member of
 * that organization can see it — that shared team view is the product. A Notti
 * platform owner sees across organizations for support. Nobody sees another
 * organization's meetings.
 */
export function canViewMeeting(
  meeting: Pick<Meeting, "orgId">,
  viewer: Pick<SessionUser, "role" | "org">,
): boolean {
  if (viewer.role === "superadmin") return true;
  return meeting.orgId != null && viewer.org?.id != null && meeting.orgId === viewer.org.id;
}

/** One row of the meetings list — the columns the table actually renders. */
export type MeetingSummary = Pick<
  Meeting,
  | "id"
  | "title"
  | "type"
  | "status"
  | "meetingDate"
  | "createdAt"
  | "hostName"
  | "invitees"
>;

/** Every column the list page renders, and not one byte more. */
const SUMMARY_COLUMNS = {
  id: meetings.id,
  title: meetings.title,
  type: meetings.type,
  status: meetings.status,
  meetingDate: meetings.meetingDate,
  createdAt: meetings.createdAt,
  hostName: meetings.hostName,
  invitees: meetings.invitees,
} as const;

/**
 * A page of meetings visible to `viewer`, plus the per-type counts the filter
 * chips show.
 *
 * The narrowness is the entire point. This used to be `select()` — every column
 * of every row — sliced down to ten in JavaScript afterwards. On 79 meetings
 * that was 1.15 MB over the wire per visit, of which 96% was `transcript` and
 * `minutes`: two large JSON blobs the list does not render a single character
 * of. Measured against the real database, warm: 1808ms before, 325ms after.
 *
 * The old shape also got worse every time anyone recorded anything, because the
 * cost scaled with the whole table rather than the page being viewed. Ten rows
 * is ten rows whether there are 79 meetings or 7,900.
 *
 * Platform owners get everything; everyone else only their organization's rows.
 * The org filter is applied in SQL, so another tenant's rows never leave the
 * database — the count is filtered the same way as the page.
 */
export async function listMeetingPage(
  viewer: Pick<SessionUser, "role" | "org">,
  {
    type,
    page,
    pageSize,
  }: { type: MeetingType | "all"; page: number; pageSize: number },
): Promise<{
  rows: MeetingSummary[];
  counts: { all: number; internal: number; client: number };
  totalPages: number;
  currentPage: number;
}> {
  // Platform owners see everything; everyone else only their organization's
  // meetings. A user with no organization sees nothing rather than everything —
  // failing closed, so a missing membership can never leak the whole table.
  const owned =
    viewer.role === "superadmin"
      ? undefined
      : eq(meetings.orgId, viewer.org?.id ?? "00000000-0000-0000-0000-000000000000");

  // Counts first, because the page number has to be clamped against a total we
  // don't know yet — a stale ?page=9 must not render an empty table.
  const grouped = await db
    .select({ type: meetings.type, count: count() })
    .from(meetings)
    .where(owned)
    .groupBy(meetings.type);

  const counts = { all: 0, internal: 0, client: 0 };
  for (const g of grouped) {
    counts[g.type] = Number(g.count);
    counts.all += Number(g.count);
  }

  const total = type === "all" ? counts.all : counts[type];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const where = owned
    ? type === "all"
      ? owned
      : and(owned, eq(meetings.type, type))
    : type === "all"
      ? undefined
      : eq(meetings.type, type);

  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(meetings)
    .where(where)
    .orderBy(desc(meetings.createdAt))
    .limit(pageSize)
    .offset((currentPage - 1) * pageSize);

  return { rows, counts, totalPages, currentPage };
}

/**
 * Raw fetch by id — NO ownership check. Used by the background processing
 * pipeline (transcription, minutes generation) which runs detached from the
 * request, without a user session. UI/API entry points must use
 * `requireMeetingAccess` instead.
 */
export async function getMeeting(id: string): Promise<Meeting | null> {
  const rows = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fetch a meeting the current user is allowed to see, or throw. Use this in
 * every user-facing page, API route, and server action that takes a meetingId,
 * so a user can't reach another user's meeting by direct URL. Throws a generic
 * "not found" for both missing and forbidden so existence doesn't leak.
 */
export async function requireMeetingAccess(
  meetingId: string,
): Promise<{ meeting: Meeting; user: SessionUser }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const meeting = await getMeeting(meetingId);
  if (!meeting || !canViewMeeting(meeting, user)) {
    throw new Error("Meeting not found");
  }
  return { meeting, user };
}
