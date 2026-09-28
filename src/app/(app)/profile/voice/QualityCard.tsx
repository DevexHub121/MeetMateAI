import type { QualityReport } from "@/lib/voice/quality";

/**
 * How good someone's voiceprint actually is, said plainly.
 *
 * Enrolment used to end with "saved" and nothing else, so a profile made of
 * room noise looked exactly like a good one — and the first anyone knew of the
 * difference was a meeting where their name never appeared. Every problem shown
 * here is one we can detect from the samples themselves, and every one comes
 * with the thing to do differently.
 */
export function QualityCard({ report }: { report: QualityReport }) {
  const tone = {
    excellent: {
      ring: "ring-emerald-400/30",
      bg: "bg-emerald-500/10",
      text: "text-emerald-300",
      bar: "bg-emerald-400",
      label: "Strong",
    },
    good: {
      ring: "ring-emerald-400/20",
      bg: "bg-emerald-500/5",
      text: "text-emerald-300/90",
      bar: "bg-emerald-400/80",
      label: "Good",
    },
    weak: {
      ring: "ring-amber-400/30",
      bg: "bg-amber-500/10",
      text: "text-amber-200",
      bar: "bg-amber-400",
      label: "Weak",
    },
    redo: {
      ring: "ring-red-400/30",
      bg: "bg-red-500/10",
      text: "text-red-300",
      bar: "bg-red-400",
      label: "Needs redoing",
    },
  }[report.grade];

  return (
    <div className={`rounded-xl p-4 ring-1 ring-inset ${tone.ring} ${tone.bg}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm font-semibold ${tone.text}`}>
          {tone.label}
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">
          <span className="text-lg font-semibold text-[var(--color-heading)]">
            {report.score}
          </span>
          /100
        </span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/25">
        <div
          className={`h-full rounded-full ${tone.bar}`}
          style={{ width: `${report.score}%` }}
        />
      </div>

      <p className="mt-2.5 text-sm text-[var(--color-text-primary)]">
        {report.headline}
      </p>

      {report.issues.length > 0 && (
        <ul className="mt-3 space-y-2.5">
          {report.issues.map((issue) => (
            <li key={issue.key} className="flex gap-2.5">
              <span
                aria-hidden
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  issue.severity === "serious" ? "bg-red-400" : "bg-amber-400"
                }`}
              />
              <span className="text-sm">
                <span className="font-medium text-[var(--color-heading)]">
                  {issue.title}
                </span>
                <span className="block text-[var(--color-text-secondary)]">
                  {issue.advice}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
