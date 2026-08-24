import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell, Field } from "@/components/AuthShell";
import { verifyRegistration, resendRegistration } from "../actions";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; resent?: string; code?: string }>;
}) {
  if (await getCurrentUser()) redirect("/meetings");
  const { token, error, resent, code } = await searchParams;
  if (!token) redirect("/register");

  return (
    <AuthShell title="Check your email" subtitle="Enter the 6-digit code we just sent you.">
      <form action={verifyRegistration} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
        {resent && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            A new code is on its way.
          </p>
        )}
        {code && (
          <p className="rounded-lg border border-[var(--l-border)] bg-[var(--l-bg-soft)] px-3 py-2 text-xs text-[var(--l-text)]">
            Email isn&rsquo;t configured, so here&rsquo;s your code: <strong>{code}</strong>
          </p>
        )}
        <Field
          label="Verification code"
          name="code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          required
          defaultValue={code ?? ""}
          placeholder="123456"
        />
        <button type="submit" className="l-btn-primary w-full px-4 py-2.5 text-sm">
          Verify &amp; continue
        </button>
      </form>
      <form action={resendRegistration} className="mt-3 text-center">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="text-xs text-[var(--l-muted)] underline underline-offset-2 hover:text-[var(--l-accent)]">
          Didn&rsquo;t get it? Resend the code
        </button>
      </form>
    </AuthShell>
  );
}
