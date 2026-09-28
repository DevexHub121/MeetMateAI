import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users, orgMembers, organizations } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// MeetMate's own auth. No SSO, no external identity provider — MeetMate issues and
// verifies its own session cookie, signed with AUTH_SECRET.
//
// The SessionUser shape is kept identical to what the meeting pipeline already
// expects, so everything downstream of "who is this" forked over unchanged.
// `role` collapses the platform role to the two values the app was written
// against: a MeetMate "owner" is a "superadmin", everyone else is an "admin".
// Their role *within their organization* (admin vs member) rides on `org.roleKey`.
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE_NAME = "meetmate_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type Role = "superadmin" | "admin";
export type SessionOrg = { id: string; slug: string; name: string; roleKey: "admin" | "member" };
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  org?: SessionOrg | null;
};
type SessionPayload = {
  uid: string;
  email: string;
  name: string;
  exp: number; // unix seconds
};

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function b64url(i: Buffer | string): string {
  return Buffer.from(i).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sign(d: string): string {
  return b64url(createHmac("sha256", secret()).update(d).digest());
}

function encodeSession(p: SessionPayload): string {
  const body = b64url(JSON.stringify(p));
  return `${body}.${sign(body)}`;
}

function decodeSession(token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    ) as SessionPayload;
    if (!p.uid || typeof p.exp !== "number" || p.exp * 1000 < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function hashPassword(p: string): Promise<string> {
  return bcrypt.hash(p, 10);
}
export function verifyPassword(p: string, h: string): Promise<boolean> {
  return bcrypt.compare(p, h);
}

// Cookie domain: host-only by default (one app, one host). COOKIE_DOMAIN lets a
// deployment share the session across, say, meetmate.ai and app.meetmate.ai — but it
// is dropped on localhost, where a domain-scoped cookie simply wouldn't set.
async function cookieDomain(): Promise<string | undefined> {
  const d = process.env.COOKIE_DOMAIN;
  if (!d) return undefined;
  try {
    const host = (await headers()).get("host")?.split(":")[0]?.toLowerCase() ?? "";
    if (host === "localhost" || host === "127.0.0.1") return undefined;
  } catch {
    /* headers unavailable in this context */
  }
  return d;
}

export async function createSession(user: { id: string; email: string; name: string }) {
  const token = encodeSession({
    uid: user.id,
    email: user.email,
    name: user.name,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  });
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    domain: await cookieDomain(),
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { path: "/", domain: await cookieDomain(), maxAge: 0 });
}

/**
 * Resolve the signed-in user, re-reading the database every time.
 *
 * The cookie proves identity (its HMAC can't be forged); it deliberately does
 * NOT carry the role or org membership. Those are read fresh here, so suspending
 * a member or changing their role takes effect on their next request rather than
 * whenever their week-old cookie expires. A suspended member resolves to null —
 * signed out.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const p = decodeSession(token);
  if (!p) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      platformRole: users.platformRole,
      orgId: organizations.id,
      orgSlug: organizations.slug,
      orgName: organizations.name,
      orgRole: orgMembers.role,
      memberStatus: orgMembers.status,
    })
    .from(users)
    .leftJoin(orgMembers, eq(orgMembers.userId, users.id))
    .leftJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(users.id, p.uid))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const isOwner = row.platformRole === "owner";
  // A non-owner with a suspended (or missing) membership can't sign in. Owners
  // are platform staff and always may — that's how you get back in.
  if (!isOwner && row.memberStatus !== "active") return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: isOwner ? "superadmin" : "admin",
    org: row.orgId
      ? {
          id: row.orgId,
          slug: row.orgSlug!,
          name: row.orgName!,
          roleKey: row.orgRole === "admin" ? "admin" : "member",
        }
      : null,
  };
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const clean = email.toLowerCase().trim();
  const rows = await db.select().from(users).where(eq(users.email, clean)).limit(1);
  const user = rows[0];
  if (!user) return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;

  // Password checked — now the same membership gate getCurrentUser applies, so a
  // suspended member can't log back in.
  if (user.platformRole !== "owner") {
    const m = await db
      .select({ status: orgMembers.status })
      .from(orgMembers)
      .where(and(eq(orgMembers.userId, user.id), eq(orgMembers.status, "active")))
      .limit(1);
    if (m.length === 0) return null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.platformRole === "owner" ? "superadmin" : "admin",
  };
}

async function loginRedirect(): Promise<never> {
  const h = await headers();
  const path = h.get("x-pathname") ?? "/";
  const url = new URL("/login", "http://placeholder");
  if (path && path !== "/") url.searchParams.set("next", path);
  redirect(url.pathname + url.search);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user) return user;
  return loginRedirect();
}

/** Require the platform owner (MeetMate staff). */
export async function requireSuperadmin(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) return loginRedirect();
  if (user.role !== "superadmin") redirect("/");
  return user;
}

/** Require an admin of the current org (or a platform owner). */
export async function requireOrgAdmin(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) return loginRedirect();
  const ok = user.role === "superadmin" || user.org?.roleKey === "admin";
  if (!ok) redirect("/");
  return user;
}
