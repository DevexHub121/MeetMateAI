import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell, Field } from "@/components/AuthShell";
import { startRegistration } from "./actions";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getCurrentUser()) redirect("/meetings");
  const { error } = await searchParams;

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Start capturing meetings in minutes. No card required."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-[var(--l-accent)] hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form action={startRegistration} className="space-y-4">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <Field label="Work email" name="adminEmail" type="email" required autoComplete="email" placeholder="you@company.com" />
        <Field label="Your name" name="adminName" type="text" required autoComplete="name" placeholder="Jane Doe" />
        <Field label="Company / workspace name" name="orgName" type="text" required placeholder="Acme Inc." />
        <Field label="Workspace URL (optional)" name="orgSlug" type="text" placeholder="acme" />
        <Field label="Password" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
        <button type="submit" className="l-btn-primary w-full px-4 py-2.5 text-sm">
          Create workspace
        </button>
        <p className="text-center text-xs text-[var(--color-text-muted)]">
          We&rsquo;ll email you a 6-digit code to confirm.
        </p>
      </form>
    </AuthShell>
  );
}
