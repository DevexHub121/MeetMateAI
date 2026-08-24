import "server-only";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
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

export const DEFAULT_BOT_NAME = "Echo Notetaker";

/** Meeting platforms truncate long names in the participant tile, and Recall
 *  rejects the extremes outright. Short enough to survive both. */
export const BOT_NAME_MAX = 48;

const KEY_BOT_NAME = "bot_name";

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

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

/**
 * The name the bot joins under.
 *
 * Deliberately never throws. This is called on the path that dispatches a bot
 * into a live meeting, and a settings lookup failing is not a good reason to
 * fail the recording — falling back to the env/default name is strictly better
 * than not recording the call.
 */
export async function getBotName(): Promise<string> {
  try {
    const stored = await readSetting(KEY_BOT_NAME);
    if (stored) return normalizeBotName(stored) ?? envBotName();
  } catch (err) {
    console.warn("[settings] could not read bot name, using default:", err);
  }
  return envBotName();
}

export async function setBotName(name: string, userId: string | null): Promise<void> {
  const clean = normalizeBotName(name);
  if (!clean) throw new Error("Bot name cannot be empty");
  await db
    .insert(appSettings)
    .values({ key: KEY_BOT_NAME, value: clean, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: sql`excluded.value`,
        updatedAt: sql`now()`,
        updatedByUserId: sql`excluded.updated_by_user_id`,
      },
    });
}
