import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { NottiMark } from "@/components/NottiMark";

export const dynamic = "force-dynamic";

function G({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
const I = {
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  wave: "M4 12h2l2-6 3 12 3-9 2 6h4",
  doc: "M8 3h6l4 4v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z|M14 3v4h4|M9.5 13h6|M9.5 16.5h6",
  users: "M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8|M22 20v-2a4 4 0 0 0-3-3.87|M16 2.13A4 4 0 0 1 16 10",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z|m21 21-4.3-4.3",
  shield: "M12 3l7 3v6c0 4.4-3 7.5-7 9-4-1.5-7-4.6-7-9V6l7-3Z|m9 12 2 2 4-4",
  check: "M20 6 9 17l-5-5",
  arrow: "M5 12h14|m13 6 6 6-6 6",
  plus: "M12 5v14|M5 12h14",
};

const PLATFORMS = ["Google Meet", "Zoom", "Microsoft Teams", "Webex"];

const STEPS = [
  { n: "1", t: "Add the meeting", b: "Paste a meeting link, or hit record for the room you're in. Nothing to install." },
  { n: "2", t: "Notti joins & listens", b: "It shows up as its own participant, captures the audio and transcribes live." },
  { n: "3", t: "Get your notes", b: "Summary, decisions and action items land in every attendee's inbox, minutes later." },
];

const VALUES = [
  { icon: I.bolt, t: "Zero setup", b: "No extension, no plugin. Paste a link and Notti is in the call." },
  { icon: I.search, t: "Instantly searchable", b: "Find any moment across every meeting by typing what you remember." },
  { icon: I.users, t: "Made for teams", b: "One shared workspace — notes never depend on who was typing." },
  { icon: I.shield, t: "Private by default", b: "Each organization is fully walled off. Your calls stay yours." },
];

const PLANS = [
  { name: "Free", price: "$0", per: "forever", tag: "For your next call.",
    feats: ["Up to 5 meetings / month", "Live transcription", "AI notes by email", "1 member"], cta: "Start free", hot: false },
  { name: "Pro", price: "$18", per: "per user / mo", tag: "For teams who meet to decide.",
    feats: ["Unlimited meetings", "Bot for Meet, Zoom & Teams", "Decisions & action items", "Full-text search", "Up to 20 members"], cta: "Start free trial", hot: true },
  { name: "Business", price: "Custom", per: "let's talk", tag: "For organizations at scale.",
    feats: ["Everything in Pro", "Unlimited members", "SSO & audit logs", "Priority support"], cta: "Contact sales", hot: false },
];

const FAQ = [
  { q: "Does everyone know it's being recorded?", a: "Yes — Notti joins as a visible, named participant with its own tile, never a hidden listener. You choose the name it shows up as." },
  { q: "Which meeting tools does it work with?", a: "Google Meet, Zoom, Microsoft Teams and Webex out of the box. No link? Record on-device and you get the same transcription and notes." },
  { q: "How accurate are the notes?", a: "Transcripts are speaker-attributed and highly accurate, and the notes are generated from the full transcript — so decisions and action items reflect what was actually said." },
  { q: "Is my data private?", a: "Every organization is completely isolated. One customer can never see another's meetings, and your recordings and notes belong to you." },
];

export default async function Landing() {
  const user = await getCurrentUser();
  const cta = user ? { href: "/meetings", label: "Open your workspace" } : { href: "/register", label: "Start for free" };

  return (
    <div className="site-light">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-[var(--l-border)] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: "var(--l-grad)" }}>
              <NottiMark size={18} />
            </span>
            <span className="text-lg font-bold tracking-tight text-[var(--l-heading)]">Notti</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-[var(--l-text)] md:flex">
            <a href="#features" className="hover:text-[var(--l-heading)]">Features</a>
            <a href="#how" className="hover:text-[var(--l-heading)]">How it works</a>
            <a href="#pricing" className="hover:text-[var(--l-heading)]">Pricing</a>
            <a href="#faq" className="hover:text-[var(--l-heading)]">FAQ</a>
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <Link href="/meetings" className="l-btn-primary px-4 py-2 text-sm">Open app</Link>
            ) : (
              <>
                <Link href="/login" className="hidden text-sm font-semibold text-[var(--l-heading)] hover:text-[var(--l-accent)] sm:inline">Log in</Link>
                <Link href="/register" className="l-btn-primary px-4 py-2 text-sm">Start for free</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="aura h-[26rem] w-[26rem]" style={{ background: "#c7d2fe", top: "-6rem", left: "-4rem" }} />
        <div className="aura h-[24rem] w-[24rem]" style={{ background: "#ddd6fe", top: "-3rem", right: "-4rem" }} />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pt-20 pb-16 lg:grid-cols-[1.02fr_0.98fr] lg:pt-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--l-border)] bg-white px-3 py-1 text-xs font-medium text-[var(--l-text)] shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--l-accent)]" /> Meets · Zoom · Teams · on-device
            </span>
            <h1 className="mt-6 text-[2.75rem] font-extrabold leading-[1.03] tracking-tight text-[var(--l-heading)] sm:text-[3.75rem]">
              Never take<br />meeting notes<br /><span className="l-grad-text">again.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-[var(--l-text)]">
              Notti joins your calls, transcribes every word, and writes the notes —
              summary, decisions and action items — before you&rsquo;ve left the room.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={cta.href} className="l-btn-primary px-6 py-3 text-[15px]">
                {cta.label} <G d={I.arrow} size={17} />
              </Link>
              <a href="#how" className="l-btn-ghost px-6 py-3 text-[15px]">See how it works</a>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-[var(--l-muted)]">
              <span className="text-[var(--l-accent)]"><G d={I.check} size={16} /></span>
              Free to start · no credit card · ready in two minutes
            </p>
          </div>
          <HeroMock />
        </div>
      </section>

      {/* Integration strip */}
      <section className="border-y border-[var(--l-border)] bg-[var(--l-bg-soft)]">
        <div className="mx-auto max-w-6xl px-5 py-8">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-[var(--l-muted)]">
            Captures every call, wherever it happens
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
            {PLATFORMS.map((p) => (
              <span key={p} className="text-lg font-bold tracking-tight text-[#9aa3b2]">{p}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Feature A — transcript */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <p className="l-eyebrow">Live transcription</p>
            <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-[var(--l-heading)] sm:text-[2.5rem]">
              Every word, captured and attributed.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-[var(--l-text)]">
              Notti transcribes the whole conversation as it happens — each line tagged to the right
              speaker, timestamped, and searchable the instant the call ends. Skim an hour in seconds.
            </p>
            <ul className="mt-7 space-y-3">
              {["Speaker-attributed, in real time", "Searchable across every meeting", "No plugin — it just joins the call"].map((t) => (
                <li key={t} className="flex items-center gap-3 text-[15px] text-[var(--l-heading)]">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--l-accent-soft)] text-[var(--l-accent)]"><G d={I.check} size={14} /></span>{t}
                </li>
              ))}
            </ul>
          </div>
          <TranscriptMock />
        </div>
      </section>

      {/* Feature B — minutes */}
      <section className="bg-[var(--l-bg-soft)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <div className="grid items-center gap-14 lg:grid-cols-2">
            <MinutesMock />
            <div className="lg:order-2">
              <p className="l-eyebrow">AI notes</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-[var(--l-heading)] sm:text-[2.5rem]">
                The notes you&rsquo;d have written — if you had the time.
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-[var(--l-text)]">
                Not a wall of transcript. A clean read: what was decided, who owns what, and what
                happens next — pulled from the full conversation and emailed to everyone who was there.
              </p>
              <ul className="mt-7 space-y-3">
                {["A summary anyone can skim", "Every decision, in plain language", "Action items with an owner and a due date"].map((t) => (
                  <li key={t} className="flex items-center gap-3 text-[15px] text-[var(--l-heading)]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--l-accent-soft)] text-[var(--l-accent)]"><G d={I.check} size={14} /></span>{t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Value grid */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <p className="l-eyebrow">Why teams switch</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-[var(--l-heading)] sm:text-[2.5rem]">Built to disappear into your day.</h2>
        </div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map((v) => (
            <div key={v.t} className="l-card p-6 transition-transform hover:-translate-y-1">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--l-accent)]" style={{ background: "var(--l-accent-soft)" }}>
                <G d={v.icon} />
              </div>
              <h3 className="mt-5 text-base font-bold text-[var(--l-heading)]">{v.t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--l-text)]">{v.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-[var(--l-border)] bg-[var(--l-bg-soft)]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <p className="l-eyebrow">How it works</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-[var(--l-heading)] sm:text-[2.5rem]">From call to notes in three steps.</h2>
            <p className="mt-4 text-lg text-[var(--l-text)]">And only the first one is yours.</p>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="l-card p-7 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: "var(--l-grad)" }}>{s.n}</div>
                <h3 className="mt-5 text-lg font-bold text-[var(--l-heading)]">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--l-text)]">{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <p className="l-eyebrow">Pricing</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-[var(--l-heading)] sm:text-[2.5rem]">Simple pricing that scales with your team.</h2>
          <p className="mt-4 text-lg text-[var(--l-text)]">Start free. Upgrade once Notti has already saved you a meeting&rsquo;s worth of writing.</p>
        </div>
        <div className="mt-14 grid items-start gap-6 lg:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name}
              className={`relative rounded-2xl p-7 ${p.hot ? "text-white shadow-2xl shadow-indigo-500/20" : "l-card"}`}
              style={p.hot ? { background: "var(--l-grad-cta)" } : undefined}>
              {p.hot && <span className="absolute -top-3 left-7 rounded-full bg-white px-3 py-1 text-xs font-bold text-[var(--l-accent)] shadow-sm">Most popular</span>}
              <div className={`text-sm font-bold ${p.hot ? "text-white" : "text-[var(--l-heading)]"}`}>{p.name}</div>
              <p className={`mt-1 text-sm ${p.hot ? "text-indigo-100" : "text-[var(--l-muted)]"}`}>{p.tag}</p>
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className={`text-4xl font-extrabold tracking-tight ${p.hot ? "text-white" : "text-[var(--l-heading)]"}`}>{p.price}</span>
                <span className={`text-sm ${p.hot ? "text-indigo-100" : "text-[var(--l-muted)]"}`}>/ {p.per}</span>
              </div>
              <Link href={user ? "/meetings" : "/register"}
                className={`mt-6 flex w-full justify-center rounded-xl px-4 py-2.5 text-sm font-semibold ${p.hot ? "bg-white text-[var(--l-accent)] hover:bg-indigo-50" : "l-btn-primary"}`}>
                {p.cta}
              </Link>
              <ul className={`mt-7 space-y-3 border-t pt-6 ${p.hot ? "border-white/20" : "border-[var(--l-border)]"}`}>
                {p.feats.map((f) => (
                  <li key={f} className={`flex items-start gap-2.5 text-sm ${p.hot ? "text-indigo-50" : "text-[var(--l-text)]"}`}>
                    <span className={p.hot ? "text-white" : "text-[var(--l-accent)]"}><G d={I.check} size={15} /></span>{f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-[var(--l-border)] bg-[var(--l-bg-soft)]">
        <div className="mx-auto max-w-3xl px-5 py-20 sm:py-28">
          <div className="text-center">
            <p className="l-eyebrow">Questions</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-[var(--l-heading)] sm:text-[2.5rem]">Good questions, answered.</h2>
          </div>
          <div className="mt-12 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group l-card px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-[var(--l-heading)]">
                  {f.q}
                  <span className="shrink-0 text-[var(--l-accent)] transition-transform group-open:rotate-45"><G d={I.plus} size={18} /></span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-[var(--l-text)]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="relative overflow-hidden rounded-3xl px-6 py-16 text-center sm:py-20" style={{ background: "var(--l-grad-cta)" }}>
          <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -left-16 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur"><NottiMark size={28} /></div>
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-[2.75rem]">Give your team back the meeting.</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-indigo-100">Set up your workspace in two minutes and let Notti handle the notes — starting with your next call.</p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Link href={cta.href} className="rounded-xl bg-white px-7 py-3 text-[15px] font-semibold text-[var(--l-accent)] shadow-sm transition-transform hover:-translate-y-0.5">{cta.label}</Link>
              <Link href="/login" className="rounded-xl border border-white/40 px-7 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-white/10">Log in</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--l-border)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-5 py-10 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md text-white" style={{ background: "var(--l-grad)" }}><NottiMark size={15} /></span>
            <span className="font-bold text-[var(--l-heading)]">Notti</span>
            <span className="text-sm text-[var(--l-muted)]">— AI notes for every meeting</span>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium text-[var(--l-text)]">
            <a href="#features" className="hover:text-[var(--l-accent)]">Features</a>
            <a href="#pricing" className="hover:text-[var(--l-accent)]">Pricing</a>
            <Link href="/login" className="hover:text-[var(--l-accent)]">Log in</Link>
          </div>
          <span className="text-xs text-[var(--l-muted)]">© {new Date().getFullYear()} Notti</span>
        </div>
      </footer>
    </div>
  );
}

// ── Hero mock: app window with a live capture ────────────────────────────────
function HeroMock() {
  const bars = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <div className="relative">
      <div className="aura h-72 w-72" style={{ background: "#a5b4fc", right: "2rem", top: "2rem", opacity: 0.4 }} />
      <div className="l-card float-slow relative overflow-hidden p-2 shadow-2xl shadow-indigo-500/10">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#e5e8ef]" /><span className="h-2.5 w-2.5 rounded-full bg-[#e5e8ef]" /><span className="h-2.5 w-2.5 rounded-full bg-[#e5e8ef]" />
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-[var(--l-muted)]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Recording</span>
        </div>
        <div className="rounded-xl bg-[var(--l-bg-soft)] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: "var(--l-grad)" }}><NottiMark size={20} /></div>
            <div className="flex-1">
              <div className="text-sm font-bold text-[var(--l-heading)]">Q3 Planning · Product</div>
              <div className="text-[11px] text-[var(--l-muted)]">4 participants · 12:04</div>
            </div>
            <div className="flex h-7 items-end gap-[3px]">
              {bars.map((b) => (
                <span key={b} className="eq-bar w-[3px] rounded-full" style={{ height: "100%", background: "var(--l-accent)", animationDelay: `${(b % 5) * 100}ms` }} />
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-2.5">
            {[{ s: "Priya", c: "Let's lock the launch for the 14th.", a: true }, { s: "Marcus", c: "Works — I'll own the release notes.", a: false }].map((l) => (
              <div key={l.s} className="flex gap-2.5">
                <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${l.a ? "bg-[var(--l-accent-soft)] text-[var(--l-accent)]" : "bg-white text-[var(--l-muted)]"}`}>{l.s}</span>
                <span className="text-[13px] leading-relaxed text-[var(--l-heading)]">{l.c}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-[var(--l-border)] bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: "var(--l-grad)" }}>Action item</span>
              <span className="text-[11px] text-[var(--l-muted)]">auto-captured</span>
            </div>
            <p className="mt-2 text-[13px] text-[var(--l-heading)]"><span className="font-semibold">Marcus</span> — draft release notes<span className="text-[var(--l-muted)]"> · due Fri</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Transcript mock ──────────────────────────────────────────────────────────
function TranscriptMock() {
  const lines = [
    { s: "Priya", c: "Let's lock the launch for the 14th — anyone blocked?", a: true },
    { s: "Marcus", c: "All clear. I'll own the release notes.", a: false },
    { s: "Ana", c: "Design hands off Friday, so we're good.", a: false },
    { s: "Priya", c: "Perfect. I'll send the comms Monday.", a: true },
  ];
  return (
    <div className="relative">
      <div className="aura h-64 w-64" style={{ background: "#ddd6fe", left: "1rem", top: "1rem", opacity: 0.4 }} />
      <div className="l-card relative p-5 shadow-xl shadow-indigo-500/5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-bold text-[var(--l-heading)]">Live transcript</span>
          <span className="rounded-full bg-[var(--l-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--l-accent)]">32:04</span>
        </div>
        <div className="space-y-3.5">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-3">
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${l.a ? "text-white" : "bg-[var(--l-bg-soft)] text-[var(--l-muted)]"}`} style={l.a ? { background: "var(--l-grad)" } : undefined}>{l.s[0]}</span>
              <div>
                <div className="text-[11px] font-semibold text-[var(--l-muted)]">{l.s}</div>
                <div className="text-[13.5px] leading-relaxed text-[var(--l-heading)]">{l.c}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Minutes mock ─────────────────────────────────────────────────────────────
function MinutesMock() {
  return (
    <div className="relative">
      <div className="aura h-64 w-64" style={{ background: "#c7d2fe", right: "1rem", bottom: "1rem", opacity: 0.4 }} />
      <div className="l-card relative p-6 shadow-xl shadow-indigo-500/5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-[var(--l-heading)]">Q3 Planning · Product</div>
            <div className="text-xs text-[var(--l-muted)]">Tue 8 Jul · 32 min · 4 attendees</div>
          </div>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: "var(--l-grad)" }}>Notes</span>
        </div>
        <div className="mt-6 space-y-5 text-sm">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--l-muted)]">Summary</div>
            <p className="mt-1.5 leading-relaxed text-[var(--l-text)]">The team set the launch date and split ownership across release notes and design handoff. Scope is locked; no blockers.</p>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--l-muted)]">Action items</div>
            <div className="mt-2 space-y-2">
              {[{ w: "Marcus", t: "Draft release notes", d: "Fri" }, { w: "Ana", t: "Design handoff", d: "Fri" }, { w: "Priya", t: "Send launch comms", d: "Mon" }].map((a) => (
                <div key={a.w} className="flex items-center gap-3 rounded-lg bg-[var(--l-bg-soft)] px-3 py-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--l-accent-soft)] text-[10px] font-bold text-[var(--l-accent)]">{a.w[0]}</span>
                  <span className="flex-1 text-[13px] font-medium text-[var(--l-heading)]">{a.t}</span>
                  <span className="text-[11px] text-[var(--l-muted)]">{a.d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
