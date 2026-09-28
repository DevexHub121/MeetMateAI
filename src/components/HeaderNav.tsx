"use client";

import Link from "next/link";
import { useState } from "react";
import { NavLink } from "@/components/NavLink";
import type { SessionUser } from "@/lib/auth";

// Responsive header nav: a full inline row on desktop, a hamburger + slide-down
// panel on phones. Takes the (server-loaded) user so the layout stays a server
// component. `logoutUrl` is "/logout", which clears MeetMate's own session cookie.
export function HeaderNav({
  user,
  initials,
  logoutUrl,
}: {
  user: SessionUser;
  initials: string;
  logoutUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  // Settings are org-level (the note-taker's name, allowed domains), so an org
  // admin or a platform owner gets the link. The page enforces this too.
  const canManageSettings = user.role === "superadmin" || user.org?.roleKey === "admin";

  return (
    <>
      {/* Desktop nav */}
      <nav className="hidden items-center gap-1 text-sm md:flex">
        <NavLink href="/meetings">Meetings</NavLink>
        <NavLink href="/team">Team</NavLink>
        {/* Everyone's own voice profile — per-user, so no role gate. */}
        <NavLink href="/profile/voice">Voice</NavLink>
        {canManageSettings && <NavLink href="/settings">Settings</NavLink>}
        <Link href="/meetings/new" className="btn-primary ml-1 px-3.5 py-1.5">
          <span className="text-base leading-none">+</span> New meeting
        </Link>
        <div className="ml-3 flex items-center gap-2.5 border-l border-[var(--color-border)] pl-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-elevated)] text-xs font-semibold text-[var(--color-heading)]">
            {initials || "U"}
          </span>
          <div className="hidden text-right leading-tight lg:block">
            <div className="text-sm font-medium text-[var(--color-heading)]">
              {user.name}
            </div>
            <div className="text-xs capitalize text-[var(--color-text-muted)]">
              {user.role}
            </div>
          </div>
          <a href={logoutUrl} className="btn-secondary px-3 py-1.5">
            Sign out
          </a>
        </div>
      </nav>

      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-muted-surface)] hover:text-[var(--color-heading)] md:hidden"
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>

      {/* Mobile slide-down panel */}
      {open && (
        <div className="absolute inset-x-0 top-full border-b border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm shadow-black/30 md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 text-sm">
            <NavLink href="/meetings" onClick={close} className="py-2">
              Meetings
            </NavLink>
            <NavLink href="/team" onClick={close} className="py-2">
              Team
            </NavLink>
            <NavLink href="/profile/voice" onClick={close} className="py-2">
              Voice
            </NavLink>
            {canManageSettings && (
              <NavLink href="/settings" onClick={close} className="py-2">
                Settings
              </NavLink>
            )}
            <Link
              href="/meetings/new"
              onClick={close}
              className="btn-primary mt-1 px-3.5 py-2"
            >
              <span className="text-base leading-none">+</span> New meeting
            </Link>

            <div className="mt-2 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-elevated)] text-xs font-semibold text-[var(--color-heading)]">
                  {initials || "U"}
                </span>
                <div className="leading-tight">
                  <div className="text-sm font-medium text-[var(--color-heading)]">
                    {user.name}
                  </div>
                  <div className="text-xs capitalize text-[var(--color-text-muted)]">
                    {user.role}
                  </div>
                </div>
              </div>
              <a href={logoutUrl} className="btn-secondary px-3 py-1.5">
                Sign out
              </a>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}

function MenuIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
