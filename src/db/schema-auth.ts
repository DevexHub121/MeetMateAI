import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Notti's own identity and multi-tenant model. Unlike the Orbit-era Echo, which
// borrowed its login from a shared SSO portal, Notti is a standalone SaaS: it
// owns its accounts, its organizations, and the wall between one customer's data
// and another's.
//
// The model, kept deliberately small because Notti is a single product (the
// note-taker), not a suite:
//   • a person is a `user` (email + password)
//   • a company is an `organization`
//   • membership ties them together with an org role (admin or member)
//   • everything a customer creates — every meeting — belongs to an org
// ─────────────────────────────────────────────────────────────────────────────

// "owner" is Notti staff — the people who run the platform and can see across
// organizations for support. Everyone who signs up is a "user".
export const platformRoleEnum = pgEnum("platform_role", ["owner", "user"]);

// Within one organization. An admin manages members and settings; a member
// just uses the product.
export const orgRoleEnum = pgEnum("org_role", ["admin", "member"]);

export const memberStatusEnum = pgEnum("member_status", [
  "active",
  "invited",
  "suspended",
]);

// ── Users ─────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  // bcrypt. A sentinel that can never satisfy bcrypt.compare ("!invited-pending")
  // marks an invited account that hasn't set a password yet.
  passwordHash: text("password_hash").notNull(),
  platformRole: platformRoleEnum("platform_role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Organizations ─────────────────────────────────────────────────────
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  status: varchar("status", { length: 50 }).default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Departments (optional grouping within an org) ─────────────────────
export const departments = pgTable("departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Memberships ───────────────────────────────────────────────────────
export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: orgRoleEnum("role").default("member").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    status: memberStatusEnum("status").default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueOrgMember: unique("org_member_unique").on(t.orgId, t.userId),
  }),
);

// ── Org settings ──────────────────────────────────────────────────────
export const orgSettings = pgTable("org_settings", {
  orgId: uuid("org_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .primaryKey(),
  allowedDomains: text("allowed_domains"),
  // The name the note-taker bot joins calls under, per organization.
  botName: varchar("bot_name", { length: 80 }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Subscriptions ─────────────────────────────────────────────────────
export const orgSubscriptions = pgTable("org_subscriptions", {
  orgId: uuid("org_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .primaryKey(),
  planName: varchar("plan_name", { length: 50 }).default("trial").notNull(),
  maxUsers: integer("max_users").default(5).notNull(),
  status: varchar("status", { length: 50 }).default("active").notNull(),
  trialExpiresAt: timestamp("trial_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Pending registrations (OTP-gated org signup) ──────────────────────
export const pendingRegistrations = pgTable("pending_registrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgName: varchar("org_name", { length: 255 }).notNull(),
  orgSlug: varchar("org_slug", { length: 100 }).notNull(),
  adminName: varchar("admin_name", { length: 255 }).notNull(),
  adminEmail: varchar("admin_email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  otpHash: text("otp_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  lastOtpSentAt: timestamp("last_otp_sent_at").notNull(),
  resendAttempts: integer("resend_attempts").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Invitations ───────────────────────────────────────────────────────
export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  role: orgRoleEnum("role").default("member").notNull(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id, {
    onDelete: "set null",
  }),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;
export type Department = typeof departments.$inferSelect;
