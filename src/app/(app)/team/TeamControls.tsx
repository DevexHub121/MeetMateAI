"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteTeamMember, changeMemberRole, changeMemberStatus } from "./actions";

export function InviteForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ emailed: boolean; link: string } | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-primary px-4 py-2 text-sm">
        Invite member
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null); setResult(null);
            try {
              const r = await inviteTeamMember({ email, name, role });
              setResult(r); setEmail(""); setName(""); router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't invite");
            }
          });
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="min-w-[13rem] flex-1">
          <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-heading)] outline-none focus:border-[var(--color-border-strong)]" />
        </label>
        <label className="min-w-[9rem] flex-1">
          <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-heading)] outline-none focus:border-[var(--color-border-strong)]" />
        </label>
        <label>
          <span className="mb-1 block text-xs text-[var(--color-text-muted)]">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-2 text-sm text-[var(--color-heading)]">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" disabled={pending || !email} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">
          {pending ? "Inviting…" : "Send invite"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); setResult(null); }}
          className="px-2 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-heading)]">
          Cancel
        </button>
      </form>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {result && (
        <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] p-3">
          <p className="text-xs text-emerald-300">
            {result.emailed ? "Invitation emailed." : "Email isn't configured — share this link:"}
          </p>
          <code className="mt-1 block break-all text-[11px] text-[var(--color-text-secondary)]">{result.link}</code>
        </div>
      )}
    </div>
  );
}

export function MemberActions({
  userId, role, status, isSelf, canManage,
}: {
  userId: string;
  role: "admin" | "member";
  status: string;
  isSelf: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      try { await fn(); router.refresh(); }
      catch (err) { setError(err instanceof Error ? err.message : "Couldn't save"); }
    });

  if (!canManage) {
    return <span className="text-sm capitalize text-[var(--color-text-secondary)]">{role}</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={role}
        disabled={pending}
        onChange={(e) => run(() => changeMemberRole(userId, e.target.value as "admin" | "member"))}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-heading)] disabled:opacity-50"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      {!isSelf && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => changeMemberStatus(userId, status === "active" ? "suspended" : "active"))}
          className={`rounded-full border px-2.5 py-1 text-xs disabled:opacity-50 ${
            status === "active"
              ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              : "border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
          }`}
        >
          {status === "active" ? "Active" : status}
        </button>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
