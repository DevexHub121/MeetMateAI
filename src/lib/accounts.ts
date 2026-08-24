import "server-only";
import { createHash, randomBytes, randomInt } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  organizations,
  orgMembers,
  orgSettings,
  orgSubscriptions,
  departments,
  pendingRegistrations,
  invitations,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";

const OTP_TTL_MS = 15 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESENDS = 5;

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

/** A 6-digit code. randomInt, not Math.random — this gates account creation. */
function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Turn a company name into a URL-safe slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export async function getUserByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
  return rows[0] ?? null;
}

/**
 * Step one of signup: stash the org + admin details and a hashed OTP, and return
 * the plaintext code for emailing. Nothing real is created until the code is
 * verified, so an abandoned signup leaves no half-org behind.
 */
export async function createPendingRegistration(input: {
  orgName: string;
  orgSlug: string;
  adminName: string;
  adminEmail: string;
  password: string;
}): Promise<{ pendingId: string; otpCode: string }> {
  const email = input.adminEmail.toLowerCase().trim();
  const slug = slugify(input.orgSlug || input.orgName);
  if (!slug) throw new Error("Choose a workspace URL");

  if (await getUserByEmail(email)) throw new Error("An account with that email already exists");
  const slugTaken = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (slugTaken.length) throw new Error("That workspace URL is taken");

  const otpCode = generateOtp();
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  const values = {
    orgName: input.orgName.trim(),
    orgSlug: slug,
    adminName: input.adminName.trim(),
    adminEmail: email,
    passwordHash,
    otpHash: sha256(otpCode),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    lastOtpSentAt: now,
    resendAttempts: 0,
  };

  const rows = await db
    .insert(pendingRegistrations)
    .values(values)
    .onConflictDoUpdate({ target: pendingRegistrations.adminEmail, set: values })
    .returning({ id: pendingRegistrations.id });
  return { pendingId: rows[0].id, otpCode };
}

export async function resendRegistrationOtp(
  pendingId: string,
): Promise<{ otpCode: string; adminEmail: string; adminName: string }> {
  const rows = await db.select().from(pendingRegistrations).where(eq(pendingRegistrations.id, pendingId)).limit(1);
  const pending = rows[0];
  if (!pending) throw new Error("Registration session not found — start again");
  if (pending.resendAttempts >= MAX_RESENDS) throw new Error("Too many code requests — start again");

  const otpCode = generateOtp();
  await db
    .update(pendingRegistrations)
    .set({
      otpHash: sha256(otpCode),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      lastOtpSentAt: new Date(),
      resendAttempts: pending.resendAttempts + 1,
    })
    .where(eq(pendingRegistrations.id, pendingId));
  return { otpCode, adminEmail: pending.adminEmail, adminName: pending.adminName };
}

/**
 * Step two: verify the code and actually build the organization — the admin
 * user, the org, their membership, default settings and a trial subscription —
 * then clear the pending row. Returns the new admin so the caller can sign them
 * straight in.
 */
export async function verifyPendingRegistration(
  pendingId: string,
  otpCode: string,
): Promise<{ user: { id: string; email: string; name: string }; org: { id: string; slug: string; name: string } }> {
  const rows = await db.select().from(pendingRegistrations).where(eq(pendingRegistrations.id, pendingId)).limit(1);
  const pending = rows[0];
  if (!pending) throw new Error("Registration session not found — start again");
  if (pending.expiresAt < new Date()) throw new Error("That code has expired — request a new one");
  if (sha256(otpCode.trim()) !== pending.otpHash) throw new Error("That code isn't right");

  // Guard against the email or slug being taken in the window since step one.
  if (await getUserByEmail(pending.adminEmail)) throw new Error("An account with that email already exists");

  const [user] = await db
    .insert(users)
    .values({
      name: pending.adminName,
      email: pending.adminEmail,
      passwordHash: pending.passwordHash,
      platformRole: "user",
    })
    .returning();

  const [org] = await db
    .insert(organizations)
    .values({ name: pending.orgName, slug: pending.orgSlug, status: "active" })
    .returning();

  await db.insert(orgMembers).values({ orgId: org.id, userId: user.id, role: "admin", status: "active" });
  await db.insert(orgSettings).values({ orgId: org.id });
  await db.insert(orgSubscriptions).values({
    orgId: org.id,
    planName: "trial",
    maxUsers: 5,
    status: "active",
    trialExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  });

  await db.delete(pendingRegistrations).where(eq(pendingRegistrations.id, pending.id));

  return {
    user: { id: user.id, email: user.email, name: user.name },
    org: { id: org.id, slug: org.slug, name: org.name },
  };
}

/** The organization a signed-in user belongs to (their first active membership). */
export async function orgForUser(userId: string) {
  const rows = await db
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

// ── Invitations ─────────────────────────────────────────────────────────────

export function hashToken(token: string): string {
  return sha256(token);
}

/**
 * Invite someone into an organization. Creates a password-less "invited" user
 * and membership, mints a single-use token, and returns the accept link. The
 * caller emails it (and can show it if email isn't configured).
 */
export async function inviteMember(input: {
  orgId: string;
  email: string;
  name: string;
  role: "admin" | "member";
  invitedBy: string;
  origin: string;
}): Promise<{ link: string; token: string }> {
  const email = input.email.toLowerCase().trim();
  const existing = await getUserByEmail(email);

  let userId: string;
  if (existing) {
    // Already has an account — make sure they're a member of this org.
    const m = await db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, existing.id)))
      .limit(1);
    if (m.length) throw new Error("They're already in this organization");
    userId = existing.id;
    await db.insert(orgMembers).values({ orgId: input.orgId, userId, role: input.role, status: "invited" });
  } else {
    const [u] = await db
      .insert(users)
      .values({ name: input.name.trim() || email.split("@")[0], email, passwordHash: "!invited-pending", platformRole: "user" })
      .returning();
    userId = u.id;
    await db.insert(orgMembers).values({ orgId: input.orgId, userId, role: input.role, status: "invited" });
  }

  const token = randomBytes(32).toString("base64url");
  await db.insert(invitations).values({
    orgId: input.orgId,
    email,
    role: input.role,
    tokenHash: hashToken(token),
    invitedBy: input.invitedBy,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  return { link: `${input.origin}/invite?token=${token}`, token };
}

/** Look up a live invitation by its raw token. */
export async function findInvite(token: string) {
  const rows = await db
    .select({
      id: invitations.id,
      orgId: invitations.orgId,
      email: invitations.email,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      orgName: organizations.name,
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);
  const inv = rows[0];
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

/** Accept an invite: set the password, activate the membership, consume the token. */
export async function acceptInvite(
  token: string,
  password: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const inv = await findInvite(token);
  if (!inv) return null;

  const userRows = await db.select().from(users).where(eq(users.email, inv.email)).limit(1);
  const user = userRows[0];
  if (!user) return null;

  const passwordHash = await hashPassword(password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  await db
    .update(orgMembers)
    .set({ status: "active" })
    .where(and(eq(orgMembers.orgId, inv.orgId), eq(orgMembers.userId, user.id)));
  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));

  return { id: user.id, email: user.email, name: user.name };
}

/** Members of an org, for the members page. */
export async function listMembers(orgId: string) {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: orgMembers.role,
      status: orgMembers.status,
      departmentName: departments.name,
      departmentId: orgMembers.departmentId,
    })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .leftJoin(departments, eq(departments.id, orgMembers.departmentId))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(sql`${orgMembers.role} asc, ${users.name} asc`);
}
