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

  /*
   * Hand the email back on failure so the form can refill it.
   *
   * A failed sign-in redirects, which means a fresh render and empty inputs —
   * so a single typo cost you both fields and most people retype the address
   * they already had right. The password is deliberately not carried: it would
   * sit in the URL, and from there in browser history, the referer header and
   * every access log between here and the user.
   */
  const back = (why: string) =>
    `/login?error=${why}&next=${encodeURIComponent(next)}` +
    (email ? `&email=${encodeURIComponent(email)}` : "");

  if (!email || !password) redirect(back("missing"));

  const user = await authenticate(email, password);
  if (!user) redirect(back("invalid"));

  await createSession(user);
  redirect(next);
}
