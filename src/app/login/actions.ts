"use server";

import { redirect } from "next/navigation";
import { authenticate, createSession } from "@/lib/auth";

/** Safe internal-only redirect target. */
function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/meetings";
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) redirect(`/login?error=missing&next=${encodeURIComponent(next)}`);

  const user = await authenticate(email, password);
  if (!user) redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);

  await createSession(user);
  redirect(next);
}
