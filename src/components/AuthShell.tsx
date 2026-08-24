import Link from "next/link";
import { NottiMark } from "@/components/NottiMark";

/** Centered card on the dark ground, used by every auth page. */
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
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-heading)] shadow-sm">
            <NottiMark size={20} />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-[var(--color-heading)]">
            Notti
          </span>
        </Link>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm sm:p-7">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-heading)]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">{subtitle}</p>
          )}
          <div className="mt-6">{children}</div>
        </div>

        {footer && (
          <div className="mt-5 text-center text-sm text-[var(--color-text-muted)]">{footer}</div>
        )}
      </div>
    </div>
  );
}

/** Shared input styling. */
export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-[var(--color-heading)]">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-heading)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-strong)]"
      />
    </label>
  );
}
