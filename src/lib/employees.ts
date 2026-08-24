import { db } from "@/db";
import { employees, type Employee } from "@/db/schema";
import { asc, sql } from "drizzle-orm";
import { fetchBitrixEmployees } from "@/lib/bitrix";

export async function listEmployees(): Promise<Employee[]> {
  return db.select().from(employees).orderBy(asc(employees.name));
}

// Pull the directory from Bitrix and upsert by Bitrix ID. Anyone previously
// synced but no longer returned (i.e. deactivated) is marked inactive rather
// than deleted, so historical meeting invitees keep resolving.
export async function syncEmployeesFromBitrix(): Promise<{ synced: number }> {
  const fetched = await fetchBitrixEmployees();
  if (fetched.length === 0) return { synced: 0 };

  const now = new Date();
  const rows = fetched.map((e) => ({
    bitrixId: e.bitrixId,
    name: e.name,
    email: e.email,
    position: e.position,
    active: true,
    syncedAt: now,
  }));

  await db
    .insert(employees)
    .values(rows)
    .onConflictDoUpdate({
      target: employees.bitrixId,
      set: {
        name: sql`excluded.name`,
        email: sql`excluded.email`,
        position: sql`excluded.position`,
        active: sql`excluded.active`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  // Deactivate anyone not in this sync (kept in the DB, hidden from pickers).
  const ids = rows.map((r) => r.bitrixId);
  await db
    .update(employees)
    .set({ active: false })
    .where(sql`${employees.bitrixId} not in ${ids}`);

  return { synced: rows.length };
}
