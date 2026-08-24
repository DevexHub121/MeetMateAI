"use server";

import { redirect } from "next/navigation";
import { acceptInvite } from "@/lib/accounts";
import { createSession } from "@/lib/auth";

export async function acceptInvitation(formData: FormData) {
  const token = String(formData.get("token") || "").trim();
  const password = String(formData.get("password") || "");
  if (!token) redirect("/login");
  if (password.length < 8) {
    redirect(`/invite?token=${token}&error=${encodeURIComponent("Password must be at least 8 characters")}`);
  }

  const user = await acceptInvite(token, password);
  if (!user) {
    redirect(`/invite?token=${token}&error=${encodeURIComponent("This invite is invalid or has expired")}`);
  }

  await createSession(user);
  redirect("/meetings");
}
