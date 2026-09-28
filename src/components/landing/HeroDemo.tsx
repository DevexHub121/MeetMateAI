"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { MeetMateMark } from "@/components/MeetMateMark";

/**
 * The hero: a call on the left, the notes MeetMate is writing on the right.
 *
 * A loop rather than a video. It is a few kilobytes against a megabyte, it
 * stays sharp on any display, and the text is real text — so the promise the
 * headline makes is demonstrated in the same breath rather than described.
 *
 * One tick a second drives everything; each element declares the tick it
 * appears on. That keeps the choreography readable as data instead of a chain
 * of nested timeouts nobody can safely reorder later.
 */

const PEOPLE = {
  Priya: "#9cc9ff",
  Marcus: "#ffd08a",
  Ana: "#a8e6cc",
} as const;

type Speaker = keyof typeof PEOPLE;

const LINES: { s: Speaker; c: string; at: number }[] = [
  { s: "Priya", c: "Let's lock the launch for the 14th — anyone blocked?", at: 1 },
  { s: "Marcus", c: "All clear. I'll own the release notes.", at: 3 },
  { s: "Ana", c: "Design hands off Friday, so we're good.", at: 5 },
  { s: "Priya", c: "Perfect. I'll send the comms Monday.", at: 7 },
];

const ACTIONS: { w: Speaker; t: string; d: string; at: number }[] = [
  { w: "Marcus", t: "Draft release notes", d: "Fri", at: 4 },
  { w: "Ana", t: "Design handoff", d: "Fri", at: 6 },
  { w: "Priya", t: "Send launch comms", d: "Mon", at: 8 },
];

const LAST_TICK = 17;
/** The finished state — where reduced motion starts and stays. */
const SETTLED = 12;

/** Enter transition for anything that appears on a given tick. */
function enter(t: number, at: number) {
  const on = t >= at;
  return {
    opacity: on ? 1 : 0,
    transform: on ? "translateY(0)" : "translateY(8px)",
    transition: "opacity .5s ease, transform .5s ease",
  };
}

export function HeroDemo() {
  /*
   * Starts settled, not at zero.
   *
   * The first paint is what a reader sees before any effect runs, and it is
   * also what someone with reduced motion keeps. Beginning at the end means
   * that frame is the complete, legible one — an empty notes card would read
   * as a product that had not loaded.
   */
  const [t, setT] = useState(SETTLED);

  useEffect(() => {
    // Reduced motion simply never starts the loop, which leaves the settled
    // first paint in place — the complete state, not a frozen empty one.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    /*
     * The tick is held here rather than read back from state, so the only
     * setState in this effect happens inside the interval callback. Updating
     * state in the effect body instead would re-render immediately on mount,
     * which is the cascade the lint rule is there to catch.
     */
    let tick = 0;
    const id = setInterval(() => {
      tick = tick >= LAST_TICK ? 1 : tick + 1;
      setT(tick);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // The speaker is whoever spoke most recently, which is also the caption.
  const spoken = LINES.filter((l) => t >= l.at);
  const current = spoken[spoken.length - 1] ?? LINES[LINES.length - 1];
  const live = t < 11;
  const sent = t >= 11;

  return (
    <div
      className="grid gap-[clamp(12px,1.2vw,20px)] rounded-[32px_0_0_32px] bg-[var(--l-heading)] p-[clamp(16px,1.6vw,28px)]"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
    >
      {/* ── The call ─────────────────────────────────────────────── */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-white">
          <span className="truncate text-[15px] font-semibold">Q3 Planning · Product</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-white/60">
            <span className="blink inline-block h-1.5 w-1.5 rounded-full bg-[#ef4444]" />
            <span className="font-mono">12:04</span>
          </span>
        </div>
        <div className="mt-1 text-[11px] text-white/45">Google Meet</div>

        {/* Active speaker */}
        <div
          className="relative mt-3 grid min-h-[190px] place-items-center overflow-hidden rounded-[20px] bg-[var(--l-navy-3)]"
          style={live ? { boxShadow: "inset 0 0 0 3px var(--l-blue)" } : undefined}
        >
          <span
            className="grid h-[76px] w-[76px] place-items-center rounded-full text-[28px] font-bold text-[#0f1d45]"
            style={{ background: PEOPLE[current.s] }}
          >
            {current.s[0]}
          </span>
          <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white">
            {current.s}
            {live && (
              <span className="flex items-end gap-[2px]" aria-hidden>
                {[6, 10, 7].map((h, i) => (
                  <span
                    key={i}
                    className="eq-bar-b w-[2px] rounded-full bg-[var(--l-blue)]"
                    style={{ height: h, animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </span>
            )}
          </span>
          <p
            key={current.c}
            className="absolute inset-x-0 bottom-0 bg-[rgba(8,14,36,.72)] px-3 py-2 text-[12.5px] leading-snug text-white"
            style={enter(t, current.at)}
          >
            {current.c}
          </p>
        </div>

        {/* Filmstrip */}
        <div className="mt-2.5 grid grid-cols-4 gap-2">
          {(["Priya", "Marcus", "Ana"] as Speaker[]).map((p) => (
            <div
              key={p}
              className="grid h-[52px] place-items-center rounded-[14px] bg-[var(--l-navy-3)] text-[13px] font-bold text-[#0f1d45]"
              style={live && current.s === p ? { boxShadow: "inset 0 0 0 2px var(--l-blue)" } : undefined}
            >
              <span
                className="grid h-7 w-7 place-items-center rounded-full"
                style={{ background: PEOPLE[p] }}
              >
                {p[0]}
              </span>
            </div>
          ))}
          {/* Ours, so violet — and named, because a bot in a call should be. */}
          <div
            className="grid h-[52px] place-items-center rounded-[14px] bg-[#2b2070]"
            style={{ boxShadow: "inset 0 0 0 2px var(--l-violet-2)" }}
            title="MeetMate"
          >
            <span className="text-white"><MeetMateMark size={22} mono /></span>
          </div>
        </div>
      </div>

      {/* ── The notes ────────────────────────────────────────────── */}
      <div className="min-w-0 rounded-[22px] bg-white p-[clamp(14px,1.2vw,20px)]">
        <div className="flex items-center gap-2">
          <Image src="/brand/meetmate-mark.png" alt="" width={24} height={19} className="h-[18px] w-auto" />
          <span className="text-[14px] font-semibold text-[var(--l-heading)]">Notes</span>
          <span
            className="ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
            style={
              sent
                ? { background: "var(--l-heading)", color: "#fff" }
                : { background: "var(--l-violet-tint)", color: "var(--l-violet)" }
            }
          >
            {sent ? "Sent" : "Writing…"}
          </span>
        </div>

        <div
          className="mt-3 flex items-start gap-2 rounded-xl bg-[var(--l-violet-tint)] px-3 py-2.5"
          style={enter(t, 2)}
        >
          <span className="mt-[2px] text-[var(--l-violet)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <span className="text-[12.5px] font-medium leading-snug text-[var(--l-heading)]">
            Launch locked for the 14th.
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {ACTIONS.map((a) => (
            <div key={a.t} className="flex items-center gap-2.5" style={enter(t, a.at)}>
              <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border border-[var(--l-border-strong)] text-[var(--l-muted)]">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--l-heading)]">{a.t}</span>
              <span
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-[#0f1d45]"
                style={{ background: PEOPLE[a.w] }}
                title={a.w}
              >
                {a.w[0]}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[var(--l-muted)]">{a.d}</span>
            </div>
          ))}
        </div>

        <p
          className="mt-3 border-t border-[var(--l-border)] pt-3 text-[12.5px] leading-relaxed text-[var(--l-text)]"
          style={{
            opacity: t >= 10 ? 1 : 0.12,
            filter: t >= 10 ? "blur(0)" : "blur(5px)",
            transition: "opacity .6s ease, filter .6s ease",
          }}
        >
          Launch set for the 14th. Marcus owns release notes and design handoff. Scope
          is locked; no blockers.
        </p>

        <div
          className="mt-3 flex items-center gap-2 rounded-xl bg-[var(--l-heading)] px-3 py-2.5 text-[12px] font-medium text-white"
          style={enter(t, 11)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7l9 6 9-6" /><rect x="3" y="5" width="18" height="14" rx="2" /></svg>
          Emailed to all 4 attendees
        </div>
      </div>
    </div>
  );
}
