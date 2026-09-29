import Link from "next/link";
import { listMeetingFilterOptions, listMeetingPage } from "@/lib/meetings";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import Image from "next/image";
import { istDayKey, istDayLabel, formatISTTime, isUpcoming } from "@/lib/datetime";
import type { MeetingType } from "@/db/schema";
import { MeetingFilters } from "./MeetingFilters";

export const dynamic = "force-dynamic";

const FILTERS: { key: "all" | MeetingType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "internal", label: "Internal" },
  { key: "client", label: "Client" },
];

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    page?: string;
    q?: string;
    from?: string;
    to?: string;
    participant?: string;
    by?: string;
  }>;
}) {
  const { type, page, q, from, to, participant, by } = await searchParams;
  const active: "all" | MeetingType =
    type === "internal" || type === "client" ? type : "all";

  const user = await requireUser();
  // Only a superadmin sees who created each meeting — and so only a superadmin
  // is offered the filter for it.
  const showHost = user.role === "superadmin";

  // Everything the URL is narrowing by. Validated in the query builder, not
  // here: these are strings from a query string and nothing else.
  const filters = {
    q: q ?? "",
    from: from ?? "",
    to: to ?? "",
    participant: participant ?? "",
    createdBy: showHost ? (by ?? "") : "",
  };

  // Paginated and counted in SQL. Doing it here in JS meant fetching every
  // meeting — transcripts included — to display ten titles.
  const PAGE_SIZE = 10;
  const [{ rows, counts, totalPages, currentPage }, options] = await Promise.all([
    listMeetingPage(user, {
      type: active,
      page: Number(page) || 1,
      pageSize: PAGE_SIZE,
      ...filters,
    }),
    listMeetingFilterOptions(user),
  ]);
  const shownCount = active === "all" ? counts.all : counts[active];
  const filtered = Object.values(filters).some(Boolean);

  // Build a URL that keeps every active filter and sets the page. Losing the
  // filters on "next page" is the classic version of this bug.
  const withParams = (over: Record<string, string>) => {
    const params = new URLSearchParams();
    if (active !== "all") params.set("type", active);
    if (filters.q) params.set("q", filters.q);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.participant) params.set("participant", filters.participant);
    if (filters.createdBy) params.set("by", filters.createdBy);
    for (const [k, v] of Object.entries(over)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    return qs ? `/meetings?${qs}` : "/meetings";
  };
  const pageHref = (p: number) => withParams({ page: p > 1 ? String(p) : "" });


  /*
   * "Right now" — the meetings that are mid-flight or about to start.
   *
   * Drawn from the rows already fetched rather than a second query: on page one
   * with no filters this page is the newest ten, which is where anything live
   * will be. Shown only in that case, because on page four of a filtered search
   * a "right now" strip is answering a question nobody asked.
   */
  const live =
    currentPage === 1 && !filtered && active === "all"
      ? rows.filter(
          (m) =>
            m.status === "analyzing" ||
            m.status === "transcribing" ||
            (m.status === "scheduled" && isUpcoming(m.meetingDate ?? m.createdAt)),
        )
      : [];

  // Rows in the order the query returned them, cut into IST days. Insertion
  // order is preserved by Map, so the grouping never reorders the list.
  const groups = new Map<string, { label: string; items: typeof rows }>();
  for (const m of rows) {
    const when = m.meetingDate ?? m.createdAt;
    const key = istDayKey(when);
    if (!groups.has(key)) groups.set(key, { label: istDayLabel(when), items: [] });
    groups.get(key)!.items.push(m);
  }

  const typeToggle = (
    <div className="mb-3 inline-flex rounded-full p-1" style={{ background: "rgba(15,29,69,.06)" }}>
      {FILTERS.map((f) => {
        const isActive = active === f.key;
        return (
          <Link
            key={f.key}
            href={withParams({ type: f.key === "all" ? "" : f.key, page: "" })}
            aria-current={isActive ? "page" : undefined}
            className="rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors"
            style={isActive ? { background: "var(--d-ink)", color: "#fff" } : { color: "var(--d-text)" }}
          >
            {f.label}
            <span className="ml-1.5 text-[11px] opacity-70">{counts[f.key]}</span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="mb-7">
        <h1 className="font-[family-name:var(--font-display)] text-[44px] font-bold leading-none tracking-[-0.03em] text-[var(--d-ink)]">
          Meetings
        </h1>
        <p className="mt-2.5 text-[14px] text-[var(--d-muted)]">
          {shownCount} meeting{shownCount === 1 ? "" : "s"}
          {active !== "all" ? ` · ${active}` : ""}
          {filtered ? " · filtered" : ""}
        </p>
      </div>

      {live.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--d-muted)]">
            Right now
          </h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {live.map((m) => {
              const working = m.status === "analyzing";
              return (
                <Link
                  key={m.id}
                  href={`/meetings/${m.id}`}
                  className="block rounded-2xl p-4 transition-shadow hover:shadow-sm"
                  style={
                    working
                      ? { background: "linear-gradient(115deg,rgba(167,139,250,.12),rgba(34,211,238,.09))", border: "1px solid rgba(129,140,248,.4)" }
                      : { background: "var(--d-soft)", border: "1px solid var(--d-border)" }
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge status={m.status} />
                    <span className="shrink-0 font-mono text-[12px] text-[var(--d-muted)]">
                      {formatISTTime(m.meetingDate ?? m.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2.5 truncate font-[family-name:var(--font-display)] text-[19px] font-semibold text-[var(--d-ink)]">
                    {m.title}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <MeetingFilters
        values={{ type: active, ...filters }}
        options={options}
        showCreator={showHost}
        typeToggle={typeToggle}
      />

      {rows.length === 0 && filtered ? (
        /* Nothing matched. Deliberately not the "no meetings yet" state — the
           meetings exist, the filters just excluded them, and offering to record
           a first one would be telling the reader something untrue. */
        <div
          className="flex flex-col items-center gap-3 rounded-2xl p-14 text-center"
          style={{ background: "var(--d-soft)", border: "1px dashed var(--d-border-strong)" }}
        >
          <p className="font-semibold text-[var(--d-ink)]">No meetings match these filters</p>
          <p className="max-w-xs text-sm text-[var(--d-muted)]">
            Try a different date range, or clear a filter to widen the search.
          </p>
          <Link
            href={active === "all" ? "/meetings" : `/meetings?type=${active}`}
            className="mt-1 rounded-full px-4 py-2 text-sm font-medium text-[var(--d-ink)]"
            style={{ border: "1px solid var(--d-border-strong)" }}
          >
            Clear filters
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-2xl p-14 text-center"
          style={{ background: "var(--d-soft)", border: "1px dashed var(--d-border-strong)" }}
        >
          <Image src="/brand/meetmate-mark.png" alt="" width={104} height={80} className="mb-1 h-16 w-auto" />
          <p className="font-semibold text-[var(--d-ink)]">No meetings yet</p>
          <p className="max-w-xs text-sm text-[var(--d-muted)]">
            Record or import a conversation — MeetMate transcribes it and writes
            clean, shareable minutes automatically.
          </p>
          <Link
            href="/meetings/new"
            className="mt-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white"
            style={{ background: "var(--d-ai-grad)" }}
          >
            Start your first meeting
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl" style={{ background: "var(--d-surface)", border: "1px solid var(--d-border)" }}>
          {/* Column header. Mono and uppercase so it reads as a label strip
              rather than a first row of data. */}
          <div
            className="hidden items-center gap-4 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--d-muted)] md:grid"
            style={{ gridTemplateColumns: showHost ? "2.6fr 1.1fr 1fr 1.1fr 76px" : "2.6fr 1.1fr 1.1fr 76px", borderBottom: "1px solid var(--d-border)" }}
          >
            <span>Meeting</span>
            <span>Participants</span>
            {showHost && <span>Created by</span>}
            <span>Status</span>
            <span className="text-right">Time</span>
          </div>

          {[...groups.values()].map((g) => (
            <div key={g.label}>
              <div
                className="flex items-baseline gap-2 px-4 py-2.5"
                style={{ background: "var(--d-soft)", borderBottom: "1px solid var(--d-border)" }}
              >
                <span className="text-[15px] font-semibold text-[var(--d-ink)]">{g.label}</span>
                <span className="text-[12px] text-[var(--d-muted)]">{g.items.length}</span>
              </div>

              {g.items.map((m) => (
                <Link
                  key={m.id}
                  href={`/meetings/${m.id}`}
                  /* Link, not <a>: a bare anchor threw away the whole document
                     and rebuilt it — new HTML, new JS, a blank screen for the
                     duration. Link keeps the shell mounted and prefetches. */
                  className="group grid items-center gap-4 px-4 py-3 transition-colors hover:bg-[var(--d-soft)]"
                  style={{ gridTemplateColumns: showHost ? "2.6fr 1.1fr 1fr 1.1fr 76px" : "2.6fr 1.1fr 1.1fr 76px", borderBottom: "1px solid var(--d-border)" }}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[var(--d-muted)] transition-colors group-hover:text-[var(--d-ink)]"
                      style={{ background: "rgba(15,29,69,.05)" }}
                    >
                      <MicIcon />
                    </span>
                    <span className="min-w-0 truncate text-[15px] font-semibold text-[var(--d-ink)]">
                      {m.title}
                    </span>
                    <span
                      className="hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline"
                      style={
                        m.type === "client"
                          ? { background: "var(--d-ink)", color: "#fff" }
                          : { background: "rgba(15,29,69,.06)", color: "var(--d-text)" }
                      }
                    >
                      {m.type === "client" ? "Client" : "Internal"}
                    </span>
                  </span>

                  <span className="hidden md:block">
                    {m.invitees && m.invitees.length ? (
                      <span className="flex items-center" title={m.invitees.map((i) => i.name).join(", ")}>
                        {m.invitees.slice(0, 3).map((i, k) => (
                          <span
                            key={`${i.email ?? i.name}-${k}`}
                            className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold text-[var(--d-ink)]"
                            style={{ background: "rgba(15,29,69,.08)", boxShadow: "0 0 0 2px var(--d-surface)", marginLeft: k ? -8 : 0 }}
                          >
                            {(i.name || i.email || "?").slice(0, 1).toUpperCase()}
                          </span>
                        ))}
                        {m.invitees.length > 3 && (
                          <span className="ml-1.5 text-[12px] text-[var(--d-muted)]">
                            +{m.invitees.length - 3}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[13px] text-[var(--d-muted)]">—</span>
                    )}
                  </span>

                  {showHost && (
                    <span className="hidden truncate text-[13px] text-[var(--d-text)] md:block">
                      {m.hostName ?? <span className="text-[var(--d-muted)]">—</span>}
                    </span>
                  )}

                  <span className="hidden md:block"><StatusBadge status={m.status} /></span>

                  <span className="hidden text-right font-mono text-[12px] text-[var(--d-muted)] md:block">
                    {formatISTTime(m.meetingDate ?? m.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Pagination — only when the filtered list spans more than one page. */}
      {totalPages > 1 && (
        <div className="mt-5 flex items-center justify-between">
          <p className="text-[12px] text-[var(--d-muted)]">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <PageLink href={pageHref(currentPage - 1)} disabled={currentPage === 1}>← Prev</PageLink>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={pageHref(p)}
                aria-current={p === currentPage ? "page" : undefined}
                className="min-w-8 rounded-full px-2.5 py-1.5 text-center text-sm font-medium transition-colors"
                style={p === currentPage ? { background: "var(--d-ink)", color: "#fff" } : { color: "var(--d-text)" }}
              >
                {p}
              </Link>
            ))}
            <PageLink href={pageHref(currentPage + 1)} disabled={currentPage === totalPages}>Next →</PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return (
      <span className="rounded-full px-3 py-1.5 text-sm font-medium text-[var(--d-muted)] opacity-50" style={{ border: "1px solid var(--d-border)" }}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className="rounded-full px-3 py-1.5 text-sm font-medium text-[var(--d-text)] transition-colors hover:bg-[rgba(15,29,69,.06)]" style={{ border: "1px solid var(--d-border)" }}>
      {children}
    </Link>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
