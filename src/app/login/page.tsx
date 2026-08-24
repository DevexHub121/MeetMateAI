import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell, Field } from "@/components/AuthShell";
import { login } from "./actions";

const ERRORS: Record<string, string> = {
  missing: "Enter your email and password.",
  invalid: "That email or password isn't right.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  if (await getCurrentUser()) redirect("/meetings");
  const { error, next } = await searchParams;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Notti workspace."
      footer={
        <>
          New here?{" "}
          <Link href="/register" className="text-[var(--color-heading)] underline underline-offset-2">
            Create a workspace
          </Link>
        </>
      }
    >
      <form action={login} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        {error && ERRORS[error] && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
            {ERRORS[error]}
          </p>
        )}
        <Field label="Email" name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
        <Field label="Password" name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
        <button type="submit" className="btn-primary w-full justify-center px-4 py-2.5 text-sm">
          Sign in
        </button>
      </form>
    </AuthShell>
  );
}
