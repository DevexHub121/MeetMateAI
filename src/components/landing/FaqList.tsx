"use client";

import { useState } from "react";

/**
 * One answer open at a time, the first open on arrival.
 *
 * Not <details>, which would let a reader open all four and lose the shape of
 * the list. Opening the first by default also means the block never appears as
 * a wall of closed bars with nothing to read — the most common question is
 * answered before anyone clicks.
 */
export function FaqList({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState(0);

  return (
    <div className="grid gap-3">
      {items.map((f, i) => {
        const isOpen = open === i;
        return (
          <div
            key={f.q}
            className="rounded-[22px] transition-colors"
            style={{ background: isOpen ? "var(--l-violet-tint)" : "var(--l-paper)" }}
          >
            <h3>
              <button
                type="button"
                // Collapsing the open one leaves every answer closed, which is
                // a state a reader chose; it is not forced back open.
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-4 px-5 py-4 text-left"
              >
                <span className="flex-1 text-[16px] font-semibold text-[var(--l-heading)]">
                  {f.q}
                </span>
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-transform duration-200"
                  style={{
                    background: isOpen ? "var(--l-violet)" : "#fff",
                    color: isOpen ? "#fff" : "var(--l-heading)",
                    transform: isOpen ? "rotate(45deg)" : "none",
                  }}
                  aria-hidden
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </span>
              </button>
            </h3>
            {isOpen && (
              <p className="px-5 pb-5 text-[15px] leading-relaxed text-[var(--l-text)]">
                {f.a}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
