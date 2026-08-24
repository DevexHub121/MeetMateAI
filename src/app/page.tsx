import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { NottiMark } from "@/components/NottiMark";

export const dynamic = "force-dynamic";

const FEATURES = [
  { title: "Joins the call for you", body: "Notti sends a bot into Google Meet, Zoom or Teams — or records right on your device. No screen-sharing, no plugins." },
  { title: "Accurate transcripts", body: "Every word, attributed to the right speaker, ready to search the moment the call ends." },
  { title: "Minutes that write themselves", body: "A clean summary, decisions, action items and next steps — generated and emailed to everyone automatically." },
  { title: "Built for teams", body: "Invite your whole company. Everyone's meetings live in one shared, private workspace." },
];

const STEPS = [
  { n: "1", title: "Add the meeting", body: "Paste a meeting link or start recording on the spot." },
  { n: "2", title: "Notti listens", body: "It captures the audio and transcribes as the conversation happens." },
  { n: "3", title: "Get your minutes", body: "Summary, action items and the full transcript — in your inbox minutes later." },
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  const cta = user ? { href: "/meetings", label: "Go to your workspace" } : { href: "/register", label: "Start free" };

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="brand-gradient flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-heading)]">
              <NottiMark size={19} />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight text-[var(--color-heading)]">Notti</span>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            {user ? (
              <Link href="/meetings" className="btn-primary px-4 py-1.5">Open app</Link>
            ) : (
              <>
                <Link href="/login" className="btn-secondary px-3.5 py-1.5">Sign in</Link>
                <Link href="/register" className="btn-primary px-4 py-1.5">Start free</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-5 py-20 text-center sm:py-28">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
          AI notes for every meeting
        </p>
        <h1 className="mx-auto max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-[var(--color-heading)] sm:text-6xl">
          Your team never has to take notes again.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--color-text-secondary)]">
          Notti joins your calls, transcribes every word, and sends everyone the minutes — summary,
          decisions and action items — before you&rsquo;ve left the room.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <Link href={cta.href} className="btn-primary px-6 py-3 text-sm">{cta.label}</Link>
          <a href="#how" className="btn-secondary px-6 py-3 text-sm">See how it works</a>
        </div>
        <p className="mt-4 text-xs text-[var(--color-text-muted)]">Free to start · no credit card</p>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-[var(--color-border)] bg-[var(--color-surface)]/40">
        <div className="mx-auto max-w-5xl px-5 py-20">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight text-[var(--color-heading)] sm:text-3xl">
            From call to minutes in three steps
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-border-strong)] font-display text-lg font-bold text-[var(--color-heading)]">
                  {s.n}
                </div>
                <h3 className="mt-4 text-base font-semibold text-[var(--color-heading)]">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-5 py-20">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
              <h3 className="text-base font-semibold text-[var(--color-heading)]">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-3xl px-5 py-20 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-[var(--color-heading)]">
            Give your team its time back.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[var(--color-text-secondary)]">
            Set up your workspace in under two minutes and let Notti handle the notes.
          </p>
          <Link href={cta.href} className="btn-primary mt-8 inline-flex px-6 py-3 text-sm">{cta.label}</Link>
        </div>
      </section>

      <footer className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-[var(--color-text-muted)] sm:flex-row">
          <div className="flex items-center gap-2">
            <NottiMark size={16} />
            <span>Notti</span>
          </div>
          <span>© {new Date().getFullYear()} Notti. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
