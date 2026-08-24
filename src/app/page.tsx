import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { NottiMark } from "@/components/NottiMark";

export const dynamic = "force-dynamic";

// ── Small inline glyphs (stroke = currentColor), 8px-grid sized ──────────────
function Glyph({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
const ICON = {
  bot: "M12 3v3|M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z|M9 13h.01|M15 13h.01|M2 12h2|M20 12h2",
  wave: "M4 12h2l2-6 3 12 3-9 2 6h4",
  sparkle: "M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z",
  users: "M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8|M22 20v-2a4 4 0 0 0-3-3.87|M16 2.13A4 4 0 0 1 16 10",
  lock: "M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z|M8 11V7a4 4 0 0 1 8 0v4",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z|m4 7 8 6 8-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z|m21 21-4.3-4.3",
  check: "M20 6 9 17l-5-5",
  arrow: "M5 12h14|m13 6 6 6-6 6",
} as const;

const PLATFORMS = ["Google Meet", "Zoom", "Microsoft Teams", "Webex"];

const FEATURES = [
  { icon: ICON.bot, title: "It joins the call for you", body: "Notti walks into Google Meet, Zoom or Teams as its own participant — or records right on your device. No screen-share, no extension to install." },
  { icon: ICON.wave, title: "Word-perfect transcripts", body: "Speaker-attributed, timestamped, and searchable the instant the call ends. Skim an hour in thirty seconds." },
  { icon: ICON.sparkle, title: "Minutes that write themselves", body: "A crisp summary, the decisions made, and every action item with an owner — generated and in inboxes before anyone leaves." },
  { icon: ICON.users, title: "One workspace for the team", body: "Invite everyone. Every meeting lives in a shared, private space so nothing depends on who happened to be typing." },
  { icon: ICON.search, title: "Search everything ever said", body: "Find that one commitment from three weeks ago by typing what you remember. The transcript remembers the rest." },
  { icon: ICON.lock, title: "Private by default", body: "Your calls are yours. Each organization is walled off from every other — data never crosses the line." },
];

const STEPS = [
  { n: "01", title: "Add the meeting", body: "Paste a meeting link, or hit record on the spot for the room you're in." },
  { n: "02", title: "Notti listens", body: "It captures the audio and transcribes live, attributing every line to the right voice." },
  { n: "03", title: "Minutes arrive", body: "Summary, decisions and action items land in every attendee's inbox minutes later." },
];

const PLANS = [
  { name: "Free", price: "$0", cadence: "forever", tagline: "For trying it on your next call.",
    features: ["Up to 5 meetings / month", "Live transcription", "AI minutes by email", "1 workspace member"], cta: "Start free", highlight: false },
  { name: "Pro", price: "$18", cadence: "per user / month", tagline: "For teams who meet to decide.",
    features: ["Unlimited meetings", "Meeting bot for Meet / Zoom / Teams", "Action items & decisions", "Full-text search", "Up to 20 members"], cta: "Start 14-day trial", highlight: true },
  { name: "Business", price: "Let's talk", cadence: "custom", tagline: "For organizations at scale.",
    features: ["Everything in Pro", "Unlimited members", "SSO & audit logs", "Priority support", "Custom retention"], cta: "Contact sales", highlight: false },
];

const FAQ = [
  { q: "Does everyone on the call know it's being recorded?", a: "Yes. Notti joins as a visible, named participant with its own on-screen tile — never a hidden listener. You control the name it shows up as." },
  { q: "Which meeting tools does it work with?", a: "Google Meet, Zoom, Microsoft Teams and Webex out of the box. No meeting link? Record on-device and Notti runs the same transcription and minutes." },
  { q: "How accurate are the notes?", a: "Transcripts are speaker-attributed and highly accurate; the minutes are generated from the full transcript, not a lossy summary, so decisions and action items reflect what was actually said." },
  { q: "Is my data private?", a: "Every organization is fully isolated — one customer can never see another's meetings. Your recordings, transcripts and minutes belong to you." },
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  const primary = user ? { href: "/meetings", label: "Open your workspace" } : { href: "/register", label: "Start free" };

  return (
    <div className="relative">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[rgba(24,24,24,0.72)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="brand-gradient flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-heading)]">
              <NottiMark size={18} />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight text-[var(--color-heading)]">Notti</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-[var(--color-text-secondary)] md:flex">
            <a href="#features" className="transition-colors hover:text-[var(--color-heading)]">Features</a>
            <a href="#how" className="transition-colors hover:text-[var(--color-heading)]">How it works</a>
            <a href="#pricing" className="transition-colors hover:text-[var(--color-heading)]">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-[var(--color-heading)]">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Link href="/meetings" className="btn-primary px-4 py-1.5">Open app</Link>
            ) : (
              <>
                <Link href="/login" className="hidden px-3.5 py-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-heading)] sm:inline">Sign in</Link>
                <Link href="/register" className="btn-primary px-4 py-1.5">Start free</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-5 pt-20 pb-16 sm:pt-28">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="rise ai-chip" style={{ animationDelay: "0ms" }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ai-cyan)]" />
              Meets · Zoom · Teams · on-device
            </div>
            <h1 className="rise mt-6 font-display text-[2.75rem] font-bold leading-[1.02] tracking-tight text-[var(--color-heading)] sm:text-6xl"
              style={{ animationDelay: "60ms" }}>
              Every meeting,{" "}
              <span className="ai-text">remembered</span>{" "}
              for you.
            </h1>
            <p className="rise mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-text-secondary)]"
              style={{ animationDelay: "120ms" }}>
              Notti joins your calls, transcribes every word, and writes the minutes —
              summary, decisions and action items — before you&rsquo;ve left the room.
              Your team never takes notes again.
            </p>
            <div className="rise mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: "180ms" }}>
              <Link href={primary.href} className="btn-primary px-6 py-3 text-[15px]">
                {primary.label}
                <span className="text-[var(--color-text-muted)]"><Glyph d={ICON.arrow} size={16} /></span>
              </Link>
              <a href="#how" className="btn-secondary px-6 py-3 text-[15px]">See how it works</a>
            </div>
            <p className="rise mt-4 flex items-center gap-2 text-xs text-[var(--color-text-muted)]" style={{ animationDelay: "220ms" }}>
              <Glyph d={ICON.check} size={14} /> Free to start &middot; no credit card &middot; set up in two minutes
            </p>
          </div>

          {/* Hero product visual — a live "minutes" card, built, not stock. */}
          <HeroCard />
        </div>

        {/* Platform strip */}
        <div className="mt-20 border-t border-[var(--color-border)] pt-8">
          <p className="text-center text-xs uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
            Captures every call, wherever it happens
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {PLATFORMS.map((p) => (
              <span key={p} className="font-display text-lg font-semibold tracking-tight text-[var(--color-text-muted)]">{p}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features (bento) ────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
        <SectionHead eyebrow="What it does" title={<>Notes were never the point.<br />The meeting was.</>}
          sub="Notti takes the one job nobody wants and does it perfectly, every time — so the room can stay in the conversation." />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div key={f.title}
              className={`card card-hover group p-6 ${i === 0 ? "sm:col-span-2 lg:col-span-1" : ""}`}>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-muted-surface)] text-[var(--color-heading)] transition-colors group-hover:border-[var(--color-border-strong)]">
                <Glyph d={f.icon} />
              </div>
              <h3 className="mt-5 text-[15px] font-semibold text-[var(--color-heading)]">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how" className="border-y border-[var(--color-border)] bg-[var(--color-surface)]/30">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <SectionHead eyebrow="How it works" title={<>From &ldquo;let&rsquo;s hop on a call&rdquo; to minutes in your inbox.</>}
            sub="Three steps, and only the first one is yours." />
          <div className="mt-16 grid gap-10 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative">
                {i < STEPS.length - 1 && (
                  <div className="absolute left-14 top-6 hidden h-px w-[calc(100%-2rem)] bg-gradient-to-r from-[var(--color-border-strong)] to-transparent md:block" />
                )}
                <div className="ai-text font-display text-3xl font-bold">{s.n}</div>
                <h3 className="mt-4 text-base font-semibold text-[var(--color-heading)]">{s.title}</h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--color-text-secondary)]">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Minutes showcase ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <span className="ai-chip"><Glyph d={ICON.sparkle} size={13} /> Generated, not templated</span>
            <h2 className="mt-6 font-display text-3xl font-bold leading-tight tracking-tight text-[var(--color-heading)] sm:text-4xl">
              The kind of minutes you&rsquo;d have written — if you had the time.
            </h2>
            <p className="mt-5 text-[var(--color-text-secondary)] leading-relaxed">
              Not a wall of transcript. A clean read: what was decided, who owns what, and what
              happens next — pulled from the full conversation, then sent to everyone who was there.
            </p>
            <ul className="mt-7 space-y-3">
              {["A 3-sentence summary anyone can skim","Every decision, in plain language","Action items with an owner and a due date","The full searchable transcript, one click away"].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-[var(--color-text-primary)]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted-surface)] text-[var(--ai-cyan)]"><Glyph d={ICON.check} size={13} /></span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <MinutesCard />
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section id="pricing" className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <SectionHead eyebrow="Pricing" title="Simple pricing that scales with your team."
            sub="Start free. Upgrade when Notti has already paid for itself in meetings you didn't have to write up." />
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.name}
                className={`relative flex flex-col rounded-2xl p-7 ${p.highlight ? "ai-border bg-[var(--color-surface)]" : "card"}`}>
                {p.highlight && (
                  <span className="absolute -top-3 left-7 ai-chip">Most popular</span>
                )}
                <div className="text-sm font-semibold text-[var(--color-heading)]">{p.name}</div>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">{p.tagline}</p>
                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="font-display text-4xl font-bold tracking-tight text-[var(--color-heading)]">{p.price}</span>
                  <span className="text-sm text-[var(--color-text-muted)]">/ {p.cadence}</span>
                </div>
                <Link href={user ? "/meetings" : "/register"}
                  className={`mt-6 w-full ${p.highlight ? "btn-ai" : "btn-secondary"} justify-center py-2.5`}>
                  {p.cta}
                </Link>
                <ul className="mt-7 space-y-3 border-t border-[var(--color-border)] pt-6">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-[var(--color-text-secondary)]">
                      <span className="mt-0.5 text-[var(--ai-cyan)]"><Glyph d={ICON.check} size={14} /></span>{f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section id="faq" className="border-t border-[var(--color-border)] bg-[var(--color-surface)]/30">
        <div className="mx-auto max-w-3xl px-5 py-20 sm:py-28">
          <SectionHead eyebrow="Questions" title="Everything you might be wondering." sub="" />
          <div className="mt-12 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-[var(--color-heading)]">
                  {f.q}
                  <span className="shrink-0 text-[var(--color-text-muted)] transition-transform group-open:rotate-45">
                    <Glyph d="M12 5v14|M5 12h14" size={18} />
                  </span>
                </summary>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-text-secondary)]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-[var(--color-border)]">
        <div className="ai-glow pointer-events-none absolute left-1/2 top-0 h-64 w-[42rem] -translate-x-1/2 opacity-40" />
        <div className="relative mx-auto max-w-3xl px-5 py-24 text-center sm:py-28">
          <div className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-heading)]">
            <NottiMark size={28} />
          </div>
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-[var(--color-heading)] sm:text-5xl">
            Give your team back the meeting.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-[var(--color-text-secondary)]">
            Set up your workspace in under two minutes and let Notti handle the notes — starting with your next call.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3">
            <Link href={primary.href} className="btn-primary px-7 py-3 text-[15px]">{primary.label}</Link>
            <Link href="/login" className="btn-secondary px-7 py-3 text-[15px]">Sign in</Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-5 py-10 sm:flex-row">
          <div className="flex items-center gap-2.5 text-[var(--color-text-secondary)]">
            <NottiMark size={18} />
            <span className="font-display font-semibold text-[var(--color-heading)]">Notti</span>
            <span className="text-sm text-[var(--color-text-muted)]">— AI notes for every meeting</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-[var(--color-text-muted)]">
            <a href="#features" className="hover:text-[var(--color-heading)]">Features</a>
            <a href="#pricing" className="hover:text-[var(--color-heading)]">Pricing</a>
            <Link href="/login" className="hover:text-[var(--color-heading)]">Sign in</Link>
          </div>
          <span className="text-xs text-[var(--color-text-faint)]">© {new Date().getFullYear()} Notti</span>
        </div>
      </footer>
    </div>
  );
}

// ── Section heading ──────────────────────────────────────────────────────────
function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: React.ReactNode; sub: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 font-display text-3xl font-bold leading-[1.1] tracking-tight text-[var(--color-heading)] sm:text-[2.5rem]">{title}</h2>
      {sub && <p className="mx-auto mt-4 max-w-xl text-[var(--color-text-secondary)]">{sub}</p>}
    </div>
  );
}

// ── Hero product card — a live capture in progress ───────────────────────────
function HeroCard() {
  const bars = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  return (
    <div className="rise relative" style={{ animationDelay: "160ms" }}>
      <div className="ai-glow pointer-events-none absolute -inset-8 opacity-60" />
      <div className="float-slow card relative overflow-hidden p-1.5">
        {/* window chrome */}
        <div className="flex items-center gap-1.5 px-3 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-elevated)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-elevated)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-elevated)]" />
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Recording
          </span>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5">
          {/* bot tile + equalizer */}
          <div className="flex items-center gap-3">
            <div className="brand-gradient flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-heading)]">
              <NottiMark size={22} />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-[var(--color-heading)]">Q3 Planning · Product</div>
              <div className="text-[11px] text-[var(--color-text-muted)]">4 participants · 12:04</div>
            </div>
            <div className="flex h-8 items-end gap-[3px]">
              {bars.map((b) => (
                <span key={b} className="eq-bar w-[3px] rounded-full bg-gradient-to-t from-[var(--ai-indigo)] to-[var(--ai-cyan)]"
                  style={{ height: "100%", animationDelay: `${(b % 6) * 90}ms` }} />
              ))}
            </div>
          </div>

          {/* live transcript */}
          <div className="mt-5 space-y-3">
            {[
              { s: "Priya", c: "Let's lock the launch for the 14th.", accent: true },
              { s: "Marcus", c: "Works — I'll own the release notes." },
              { s: "Ana", c: "Design hands off Friday, so we're clear." },
            ].map((l) => (
              <div key={l.s} className="flex gap-2.5">
                <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${l.accent ? "bg-[var(--color-elevated)] text-[var(--ai-cyan)]" : "bg-[var(--color-muted-surface)] text-[var(--color-text-muted)]"}`}>{l.s}</span>
                <span className="text-[13px] leading-relaxed text-[var(--color-text-primary)]">{l.c}</span>
              </div>
            ))}
          </div>

          {/* generated action item */}
          <div className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
            <div className="flex items-center gap-2">
              <span className="ai-chip"><span className="h-1.5 w-1.5 rounded-full bg-[var(--ai-cyan)]" /> Action item</span>
              <span className="text-[11px] text-[var(--color-text-muted)]">auto-captured</span>
            </div>
            <p className="mt-2 text-[13px] text-[var(--color-heading)]">
              <span className="font-medium">Marcus</span> — draft release notes for the July 14 launch
              <span className="text-[var(--color-text-muted)]"> · due Fri</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Minutes output card ──────────────────────────────────────────────────────
function MinutesCard() {
  return (
    <div className="card relative overflow-hidden p-7">
      <div className="ai-glow pointer-events-none absolute -right-16 -top-16 h-48 w-48 opacity-40" />
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-[var(--color-heading)]">Q3 Planning · Product</div>
          <div className="text-xs text-[var(--color-text-muted)]">Tue 8 Jul · 32 min · 4 attendees</div>
        </div>
        <span className="ai-chip">Minutes</span>
      </div>

      <div className="mt-6 space-y-6 text-sm">
        <div>
          <div className="eyebrow mb-2">Summary</div>
          <p className="leading-relaxed text-[var(--color-text-primary)]">
            The team set the launch date and split ownership across release notes and design handoff.
            Scope is locked; no blockers raised.
          </p>
        </div>
        <div>
          <div className="eyebrow mb-2">Decisions</div>
          <ul className="space-y-1.5 text-[var(--color-text-primary)]">
            <li className="flex gap-2"><span className="text-[var(--ai-cyan)]">•</span> Launch confirmed for July 14</li>
            <li className="flex gap-2"><span className="text-[var(--ai-cyan)]">•</span> Scope frozen — no new features this cycle</li>
          </ul>
        </div>
        <div>
          <div className="eyebrow mb-2">Action items</div>
          <div className="space-y-2">
            {[
              { who: "Marcus", what: "Draft release notes", due: "Fri" },
              { who: "Ana", what: "Design handoff", due: "Fri" },
              { who: "Priya", what: "Send launch comms", due: "Jul 12" },
            ].map((a) => (
              <div key={a.who} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
                <span className="rounded-md bg-[var(--color-muted-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">{a.who}</span>
                <span className="flex-1 text-[13px] text-[var(--color-heading)]">{a.what}</span>
                <span className="text-[11px] text-[var(--color-text-muted)]">{a.due}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
