"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { BOT_NAME_MAX, normalizeBotName, setBotName } from "@/lib/settings";

/**
 * Rename the note-taker.
 *
 * The permission check lives here, not only on the page. A server action is a
 * real endpoint that anyone can POST to — rendering the form behind
 * requireSuperadmin() controls who *sees* it, not who can *call* it, and this
 * setting is instance-wide.
 */
export async function updateBotName(name: string): Promise<{ name: string }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  if (user.role !== "superadmin") {
    throw new Error("Only a superadmin can change the note-taker name");
  }

  const clean = normalizeBotName(name);
  if (!clean) throw new Error("Enter a name for the note-taker");
  if (name.trim().length > BOT_NAME_MAX) {
    throw new Error(`Keep it under ${BOT_NAME_MAX} characters`);
  }

  await setBotName(clean, user.id);
  revalidatePath("/settings");
  return { name: clean };
}
