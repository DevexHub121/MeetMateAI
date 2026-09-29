import type { MeetingStatus } from "@/db/schema";

/**
 * Where a meeting is in the pipeline.
 *
 * Tuned for the light dashboard: a tinted fill, ink dark enough to read on it,
 * a hairline, and a dot. The dot is what carries the state at a glance — the
 * eye finds a colour in a column of pills long before it reads one.
 *
 * The two states that are still working — transcribing and generating minutes —
 * blink theirs. Nothing else moves, so motion means exactly one thing on this
 * screen: come back to this row.
 */
const STYLES: Record<
  MeetingStatus,
  { bg: string; fg: string; ring: string; dot: string; live?: boolean }
> = {
  scheduled:    { bg: "rgba(124,58,237,.08)", fg: "#6d28d9", ring: "rgba(124,58,237,.2)", dot: "#7c3aed" },
  ready:        { bg: "rgba(24,24,24,.05)",   fg: "#46463f", ring: "rgba(24,24,24,.1)",   dot: "#8a8a86" },
  recorded:     { bg: "rgba(24,24,24,.05)",   fg: "#46463f", ring: "rgba(24,24,24,.1)",   dot: "#8a8a86" },
  transcribing: { bg: "rgba(217,119,6,.09)",  fg: "#92400e", ring: "rgba(217,119,6,.22)", dot: "#d97706", live: true },
  transcribed:  { bg: "rgba(37,99,235,.08)",  fg: "#1d4ed8", ring: "rgba(37,99,235,.2)",  dot: "#2563eb" },
  analyzing:    { bg: "linear-gradient(115deg,rgba(167,139,250,.18),rgba(34,211,238,.14))", fg: "#4338ca", ring: "rgba(129,140,248,.4)", dot: "#818cf8", live: true },
  completed:    { bg: "rgba(5,150,105,.08)",  fg: "#047857", ring: "rgba(5,150,105,.2)",  dot: "#059669" },
  failed:       { bg: "rgba(220,38,38,.08)",  fg: "#b91c1c", ring: "rgba(220,38,38,.2)",  dot: "#dc2626" },
};

export const STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: "Scheduled",
  ready: "Ready to record",
  recorded: "Recorded",
  transcribing: "Transcribing",
  transcribed: "Transcribed",
  analyzing: "Generating minutes",
  completed: "Completed",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: MeetingStatus }) {
  const s = STYLES[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.fg, boxShadow: `inset 0 0 0 1px ${s.ring}` }}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full${s.live ? " blink" : ""}`}
        style={{ background: s.dot }}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}
