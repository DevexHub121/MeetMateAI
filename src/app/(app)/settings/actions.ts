"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { BOT_NAME_MAX, normalizeBotName, setBotName } from "@/lib/settings";

/**
 * Rename the note-taker, for the caller's organization.
 *
 * The permission check lives here, not only on the page: a server action is a
 * public endpoint, and rendering the form for admins controls who sees it, not
 * who can call it.
 */
export async function updateBotName(name: string): Promise<{ name: string }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const isAdmin = user.role === "superadmin" || user.org?.roleKey === "admin";
  if (!isAdmin || !user.org) throw new Error("Only an admin can change the note-taker name");

  const clean = normalizeBotName(name);
  if (!clean) throw new Error("Enter a name for the note-taker");
  if (name.trim().length > BOT_NAME_MAX) {
    throw new Error(`Keep it under ${BOT_NAME_MAX} characters`);
  }

  await setBotName(user.org.id, clean);
  revalidatePath("/settings");
  return { name: clean };
}
