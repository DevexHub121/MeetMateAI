import Link from "next/link";
import { listMeetingPage } from "@/lib/meetings";
import { requireUser } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { formatIST } from "@/lib/datetime";
import type { MeetingType } from "@/db/schema";

export const dynamic = "force-dynamic";

const FILTERS: { key: "all" | MeetingType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "internal", label: "Internal" },
  { key: "client", label: "Client" },
];

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const { type, page } = await searchParams;
  const active: "all" | MeetingType =
    type === "internal" || type === "client" ? type : "all";

  const user = await requireUser();
  // Only a superadmin sees who created each meeting.
  const showHost = user.role === "superadmin";

  // Paginated and counted in SQL. Doing it here in JS meant fetching every
  // meeting — transcripts included — to display ten titles.
  const PAGE_SIZE = 10;
  const { rows, counts, totalPages, currentPage } = await listMeetingPage(
    user,
    { type: active, page: Number(page) || 1, pageSize: PAGE_SIZE },
  );
  const shownCount = active === "all" ? counts.all : counts[active];

  // Build a URL that keeps the active type filter and sets the page.
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (active !== "all") params.set("type", active);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/meetings?${qs}` : "/meetings";
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">
          Meetings
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {shownCount} meeting{shownCount === 1 ? "" : "s"}
          {active !== "all" ? ` · ${active}` : ""}
        </p>
      </div>

      {/* Filter toggle: differentiate internal vs client meetings. */}
      <div className="mb-5 inline-flex rounded-lg border border-[var(--color-border)] p-0.5">
        {FILTERS.map((f) => {
          const count = counts[f.key];
          const isActive = active === f.key;
          return (
            <Link
              key={f.key}
              href={f.key === "all" ? "/meetings" : `/meetings?type=${f.key}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--color-elevated)] text-[var(--color-heading)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-heading)]"
              }`}
            >
              {f.label}
              <span
                className={`ml-1.5 text-xs ${
                  isActive
                    ? "text-[var(--color-text-secondary)]"
                    : "text-[var(--color-text-muted)]"
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="card animate-fade-in-up flex flex-col items-center gap-3 border-dashed p-14 text-center">
          <span className="relative mb-1">
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-2 rounded-3xl opacity-50 blur-lg"
              style={{ backgroundImage: "var(--gradient-ai)" }}
            />
            <span className="brand-gradient relative flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--color-border)] text-[var(--color-heading)] shadow-sm">
              <SparkleIcon />
            </span>
          </span>
          <p className="font-medium text-[var(--color-heading)]">
            No meetings yet
          </p>
          <p className="max-w-xs text-sm text-[var(--color-text-muted)]">
            Record or import a conversation — Echo transcribes it and writes
            clean, shareable minutes automatically.
          </p>
          <Link href="/meetings/new" className="btn-ai mt-2 px-4 py-2">
            <SparkleIcon />
            Start your first meeting
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted-surface)]/50 text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              <tr>
                <th className="px-5 py-3 font-medium">Meeting</th>
                <th className="px-5 py-3 font-medium">Participants</th>
                {showHost && (
                  <th className="px-5 py-3 font-medium">Created by</th>
                )}
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((m) => (
                <tr
                  key={m.id}
                  className="group transition-colors hover:bg-[var(--color-muted-surface)]"
                >
                  <td className="px-5 py-3">
                    {/* Link, not <a>: a bare anchor threw away the whole
                        document and rebuilt it — new HTML, new JS, a blank
                        screen for the duration. Link keeps the shell mounted,
                        prefetches on hover, and lets loading.tsx paint
                        instantly. */}
                    <Link
                      href={`/meetings/${m.id}`}
                      className="flex items-center gap-3"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-elevated)] text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-heading)]">
                        <MicIcon />
                      </span>
                      <span className="font-medium text-[var(--color-heading)]">
                        {m.title}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-white/10 ${
                          m.type === "client"
                            ? "bg-white/10 text-[var(--color-heading)]"
                            : "bg-[var(--color-muted-surface)] text-[var(--color-text-secondary)]"
                        }`}
                      >
                        {m.type === "client" ? "Client" : "Internal"}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-[var(--color-text-secondary)]">
                    {m.invitees && m.invitees.length ? (
                      <span title={m.invitees.map((i) => i.name).join(", ")}>
                        {m.invitees.length} participant
                        {m.invitees.length === 1 ? "" : "s"}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  {showHost && (
                    <td className="px-5 py-3 text-[var(--color-text-secondary)]">
                      {m.hostName ?? (
                        <span className="text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-5 py-3">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-5 py-3 text-right text-[var(--color-text-muted)]">
                    {formatIST(m.meetingDate ?? m.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination — only when the filtered list spans more than one page. */}
      {totalPages > 1 && (
        <div className="mt-5 flex items-center justify-between">
          <p className="text-xs text-[var(--color-text-muted)]">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <PageLink
              href={pageHref(currentPage - 1)}
              disabled={currentPage === 1}
            >
              ← Prev
            </PageLink>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={pageHref(p)}
                aria-current={p === currentPage ? "page" : undefined}
                className={`min-w-8 rounded-md px-2.5 py-1.5 text-center text-sm font-medium transition-colors ${
                  p === currentPage
                    ? "bg-[var(--color-elevated)] text-[var(--color-heading)]"
                    : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-muted-surface)]"
                }`}
              >
                {p}
              </Link>
            ))}
            <PageLink
              href={pageHref(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              Next →
            </PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-faint)]">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-muted-surface)]"
    >
      {children}
    </Link>
  );
}

function MicIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.6 5.2a4 4 0 0 0 2.6 2.6L21.4 12l-5.2 1.6a4 4 0 0 0-2.6 2.6L12 21.4l-1.6-5.2a4 4 0 0 0-2.6-2.6L2.6 12l5.2-1.6a4 4 0 0 0 2.6-2.6L12 2z" />
    </svg>
  );
}
