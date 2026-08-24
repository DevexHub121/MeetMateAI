"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Minutes } from "@/db/schema";
import { createTasks } from "../actions";

export function MinutesView({
  minutes,
  title,
  meetingId,
  tasksSent,
  isClient,
}: {
  minutes: Minutes;
  title: string;
  meetingId: string;
  tasksSent: boolean;
  isClient: boolean;
}) {
  const isDemo = minutes.summary.startsWith("⚠️ Demo minutes");
  const summaryText = isDemo
    ? minutes.summary.split("\n\n").slice(1).join("\n\n")
    : minutes.summary;

  return (
    <div className="space-y-6">
      <div className="animate-reveal flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="ai-chip">
            <SparkleIcon />
            AI generated
          </span>
          {isDemo && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">
              Demo minutes · add an OpenAI key for real analysis
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isClient && minutes.actionItems.length > 0 && (
            <CreateTasksButton
              meetingId={meetingId}
              count={minutes.actionItems.length}
              alreadySent={tasksSent}
            />
          )}
          <CopyButton minutes={minutes} title={title} />
          <DownloadButton minutes={minutes} title={title} />
        </div>
      </div>

      <Section title="Summary" delay={60}>
        <p className="max-w-prose text-sm leading-relaxed text-[var(--color-text-primary)]">
          {summaryText}
        </p>
      </Section>

      {minutes.attendees.length > 0 && (
        <Section title="Attendees" delay={120}>
          <div className="flex flex-wrap gap-2">
            {minutes.attendees.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full bg-[var(--color-elevated)] px-3 py-1 text-sm font-medium text-[var(--color-heading)] ring-1 ring-inset ring-white/10"
              >
                {a}
              </span>
            ))}
          </div>
        </Section>
      )}

      {minutes.agenda.length > 0 && (
        <Section title="Agenda" delay={180}>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--color-text-primary)]">
            {minutes.agenda.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </Section>
      )}

      {minutes.keyPoints.length > 0 && (
        <Section title="Key points" delay={240}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-text-primary)]">
            {minutes.keyPoints.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </Section>
      )}

      {minutes.decisions.length > 0 && (
        <Section title="Decisions" delay={300}>
          <ul className="space-y-1.5">
            {minutes.decisions.map((d, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm text-[var(--color-text-primary)]"
              >
                <span className="mt-0.5 text-emerald-400">✓</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!isClient && (
      <Section title="Action items" delay={360}>
        {minutes.actionItems.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No action items recorded.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-muted-surface)]/50 text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Owner</th>
                  <th className="px-4 py-2.5 font-medium">Task</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {minutes.actionItems.map((item, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 font-medium text-[var(--color-heading)]">
                      {item.owner}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-text-primary)]">
                      {item.task}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">
                      {item.due ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      )}

      {minutes.risks.length > 0 && (
        <Section title="Risks & open questions" delay={420}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-300/90">
            {minutes.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
      )}

      {minutes.nextSteps.length > 0 && (
        <Section title="Next steps" delay={480}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-text-primary)]">
            {minutes.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  delay = 0,
}: {
  title: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <section
      className="card animate-reveal p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-3.5 w-[3px] rounded-full"
          style={{ backgroundImage: "var(--gradient-ai)" }}
        />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function SparkleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.6 5.2a4 4 0 0 0 2.6 2.6L21.4 12l-5.2 1.6a4 4 0 0 0-2.6 2.6L12 21.4l-1.6-5.2a4 4 0 0 0-2.6-2.6L2.6 12l5.2-1.6a4 4 0 0 0 2.6-2.6L12 2z" />
    </svg>
  );
}

// Render the minutes as Markdown for copy / download.
function toMarkdown(minutes: Minutes, title: string): string {
  const lines: string[] = [`# ${title}`, ""];
  const list = (items: string[]) => items.map((i) => `- ${i}`);

  lines.push("## Summary", minutes.summary, "");
  if (minutes.attendees.length) {
    lines.push("## Attendees", ...list(minutes.attendees), "");
  }
  if (minutes.agenda.length) {
    lines.push(
      "## Agenda",
      ...minutes.agenda.map((a, i) => `${i + 1}. ${a}`),
      "",
    );
  }
  if (minutes.keyPoints.length) {
    lines.push("## Key points", ...list(minutes.keyPoints), "");
  }
  if (minutes.decisions.length) {
    lines.push("## Decisions", ...list(minutes.decisions), "");
  }
  lines.push("## Action items");
  if (minutes.actionItems.length === 0) {
    lines.push("_No action items recorded._", "");
  } else {
    lines.push("| Owner | Task | Due |", "| --- | --- | --- |");
    for (const a of minutes.actionItems) {
      lines.push(`| ${a.owner} | ${a.task} | ${a.due ?? "—"} |`);
    }
    lines.push("");
  }
  if (minutes.risks.length) {
    lines.push("## Risks & open questions", ...list(minutes.risks), "");
  }
  if (minutes.nextSteps.length) {
    lines.push("## Next steps", ...list(minutes.nextSteps), "");
  }
  return lines.join("\n");
}

function CreateTasksButton({
  meetingId,
  count,
  alreadySent,
}: {
  meetingId: string;
  count: number;
  alreadySent: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const onClick = () =>
    startTransition(async () => {
      setMsg(null);
      try {
        const res = await createTasks(meetingId);
        setMsg(
          res.skipped
            ? "No webhook configured"
            : `Sent ${res.sent}/${count}`,
        );
        router.refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Failed");
      }
    });

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className="text-xs text-[var(--color-text-secondary)]">{msg}</span>
      )}
      <button
        onClick={onClick}
        disabled={isPending}
        className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
      >
        {isPending && (
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#181818]/40 border-t-transparent" />
        )}
        {alreadySent ? "Resend tasks" : `Create ${count} task${count === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

function CopyButton({ minutes, title }: { minutes: Minutes; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(toMarkdown(minutes, title));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can fail on insecure origins; ignore.
        }
      }}
      className="btn-secondary px-3 py-1.5 text-sm"
    >
      {copied ? "Copied ✓" : "Copy minutes"}
    </button>
  );
}

function DownloadButton({
  minutes,
  title,
}: {
  minutes: Minutes;
  title: string;
}) {
  return (
    <button
      onClick={() => {
        const md = toMarkdown(minutes, title);
        const blob = new Blob([md], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${title.replace(/[^\w.-]+/g, "-")}.md`;
        a.click();
        URL.revokeObjectURL(url);
      }}
      className="btn-primary px-3 py-1.5 text-sm"
    >
      Download .md
    </button>
  );
}
