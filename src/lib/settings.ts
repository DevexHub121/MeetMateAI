import "server-only";
import { db } from "@/db";
import { orgSettings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Settings someone can change from the UI, without a deploy.
 *
 * The note-taker's name used to live in RECALL_BOT_NAME. That works right up
 * until you want to change it, at which point renaming the bot means editing
 * the environment and restarting the server — so nobody ever does it. The env
 * var is still honoured as the default, so an existing deployment that set it
 * keeps the name it has today and nothing changes until someone edits it here.
 *
 * Precedence, highest first: the database row, then RECALL_BOT_NAME, then the
 * built-in default.
 */

export const DEFAULT_BOT_NAME = "Notti";

/** Meeting platforms truncate long names in the participant tile, and Recall
 *  rejects the extremes outright. Short enough to survive both. */
export const BOT_NAME_MAX = 48;

function envBotName(): string {
  return process.env.RECALL_BOT_NAME?.trim() || DEFAULT_BOT_NAME;
}

/**
 * Cleans a name into something safe to hand a meeting platform.
 *
 * Control characters and newlines matter here in a way they don't in most
 * fields: this string is rendered by Zoom/Meet/Teams in a participant list we
 * don't control, and it's the one piece of Echo an outside guest sees. Collapse
 * whitespace, drop anything unprintable, clamp the length. Returns null when
 * nothing usable is left, so a caller can tell "invalid" from "empty".
 */
export function normalizeBotName(input: string): string | null {
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BOT_NAME_MAX);
  return cleaned.length ? cleaned : null;
}

/**
 * The name the bot joins under, for one organization.
 *
 * Per-org, because in a multi-tenant product each customer names their own
 * note-taker — one company's "Acme Notes" must not become another's bot name.
 * Deliberately never throws: this is on the path that dispatches a bot into a
 * live meeting, and a settings lookup failing is no reason to fail the
 * recording — the env/default name is strictly better than not recording.
 */
export async function getBotName(orgId?: string | null): Promise<string> {
  if (!orgId) return envBotName();
  try {
    const [row] = await db
      .select({ botName: orgSettings.botName })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, orgId))
      .limit(1);
    if (row?.botName) return normalizeBotName(row.botName) ?? envBotName();
  } catch (err) {
    console.warn("[settings] could not read bot name, using default:", err);
  }
  return envBotName();
}

export async function setBotName(orgId: string, name: string): Promise<void> {
  const clean = normalizeBotName(name);
  if (!clean) throw new Error("Bot name cannot be empty");
  await db
    .insert(orgSettings)
    .values({ orgId, botName: clean })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: { botName: clean, updatedAt: sql`now()` },
    });
}
