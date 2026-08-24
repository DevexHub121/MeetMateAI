import { requireUser } from "@/lib/auth";
import { listMembers } from "@/lib/accounts";
import { InviteForm, MemberActions } from "./TeamControls";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await requireUser();
  if (!user.org) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        You&rsquo;re not part of an organization yet.
      </p>
    );
  }
  const canManage = user.role === "superadmin" || user.org.roleKey === "admin";
  const members = await listMembers(user.org.id);
  const active = members.filter((m) => m.status === "active").length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">
            Team
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {active} active {active === 1 ? "member" : "members"} in {user.org.name}
            {canManage ? "" : " · only an admin can make changes"}
          </p>
        </div>
        {canManage && <InviteForm />}
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted-surface)]/50 text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {members.map((m) => (
              <tr key={m.userId} className="transition-colors hover:bg-[var(--color-muted-surface)]">
                <td className="px-5 py-3">
                  <div className="font-medium text-[var(--color-heading)]">{m.name}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{m.email}</div>
                </td>
                <td className="px-5 py-3">
                  <MemberActions
                    userId={m.userId}
                    role={m.role as "admin" | "member"}
                    status={m.status}
                    isSelf={m.userId === user.id}
                    canManage={canManage}
                  />
                </td>
                <td className="px-5 py-3">
                  <span className={m.status === "active" ? "text-emerald-400" : "text-[var(--color-text-muted)]"}>
                    {m.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
