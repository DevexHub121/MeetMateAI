import Link from "next/link";
import { MeetMateMark } from "@/components/MeetMateMark";

/** Centered card on a light ground — matches the marketing site so the signup
 *  flow doesn't jump from a bright landing page to a dark form. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="site-light relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="relative w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ background: "var(--l-grad)" }}>
            <MeetMateMark size={20} mono />
          </span>
          <span className="text-lg font-bold tracking-tight text-[var(--l-heading)]">MeetMate</span>
        </Link>

        <div className="l-card p-6 shadow-xl shadow-indigo-500/5 sm:p-7">
          <h1 className="text-xl font-bold tracking-tight text-[var(--l-heading)]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-[var(--l-text)]">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>

        {footer && <div className="mt-5 text-center text-sm text-[var(--l-muted)]">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-[var(--l-heading)]">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-[var(--l-border-strong)] bg-white px-3 py-2.5 text-sm text-[var(--l-heading)] outline-none transition-colors placeholder:text-[var(--l-muted)] focus:border-[var(--l-accent)] focus:ring-2 focus:ring-[var(--l-accent-soft)]"
      />
    </label>
  );
}
