import { redirect } from "next/navigation";
import { findInvite } from "@/lib/accounts";
import { AuthShell, Field } from "@/components/AuthShell";
import { acceptInvitation } from "./actions";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  if (!token) redirect("/login");

  const invite = await findInvite(token);
  if (!invite) {
    return (
      <AuthShell title="Invite unavailable" subtitle="This invitation is invalid, already used, or expired.">
        <a href="/login" className="btn-secondary w-full justify-center px-4 py-2.5 text-sm">
          Go to sign in
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${invite.orgName}`}
      subtitle={`Set a password for ${invite.email} to accept your invitation.`}
    >
      <form action={acceptInvitation} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        {error && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">{error}</p>
        )}
        <Field label="Choose a password" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
        <button type="submit" className="btn-primary w-full justify-center px-4 py-2.5 text-sm">
          Accept &amp; join
        </button>
      </form>
    </AuthShell>
  );
}
