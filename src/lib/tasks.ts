import "server-only";
import type { Employee, Invitee, Minutes } from "@/db/schema";

// Push action items to a Make.com webhook (one POST per item) so the Make
// scenario creates a task in ClickUp/Bitrix/etc. Configured with:
//   MAKE_TASK_WEBHOOK_URL — the webhook URL. If unset, sending is skipped.

const WEBHOOK_URL = process.env.MAKE_TASK_WEBHOOK_URL;

export type TaskResult = { sent: number; skipped: boolean; errors: string[] };

// Resolve an action-item owner (a name like "Rahul") to the real person, so the
// webhook carries their id + email. Prefers the Bitrix employee directory (it
// has ids) and falls back to the meeting's invitees (email only). Matches on
// full name first, then on first name.
type ResolvedOwner = {
  id: string | null; // internal employee uuid
  bitrixId: string | null; // Bitrix user id (what Make → Bitrix keys on)
  email: string | null;
};

function resolveOwner(
  owner: string,
  invitees: Invitee[],
  employees: Employee[],
): ResolvedOwner {
  const o = owner.trim().toLowerCase();
  if (!o || o === "unassigned") {
    return { id: null, bitrixId: null, email: null };
  }
  const firstOf = (s: string) => s.trim().toLowerCase().split(/\s+/)[0];

  const emp =
    employees.find((e) => e.name.trim().toLowerCase() === o) ??
    employees.find((e) => firstOf(e.name) === firstOf(owner));
  if (emp) {
    return { id: emp.id, bitrixId: emp.bitrixId, email: emp.email ?? null };
  }

  const inv =
    invitees.find((i) => i.name.trim().toLowerCase() === o) ??
    invitees.find((i) => firstOf(i.name) === firstOf(owner));
  return { id: null, bitrixId: null, email: inv?.email || null };
}

export async function sendActionItemsToMake(
  meeting: { id: string; title: string; meetingDate: Date | null },
  minutes: Minutes,
  invitees: Invitee[],
  employees: Employee[] = [],
): Promise<TaskResult> {
  const items = minutes.actionItems ?? [];

  if (!WEBHOOK_URL) {
    console.warn(
      `[tasks] MAKE_TASK_WEBHOOK_URL not set — skipping ${items.length} task(s).`,
    );
    return { sent: 0, skipped: true, errors: [] };
  }
  if (items.length === 0) return { sent: 0, skipped: true, errors: [] };

  const errors: string[] = [];
  let sent = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const person = resolveOwner(item.owner, invitees, employees);
    const payload = {
      source: "Echo",
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      meetingDate: meeting.meetingDate?.toISOString() ?? null,
      meetingUrl: `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/meetings/${meeting.id}`,
      // The assigned person ("candidate"): name + resolved id(s) + email.
      owner: item.owner, // candidate name (kept for existing Make mappings)
      ownerName: item.owner,
      ownerId: person.id, // internal employee id (null if not a known employee)
      ownerBitrixId: person.bitrixId, // Bitrix user id (null if unmatched)
      ownerEmail: person.email,
      task: item.task, // task detail
      due: item.due, // due date if the meeting stated one, else null
      index: i + 1,
      total: items.length,
    };
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        errors.push(`"${item.task.slice(0, 40)}": ${res.status}`);
      } else {
        sent++;
      }
    } catch (err) {
      errors.push(
        `"${item.task.slice(0, 40)}": ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  if (errors.length) console.error("[tasks] Some tasks failed:", errors);
  return { sent, skipped: false, errors };
}
