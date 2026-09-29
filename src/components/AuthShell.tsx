import Link from "next/link";
import Image from "next/image";

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
          {/* The real mark and wordmark, as the site header uses — the drawn
              glyph on a gradient tile was a stand-in from before the brand
              assets arrived. */}
          <Image src="/brand/meetmate-mark.png" alt="" width={47} height={36} className="h-9 w-auto" priority />
          <Image src="/brand/meetmate-wordmark.png" alt="MeetMate" width={137} height={22} className="h-[22px] w-auto" priority />
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
