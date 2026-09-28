import { db } from "@/db";
import { meetings, type Meeting, type MeetingType } from "@/db/schema";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

/**
 * Tenant boundary. A meeting belongs to an organization, and every member of
 * that organization can see it — that shared team view is the product. A MeetMate
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
 * Everything the list can be narrowed by, beyond the internal/client chips.
 *
 * All optional and all independent: absent means "don't narrow on this". They
 * arrive from the query string, so every one of them is untrusted text — see
 * the escaping and the uuid guard below.
 */
export type MeetingListFilters = {
  /** Free text across title, client, creator and participant names. */
  q?: string | null;
  /** Inclusive IST calendar days, `YYYY-MM-DD`. */
  from?: string | null;
  to?: string | null;
  /** A participant key from `listMeetingFilterOptions` (lowercased email, or name when there is no email). */
  participant?: string | null;
  /** Orbit user id, or "none" for the legacy rows that have no owner. Superadmin only. */
  createdBy?: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `%` and `_` are wildcards to LIKE, so a search for "50%" would otherwise match
 * everything. Backslash is Postgres' default LIKE escape character, which means
 * it has to be escaped first or it would escape whatever follows it.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The day a meeting belongs to, as a person here would name it.
 *
 * `meeting_date` is when it happened and `created_at` is when the row appeared;
 * the list already falls back from one to the other, so filtering has to agree
 * or a date range would hide rows the table shows. Compared in IST because the
 * whole app displays IST (`formatIST`) — on a UTC server, an evening meeting
 * would otherwise fall on the previous day and vanish from its own date.
 */
const MEETING_DAY = sql`(coalesce(${meetings.meetingDate}, ${meetings.createdAt}) at time zone 'Asia/Kolkata')::date`;

/** Turn the query-string filters into SQL, dropping anything malformed. */
function filterConditions(
  viewer: Pick<SessionUser, "role">,
  f: MeetingListFilters,
): SQL[] {
  const conditions: SQL[] = [];

  const q = f.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    // Participants are jsonb, so they're matched as text: it covers both the
    // name and the email in one pass, which is what someone typing a half-
    // remembered name into a search box actually wants.
    conditions.push(
      or(
        ilike(meetings.title, like),
        ilike(meetings.clientName, like),
        ilike(meetings.hostName, like),
        sql`coalesce(${meetings.invitees}::text, '') ilike ${like}`,
      ) as SQL,
    );
  }

  if (f.from && DATE_RE.test(f.from)) {
    conditions.push(sql`${MEETING_DAY} >= ${f.from}::date`);
  }
  if (f.to && DATE_RE.test(f.to)) {
    conditions.push(sql`${MEETING_DAY} <= ${f.to}::date`);
  }

  const participant = f.participant?.trim().toLowerCase();
  if (participant) {
    conditions.push(
      sql`exists (
        select 1
        from jsonb_array_elements(coalesce(${meetings.invitees}, '[]'::jsonb)) as inv
        where lower(trim(coalesce(nullif(inv->>'email', ''), inv->>'name', ''))) = ${participant}
      )`,
    );
  }

  // Only a superadmin sees more than their own meetings, so for anyone else
  // this filter can only ever narrow their list to itself or to nothing.
  if (viewer.role === "superadmin" && f.createdBy) {
    if (f.createdBy === "none") {
      conditions.push(sql`${meetings.createdByUserId} is null`);
    } else if (UUID_RE.test(f.createdBy)) {
      // Guarded: a non-uuid here reaches Postgres as a failed cast, not as an
      // empty result.
      conditions.push(eq(meetings.createdByUserId, f.createdBy));
    }
  }

  return conditions;
}

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
 *
 * The type counts are computed with every *other* filter applied, so the chips
 * report what clicking them would actually show. A chip that says 12 while the
 * search box is narrowing the list to 3 is worse than no number at all.
 */
export async function listMeetingPage(
  viewer: Pick<SessionUser, "role" | "org">,
  {
    type,
    page,
    pageSize,
    ...filters
  }: {
    type: MeetingType | "all";
    page: number;
    pageSize: number;
  } & MeetingListFilters,
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

  // Ownership and the filters, but not the type — the type counts are what this
  // scope is being grouped into.
  const scope = and(...(owned ? [owned] : []), ...filterConditions(viewer, filters));

  // Counts first, because the page number has to be clamped against a total we
  // don't know yet — a stale ?page=9 must not render an empty table.
  const grouped = await db
    .select({ type: meetings.type, count: count() })
    .from(meetings)
    .where(scope)
    .groupBy(meetings.type);

  const counts = { all: 0, internal: 0, client: 0 };
  for (const g of grouped) {
    counts[g.type] = Number(g.count);
    counts.all += Number(g.count);
  }

  const total = type === "all" ? counts.all : counts[type];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const where =
    type === "all" ? scope : and(...(scope ? [scope] : []), eq(meetings.type, type));

  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(meetings)
    .where(where)
    .orderBy(desc(meetings.createdAt))
    .limit(pageSize)
    .offset((currentPage - 1) * pageSize);

  return { rows, counts, totalPages, currentPage };
}

/** Shown when a meeting has an owner id but no stored display name. */
const UNKNOWN_CREATOR = "Unknown";

/** What the participant and creator dropdowns offer. */
export type MeetingFilterOptions = {
  participants: { key: string; name: string; count: number }[];
  creators: { id: string; name: string; count: number }[];
};

/**
 * The values worth offering in the dropdowns — drawn from the meetings this
 * viewer can actually see, so nobody learns a colleague's name from a filter.
 *
 * Participants are aggregated in JavaScript rather than with a lateral
 * `jsonb_array_elements` join. `invitees` is a handful of names per row, which
 * is nothing like the transcript blobs that made the list page slow, and one
 * narrow column beats a raw-SQL projection that has to be kept in step with the
 * escaping rules above.
 *
 * The key is the lowercased email, falling back to the name for participants
 * added by hand without one. Emails are stored as typed, so the same person can
 * appear as `Rahul@x.com` and `rahul@x.com`; keying on the lowercased form is
 * what keeps them one entry in the dropdown and one match in the filter.
 */
export async function listMeetingFilterOptions(
  viewer: Pick<SessionUser, "role" | "org">,
): Promise<MeetingFilterOptions> {
  /*
   * Scoped by organization, exactly as listMeetingPage is.
   *
   * Upstream scopes this by creator, which was right when a meeting belonged to
   * whoever recorded it. Here it belongs to an org, and scoping the two
   * differently would give a filter whose options do not match the rows it
   * filters — offering a colleague's name that returns nothing, or hiding one
   * whose meetings are on screen.
   *
   * The impossible-uuid fallback is the same fail-closed rule: somebody with no
   * organization gets no options rather than everyone's.
   */
  const owned =
    viewer.role === "superadmin"
      ? undefined
      : eq(meetings.orgId, viewer.org?.id ?? "00000000-0000-0000-0000-000000000000");

  const rows = await db
    .select({
      invitees: meetings.invitees,
      createdByUserId: meetings.createdByUserId,
      hostName: meetings.hostName,
    })
    .from(meetings)
    .where(owned);

  const participants = new Map<string, { name: string; count: number }>();
  const creators = new Map<string, { name: string; count: number }>();

  for (const row of rows) {
    // One meeting counts once per person, even if they were added twice.
    const seen = new Set<string>();
    for (const inv of row.invitees ?? []) {
      const key = (inv.email?.trim() || inv.name?.trim() || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const found = participants.get(key);
      if (found) found.count += 1;
      else participants.set(key, { name: inv.name?.trim() || inv.email, count: 1 });
    }

    // Only a superadmin sees other people's meetings, so only a superadmin has
    // anything to choose between.
    if (viewer.role !== "superadmin") continue;
    const id = row.createdByUserId ?? "none";
    const found = creators.get(id);
    if (found) {
      found.count += 1;
      // Rows can be missing hostName; take the first real name offered.
      if (found.name === UNKNOWN_CREATOR && row.hostName) found.name = row.hostName;
    } else {
      creators.set(id, {
        // The unowned bucket is deliberately not labelled with a hostName. It
        // holds every row predating Orbit ownership, and those carry assorted
        // host names — showing whichever one happened to be first would claim a
        // person created 26 meetings that are simply unattributed.
        name:
          id === "none"
            ? "No owner (older meetings)"
            : (row.hostName ?? UNKNOWN_CREATOR),
        count: 1,
      });
    }
  }

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);

  return {
    participants: [...participants]
      .map(([key, v]) => ({ key, ...v }))
      .sort(byName),
    creators: [...creators].map(([id, v]) => ({ id, ...v })).sort(byName),
  };
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
