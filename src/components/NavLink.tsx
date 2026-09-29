"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Header nav link that highlights itself on its own route. Exact-match hrefs
// only light up on that exact path; others also match their sub-routes.
export function NavLink({
  href,
  children,
  onClick,
  exact = false,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  onClick?: () => void;
  exact?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`rounded-full px-3.5 py-2 font-medium transition-colors ${
        active
          ? "bg-[var(--d-ink)] text-white"
          : "text-[var(--d-text)] hover:bg-[rgba(24,24,24,.06)]"
      } ${className}`}
    >
      {children}
    </Link>
  );
}
