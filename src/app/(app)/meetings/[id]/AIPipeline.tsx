import type { MeetingStatus } from "@/db/schema";

// The agentic view of what MeetMate is doing while it turns a recording into
// minutes. Instead of a single opaque spinner, we surface the pipeline as
// named stages the user can watch advance — the active one shimmers, finished
// ones get a check. The server status drives which stage is live; <AutoRefresh>
// (rendered alongside) re-fetches so this steps forward on its own.

const STAGES: { label: string; sub: string }[] = [
  {
    label: "Transcribing audio",
    sub: "Turning speech into text with speaker diarization",
  },
  {
    label: "Understanding the conversation",
    sub: "Mapping who said what and the key threads",
  },
  {
    label: "Writing the minutes",
    sub: "Summarizing decisions, action items and next steps",
  },
];

function activeStage(status: MeetingStatus): number {
  switch (status) {
    case "recorded":
    case "transcribing":
      return 0;
    case "transcribed":
      return 1;
    case "analyzing":
      return 2;
    default:
      return STAGES.length; // completed / everything done
  }
}

export function AIPipeline({ status }: { status: MeetingStatus }) {
  const active = activeStage(status);

  return (
    <div className="ai-border ai-glow card overflow-hidden p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-elevated)]">
          <span
            className="absolute inset-0 rounded-xl opacity-70 blur-[6px]"
            style={{ backgroundImage: "var(--gradient-ai)" }}
          />
          <span className="relative text-[var(--color-heading)]">
            <SparkleIcon />
          </span>
        </span>
        <div className="min-w-0">
          <p className="ai-shimmer-text text-sm font-semibold">
            MeetMate is generating your minutes
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Updates live — this usually takes under a minute.
          </p>
        </div>
      </div>

      {/* Stepper */}
      <ol className="mt-5 space-y-0">
        {STAGES.map((stage, i) => {
          const state =
            i < active ? "done" : i === active ? "active" : "pending";
          const last = i === STAGES.length - 1;
          return (
            <li key={stage.label} className="relative flex gap-3.5">
              {/* Rail + node */}
              <div className="flex flex-col items-center">
                <StageNode state={state} />
                {!last && (
                  <span
                    className={`w-px flex-1 ${
                      i < active
                        ? "bg-gradient-to-b from-[var(--ai-violet)] to-[var(--ai-cyan)]"
                        : "bg-[var(--color-border)]"
                    }`}
                  />
                )}
              </div>
              {/* Text */}
              <div className={last ? "pb-0" : "pb-5"}>
                <p
                  className={`text-sm font-medium ${
                    state === "active"
                      ? "ai-shimmer-text"
                      : state === "done"
                        ? "text-[var(--color-heading)]"
                        : "text-[var(--color-text-muted)]"
                  }`}
                >
                  {stage.label}
                </p>
                <p
                  className={`mt-0.5 text-xs ${
                    state === "pending"
                      ? "text-[var(--color-text-faint)]"
                      : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {stage.sub}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StageNode({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#181818]"
        style={{ backgroundImage: "var(--gradient-ai)" }}
      >
        <CheckIcon />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
        <span
          className="absolute h-6 w-6 animate-ping rounded-full opacity-40"
          style={{ backgroundImage: "var(--gradient-ai)" }}
        />
        <span
          className="relative flex h-6 w-6 items-center justify-center rounded-full"
          style={{ backgroundImage: "var(--gradient-ai)" }}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-white/90" />
        </span>
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-muted-surface)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-faint)]" />
    </span>
  );
}

function SparkleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.6 5.2a4 4 0 0 0 2.6 2.6L21.4 12l-5.2 1.6a4 4 0 0 0-2.6 2.6L12 21.4l-1.6-5.2a4 4 0 0 0-2.6-2.6L2.6 12l5.2-1.6a4 4 0 0 0 2.6-2.6L12 2z" />
      <path d="M19 3l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6.6-2z" opacity="0.75" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
