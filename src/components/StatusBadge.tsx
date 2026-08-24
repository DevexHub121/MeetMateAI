import type { MeetingStatus } from "@/db/schema";

// Tuned for the dark surface: soft translucent fill + light text, matching
// the semantic status pills used across Orbit & Candor.
const STYLES: Record<MeetingStatus, string> = {
  scheduled: "bg-violet-500/15 text-violet-300",
  ready: "bg-white/10 text-neutral-300",
  recorded: "bg-white/10 text-neutral-300",
  transcribing: "bg-amber-500/15 text-amber-300",
  transcribed: "bg-blue-500/15 text-blue-300",
  analyzing: "bg-purple-500/15 text-purple-300",
  completed: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-red-500/15 text-red-300",
};

const LABELS: Record<MeetingStatus, string> = {
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
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-white/10 ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
