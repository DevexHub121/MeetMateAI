"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { inviteMember, setMemberRole, setMemberStatus } from "@/lib/accounts";
import { sendEmail } from "@/lib/email";

/**
 * Every action re-checks that the caller is an admin of their own org. A server
 * action is a public endpoint — rendering the controls only for admins governs
 * who sees them, not who can call them.
 */
async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const isAdmin = user.role === "superadmin" || user.org?.roleKey === "admin";
  if (!isAdmin || !user.org) throw new Error("Only an admin can manage the team");
  return { user, org: user.org };
}

function inviteEmail(orgName: string, link: string): string {
  return `<p>You've been invited to join <strong>${orgName}</strong> on MeetMate.</p>
    <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Accept your invitation</a></p>
    <p>Or paste this link into your browser:<br>${link}</p>`;
}

export async function inviteTeamMember(
  input: { email: string; name: string; role: "admin" | "member" },
): Promise<{ emailed: boolean; link: string }> {
  const { user, org } = await requireAdmin();
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That doesn't look like an email address");

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";

  let result;
  try {
    result = await inviteMember({
      orgId: org.id,
      email,
      name: input.name,
      role: input.role === "admin" ? "admin" : "member",
      invitedBy: user.id,
      origin: `${proto}://${host}`,
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Couldn't send that invite");
  }

  const emailed = await sendEmail(email, `You're invited to ${org.name} on MeetMate`, inviteEmail(org.name, result.link));
  revalidatePath("/team");
  return { emailed, link: result.link };
}

export async function changeMemberRole(userId: string, role: "admin" | "member") {
  const { org } = await requireAdmin();
  await setMemberRole(org.id, userId, role);
  revalidatePath("/team");
}

export async function changeMemberStatus(userId: string, status: "active" | "suspended") {
  const { user, org } = await requireAdmin();
  if (userId === user.id && status === "suspended") throw new Error("You can't suspend your own account");
  await setMemberStatus(org.id, userId, status);
  revalidatePath("/team");
}
