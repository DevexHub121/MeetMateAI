import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import Image from "next/image";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { FaqList } from "@/components/landing/FaqList";
import { MeetMateMark } from "@/components/MeetMateMark";

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
  { n: "2", t: "MeetMate joins & listens", b: "It shows up as its own participant, captures the audio and transcribes live." },
  { n: "3", t: "Get your notes", b: "Summary, decisions and action items land in every attendee's inbox, minutes later." },
];

const VALUES = [
  { icon: I.bolt, t: "Zero setup", b: "No extension, no plugin. Paste a link and MeetMate is in the call." },
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
  { q: "Does everyone know it's being recorded?", a: "Yes — MeetMate joins as a visible, named participant with its own tile, never a hidden listener. You choose the name it shows up as." },
  { q: "Which meeting tools does it work with?", a: "Google Meet, Zoom, Microsoft Teams and Webex out of the box. No link? Record on-device and you get the same transcription and notes." },
  { q: "How accurate are the notes?", a: "Transcripts are speaker-attributed and highly accurate, and the notes are generated from the full transcript — so decisions and action items reflect what was actually said." },
  { q: "Is my data private?", a: "Every organization is completely isolated. One customer can never see another's meetings, and your recordings and notes belong to you." },
];

export default async function Landing() {
  const user = await getCurrentUser();
  const cta = user ? { href: "/meetings", label: "Open your workspace" } : { href: "/register", label: "Start for free" };

  return (
    <div className="site-light">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 border-b border-[var(--l-border)]"
        style={{ background: "rgba(247,246,242,.88)", backdropFilter: "blur(14px)" }}
      >
        <div className="flex items-center justify-between gap-6" style={{ padding: "14px var(--l-pad)" }}>
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <Image src="/brand/meetmate-mark.png" alt="" width={47} height={36} className="h-9 w-auto" priority />
            <Image src="/brand/meetmate-wordmark.png" alt="MeetMate" width={137} height={22} className="h-[22px] w-auto" priority />
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {[["#how", "How it works"], ["#features", "Features"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
              <a key={href} href={href} className="rounded-full px-3.5 py-2 text-[14px] font-medium text-[var(--l-text)] transition-colors hover:bg-[rgba(15,29,69,.06)]">
                {label}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {!user && (
              <Link href="/login" className="hidden rounded-full px-4 py-2 text-[14px] font-semibold text-[var(--l-heading)] transition-colors hover:bg-[rgba(15,29,69,.06)] sm:inline-block">
                Log in
              </Link>
            )}
            <Link href={cta.href} className="l-btn-primary px-4.5 py-2.5 text-[14px]">{cta.label}</Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section
        className="flex flex-wrap items-center gap-[clamp(32px,4vw,72px)]"
        style={{ paddingLeft: "var(--l-pad)", paddingTop: "clamp(56px,6vw,104px)", paddingBottom: "clamp(56px,6vw,104px)" }}
      >
        <div style={{ flex: "1 1 440px", maxWidth: 760 }}>
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-[var(--l-text)]" style={{ boxShadow: "var(--l-shadow-small)" }}>
            <span className="blink h-1.5 w-1.5 rounded-full bg-[#ef4444]" /> Meets · Zoom · Teams · on-device
          </span>

          <h1 className="mt-6 font-[family-name:var(--font-display)] font-bold text-[var(--l-heading)]" style={{ fontSize: "clamp(52px,5.8vw,128px)", lineHeight: 0.98, letterSpacing: "-0.03em" }}>
            Stop taking notes.<br />
            <span className="text-[var(--l-violet)]">Let me handle it.</span>
          </h1>

          <p className="mt-6 font-[family-name:var(--font-display)] text-[22px] font-semibold text-[var(--l-heading)]">
            Your AI meeting memory.
          </p>
          {/* Record → Understand → Remember: blue for the part you do, violet
              for the parts we do. The arrows carry the same rule. */}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--l-heading)]">
            Record <span className="text-[var(--l-blue)]">→</span> Understand{" "}
            <span className="text-[var(--l-violet)]">→</span> Remember
          </p>

          <p className="mt-6 max-w-xl leading-relaxed text-[var(--l-text)]" style={{ fontSize: "clamp(17px,1.2vw,20px)", lineHeight: 1.6 }}>
            MeetMate joins your calls, transcribes every word, and writes the notes —
            summary, decisions and action items — before you&rsquo;ve left the room.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={cta.href} className="l-btn-primary px-6 py-3.5 text-[15px]">
              {cta.label} <G d={I.arrow} size={17} />
            </Link>
            <a href="#how" className="l-btn-ghost px-6 py-3.5 text-[15px]">See how it works</a>
          </div>
          <p className="mt-4 text-[14px] text-[var(--l-muted)]">
            Free to start · no credit card · ready in two minutes
          </p>
        </div>

        <div style={{ flex: "1.35 1 620px", minWidth: 0 }}>
          <HeroDemo />
        </div>
      </section>

      {/* ── Platforms ──────────────────────────────────────────────── */}
      <section className="border-y border-[var(--l-border)]">
        <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4" style={{ padding: "26px var(--l-pad)" }}>
          <span className="text-[14px] text-[var(--l-muted)]">Captures every call, wherever it happens</span>
          <div className="flex flex-wrap items-center gap-x-9 gap-y-3">
            {PLATFORMS.map((p) => (
              <span key={p} className="font-[family-name:var(--font-display)] text-[17px] font-semibold text-[var(--l-heading)]">{p}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────── */}
      <section id="how" style={{ padding: "var(--l-section-y) var(--l-pad)" }}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 className="font-[family-name:var(--font-display)] font-bold text-[var(--l-heading)]" style={{ fontSize: "clamp(40px,4.4vw,84px)", lineHeight: 1, letterSpacing: "-0.03em" }}>
            Three steps.
          </h2>
          <p className="text-[17px] text-[var(--l-text)]">
            And only the first one is <span className="font-semibold text-[var(--l-blue-ink)]">yours</span>.
          </p>
        </div>

        <div className="mt-12 grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {STEPS.map((s, i) => (
            <article key={s.n} className="overflow-hidden rounded-[28px] bg-white" style={{ border: "1px solid var(--l-border)" }}>
              <div className="grid min-h-[210px] place-items-center p-6" style={{ background: i === 0 ? "var(--l-blue-tint)" : "var(--l-violet-tint)" }}>
                {i === 0 && (
                  <div className="flex w-full max-w-[300px] items-center gap-2 rounded-full bg-white p-1.5 pl-4" style={{ boxShadow: "var(--l-shadow-small)" }}>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-[var(--l-text)]">meet.google.com/qdr-kxyz-fmn</span>
                    <span className="rounded-full bg-[var(--l-heading)] px-3.5 py-1.5 text-[12.5px] font-semibold text-white">Add</span>
                  </div>
                )}
                {i === 1 && (
                  <div className="w-full max-w-[300px] space-y-2.5">
                    <div className="flex items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5" style={{ boxShadow: "var(--l-shadow-small)" }}>
                      {/* Dark tile, so the drawn mark in white rather than the
                          navy PNG, which would vanish into it. */}
                      <span className="ring-pulse grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#2b2070] text-white">
                        <MeetMateMark size={18} mono />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--l-heading)]">MeetMate <span className="font-normal text-[var(--l-muted)]">joined the call</span></span>
                      <span className="flex items-end gap-[2px]" aria-hidden>
                        {[7, 11, 8].map((h, k) => (
                          <span key={k} className="eq-bar-b w-[2px] rounded-full bg-[var(--l-violet)]" style={{ height: h, animationDelay: `${k * 0.12}s` }} />
                        ))}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5 rounded-2xl bg-white/55 px-3 py-2.5 opacity-60">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#9cc9ff] text-[12px] font-bold text-[#0f1d45]">P</span>
                      <span className="text-[13px] text-[var(--l-muted)]">Priya Nair · Host</span>
                    </div>
                  </div>
                )}
                {i === 2 && (
                  <div className="w-full max-w-[300px] space-y-2.5">
                    <div className="flex items-center gap-2.5 rounded-2xl bg-white px-3 py-3" style={{ boxShadow: "var(--l-shadow-small)" }}>
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--l-violet)]" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--l-heading)]">Notes: Q3 Planning · Product</span>
                    </div>
                    <div className="flex items-center gap-2.5 rounded-2xl bg-white/55 px-3 py-3 opacity-60">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-transparent" />
                      <span className="text-[13px] text-[var(--l-muted)]">Notes: Design review</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold text-white" style={{ background: i === 0 ? "var(--l-blue)" : "var(--l-violet)" }}>{s.n}</span>
                  <span className="text-[12px] font-semibold uppercase tracking-[0.1em]" style={{ color: i === 0 ? "var(--l-blue-ink)" : "var(--l-violet)" }}>
                    {i === 0 ? "You" : "MeetMate"}
                  </span>
                </div>
                <h3 className="mt-3 font-[family-name:var(--font-display)] text-[24px] font-semibold text-[var(--l-heading)]" style={{ letterSpacing: "-0.02em" }}>{s.t}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--l-text)]">{s.b}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────── */}
      <section id="features" className="bg-white">
        {/* A — search. Panel bleeds right. */}
        <div className="flex flex-wrap items-center gap-[clamp(32px,4vw,72px)]" style={{ paddingLeft: "var(--l-pad)", paddingTop: "var(--l-section-y)" }}>
          <div style={{ flex: "1 1 400px", maxWidth: 620 }}>
            <span className="l-eyebrow" style={{ color: "var(--l-blue-ink)" }}>Search</span>
            <h2 className="mt-4 font-[family-name:var(--font-display)] font-bold text-[var(--l-heading)]" style={{ fontSize: "clamp(36px,3.6vw,68px)", lineHeight: 1.02, letterSpacing: "-0.03em" }}>
              Find the moment,<br />not the meeting.
            </h2>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-[var(--l-text)]">
              Every word is indexed the moment a call ends. Type what you half-remember and
              land on the sentence, with who said it and when.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              {["Speaker-attributed", "Across every meeting", "Jump to the timestamp"].map((c) => (
                <span key={c} className="rounded-full bg-[var(--l-blue-tint)] px-3.5 py-2 text-[13px] font-medium text-[var(--l-blue-ink)]">{c}</span>
              ))}
            </div>
          </div>

          <div style={{ flex: "1.1 1 520px", minWidth: 0 }}>
            <div className="rounded-[36px_0_0_36px] bg-[var(--l-blue-tint)] p-[clamp(20px,2.4vw,44px)]">
              <div className="rounded-[22px] bg-white p-5" style={{ boxShadow: "var(--l-shadow-float)" }}>
                <div className="flex items-center gap-2 rounded-[10px] px-3.5 py-2.5" style={{ border: "2px solid var(--l-blue)" }}>
                  <span className="text-[var(--l-blue)]"><G d={I.search} size={16} /></span>
                  <span className="text-[14px] text-[var(--l-heading)]">release notes</span>
                </div>
                <div className="mt-4 space-y-3.5">
                  {[
                    { w: "Marcus", bg: "#ffd08a", m: "Q3 Planning · Product", ts: "12:04", pre: "All clear. I'll own the ", post: "." },
                    { w: "Priya", bg: "#9cc9ff", m: "Launch sync", ts: "04:17", pre: "Can we get the ", post: " by Thursday?" },
                    { w: "Ana", bg: "#a8e6cc", m: "Design review", ts: "22:41", pre: "The ", post: " should mention the new flow." },
                  ].map((r) => (
                    <div key={r.m} className="flex items-start gap-2.5">
                      <span className="mt-[2px] grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-[#0f1d45]" style={{ background: r.bg }}>{r.w[0]}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-[var(--l-muted)]">
                          <span className="font-semibold text-[var(--l-heading)]">{r.w}</span>
                          <span>· {r.m} ·</span>
                          <span className="font-mono">{r.ts}</span>
                        </div>
                        <p className="mt-0.5 text-[13.5px] leading-snug text-[var(--l-text)]">
                          {r.pre}<mark className="rounded px-0.5" style={{ background: "var(--l-highlight)", color: "var(--l-heading)" }}>release notes</mark>{r.post}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* B — the email. Panel bleeds left. */}
        <div className="flex flex-row-reverse flex-wrap items-center gap-[clamp(32px,4vw,72px)]" style={{ paddingRight: "var(--l-pad)", paddingTop: "clamp(56px,6vw,104px)", paddingBottom: "var(--l-section-y)" }}>
          <div style={{ flex: "1 1 400px", maxWidth: 620 }}>
            <span className="l-eyebrow">Notes</span>
            <h2 className="mt-4 font-[family-name:var(--font-display)] font-bold text-[var(--l-heading)]" style={{ fontSize: "clamp(36px,3.6vw,68px)", lineHeight: 1.02, letterSpacing: "-0.03em" }}>
              In the inbox<br />before you are.
            </h2>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-[var(--l-text)]">
              Summary, decisions and who owes what by when — sent to everyone who was in the
              room, minutes after it ends. Nobody has to write them up.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              {["Decisions captured", "Owners and due dates", "Emailed automatically"].map((c) => (
                <span key={c} className="rounded-full bg-[var(--l-violet-tint)] px-3.5 py-2 text-[13px] font-medium text-[var(--l-violet)]">{c}</span>
              ))}
            </div>
          </div>

          <div style={{ flex: "1.1 1 520px", minWidth: 0 }}>
            <div className="rounded-[0_36px_36px_0] bg-[var(--l-violet-tint)] p-[clamp(20px,2.4vw,44px)]">
              <div className="rounded-[22px] bg-white p-5" style={{ boxShadow: "var(--l-shadow-float)" }}>
                <div className="flex items-center gap-2.5 border-b border-[var(--l-border)] pb-3.5">
                  <Image src="/brand/meetmate-mark.png" alt="" width={26} height={20} className="h-5 w-auto" />
                  <span className="text-[13px] font-semibold text-[var(--l-heading)]">MeetMate</span>
                  <span className="ml-auto font-mono text-[11px] text-[var(--l-muted)]">now</span>
                </div>
                <p className="mt-3.5 text-[15px] font-semibold text-[var(--l-heading)]">Notes: Q3 Planning · Product</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--l-text)]">
                  Launch set for the 14th. Marcus owns release notes and design handoff.
                  Scope is locked; no blockers.
                </p>
                <div className="mt-4 space-y-2.5">
                  {[["Draft release notes", "Marcus", "Fri"], ["Design handoff", "Ana", "Fri"], ["Send launch comms", "Priya", "Mon"]].map(([t, w, d]) => (
                    <div key={t} className="flex items-center gap-2.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--l-violet)]" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--l-heading)]">{t}</span>
                      <span className="shrink-0 text-[12px] text-[var(--l-muted)]">{w}</span>
                      <span className="shrink-0 font-mono text-[12px] font-semibold text-[var(--l-violet)]">{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Values ─────────────────────────────────────────────────── */}
      <section className="bg-[var(--l-heading)]" style={{ padding: "var(--l-section-y) var(--l-pad)" }}>
        <h2 className="max-w-3xl font-[family-name:var(--font-display)] font-bold text-white" style={{ fontSize: "clamp(40px,4.4vw,84px)", lineHeight: 1, letterSpacing: "-0.03em" }}>
          Built to disappear into your day.
        </h2>
        <div className="mt-12 grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {VALUES.map((v, i) => (
            <article key={v.t} className="rounded-[24px] bg-[var(--l-navy-2)] p-6">
              <span className="grid h-[52px] w-[52px] place-items-center rounded-2xl" style={{ background: i % 2 === 0 ? "var(--l-violet-tint)" : "var(--l-blue-tint)", color: i % 2 === 0 ? "var(--l-violet)" : "var(--l-blue-ink)" }}>
                <G d={v.icon} size={24} />
              </span>
              <h3 className="mt-5 font-[family-name:var(--font-display)] text-[20px] font-semibold text-white" style={{ letterSpacing: "-0.02em" }}>{v.t}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-white/65">{v.b}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: "var(--l-section-y) var(--l-pad)" }}>
        <h2 className="font-[family-name:var(--font-display)] font-bold text-[var(--l-heading)]" style={{ fontSize: "clamp(40px,4.4vw,84px)", lineHeight: 1, letterSpacing: "-0.03em" }}>
          Simple pricing.
        </h2>
        <p className="mt-4 max-w-xl text-[17px] text-[var(--l-text)]">
          Start free. Move up when your team does.
        </p>

        <div className="mt-12 grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {PLANS.map((p) => (
            <article
              key={p.name}
              className="flex flex-col rounded-[28px] p-7"
              style={p.hot ? { background: "var(--l-heading)" } : { background: "#fff", border: "1px solid var(--l-border)" }}
            >
              <div className="flex items-center gap-3">
                <h3 className="font-[family-name:var(--font-display)] text-[20px] font-semibold" style={{ color: p.hot ? "#fff" : "var(--l-heading)" }}>{p.name}</h3>
                {p.hot && <span className="rounded-full bg-[var(--l-violet)] px-2.5 py-1 text-[11px] font-semibold text-white">Most popular</span>}
              </div>
              <p className="mt-1 text-[14px]" style={{ color: p.hot ? "rgba(255,255,255,.6)" : "var(--l-muted)" }}>{p.tag}</p>

              <div className="mt-6 flex items-baseline gap-2">
                <span className="font-[family-name:var(--font-display)] font-bold" style={{ fontSize: "clamp(48px,3.6vw,64px)", lineHeight: 1, letterSpacing: "-0.03em", color: p.hot ? "#fff" : "var(--l-heading)" }}>{p.price}</span>
                <span className="text-[13.5px]" style={{ color: p.hot ? "rgba(255,255,255,.55)" : "var(--l-muted)" }}>{p.per}</span>
              </div>

              <ul className="mt-6 flex-1 space-y-3">
                {p.feats.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[14.5px]" style={{ color: p.hot ? "rgba(255,255,255,.85)" : "var(--l-text)" }}>
                    <span className="mt-[3px] shrink-0" style={{ color: p.hot ? "var(--l-violet-2)" : "var(--l-violet)" }}><G d={I.check} size={15} /></span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href={cta.href}
                className="mt-7 inline-flex items-center justify-center rounded-full px-5 py-3 text-[14.5px] font-semibold transition-colors"
                style={p.hot ? { background: "#fff", color: "var(--l-heading)" } : { background: "var(--l-heading)", color: "#fff" }}
              >
                {p.cta}
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────── */}
      <section id="faq" className="bg-white">
        <div className="flex flex-wrap gap-[clamp(32px,4vw,72px)]" style={{ padding: "var(--l-section-y) var(--l-pad)" }}>
          <h2 className="font-[family-name:var(--font-display)] font-bold text-[var(--l-heading)]" style={{ flex: "1 1 320px", fontSize: "clamp(40px,4.4vw,84px)", lineHeight: 1, letterSpacing: "-0.03em" }}>
            Questions,<br />answered.
          </h2>
          <div style={{ flex: "1.4 1 460px", minWidth: 0 }}>
            <FaqList items={FAQ} />
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────── */}
      <section className="overflow-hidden bg-[var(--l-violet-tint)]">
        <div className="flex flex-wrap items-center gap-8" style={{ padding: "var(--l-section-y) var(--l-pad)" }}>
          <div style={{ flex: "1 1 420px" }}>
            <h2 className="font-[family-name:var(--font-display)] font-bold text-[var(--l-heading)]" style={{ fontSize: "clamp(44px,5.4vw,110px)", lineHeight: 0.98, letterSpacing: "-0.03em" }}>
              Give your team back the meeting.
            </h2>
            <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-[var(--l-text)]">
              Stop splitting your attention between listening and writing. MeetMate does the
              second one.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={cta.href} className="l-btn-primary px-6 py-3.5 text-[15px]">
                {cta.label} <G d={I.arrow} size={17} />
              </Link>
              <a href="#pricing" className="l-btn-ghost px-6 py-3.5 text-[15px]">See pricing</a>
            </div>
          </div>
          <div className="hidden shrink-0 justify-end lg:flex" style={{ flex: "0 1 auto" }}>
            <Image
              src="/brand/meetmate-mark.png"
              alt=""
              width={770}
              height={590}
              className="h-auto"
              style={{ width: "clamp(220px, 26vw, 480px)" }}
            />
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="border-t border-[var(--l-border)]">
        <div className="flex flex-wrap items-center justify-between gap-6" style={{ padding: "36px var(--l-pad)" }}>
          <div>
            <Image src="/brand/meetmate-wordmark.png" alt="MeetMate" width={137} height={22} className="h-[20px] w-auto" />
            <p className="mt-2 text-[13.5px] text-[var(--l-muted)]">AI notes for every meeting</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px] text-[var(--l-text)]">
            <a href="#how" className="hover:text-[var(--l-violet)]">How it works</a>
            <a href="#features" className="hover:text-[var(--l-violet)]">Features</a>
            <a href="#pricing" className="hover:text-[var(--l-violet)]">Pricing</a>
            <a href="#faq" className="hover:text-[var(--l-violet)]">FAQ</a>
          </div>
          <span className="text-[12.5px] text-[var(--l-muted)]">
            © {new Date().getFullYear()} MeetMate · meetmate.devexhub.com · Built by{" "}
            <a href="https://devexhub.com" className="font-medium text-[var(--l-text)] hover:text-[var(--l-violet)]">Devex Hub</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
