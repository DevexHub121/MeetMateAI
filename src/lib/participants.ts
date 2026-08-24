import { db } from "@/db";
import {
  savedParticipants,
  type Invitee,
  type SavedParticipant,
} from "@/db/schema";
import { asc, sql } from "drizzle-orm";

export async function listSavedParticipants(): Promise<SavedParticipant[]> {
  return db
    .select()
    .from(savedParticipants)
    .orderBy(asc(savedParticipants.name));
}

// Upsert everyone added to a meeting into the address book, deduped by email
// (case-insensitive). Refreshes the stored name when it changes. Rows without a
// valid email are skipped — email is the identity here.
export async function saveParticipants(invitees: Invitee[]): Promise<void> {
  const rows = invitees
    .map((i) => ({
      name: (i.name || i.email).trim(),
      email: i.email.trim().toLowerCase(),
    }))
    .filter((r) => r.email.includes("@"));
  if (rows.length === 0) return;

  // Dedupe within this batch so one insert doesn't hit the unique constraint twice.
  const unique = Array.from(new Map(rows.map((r) => [r.email, r])).values());

  await db
    .insert(savedParticipants)
    .values(unique)
    .onConflictDoUpdate({
      target: savedParticipants.email,
      set: { name: sql`excluded.name` },
    });
}
