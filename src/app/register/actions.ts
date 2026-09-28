"use server";

import { redirect } from "next/navigation";
import { createPendingRegistration, resendRegistrationOtp, verifyPendingRegistration } from "@/lib/accounts";
import { createSession } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

function otpEmail(name: string, code: string): string {
  return `<p>Hi ${name || "there"},</p>
    <p>Your MeetMate verification code is:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
    <p>It expires in 15 minutes.</p>`;
}

export async function startRegistration(formData: FormData) {
  const orgName = String(formData.get("orgName") || "").trim();
  const orgSlug = String(formData.get("orgSlug") || "").trim();
  const adminName = String(formData.get("adminName") || "").trim();
  const adminEmail = String(formData.get("adminEmail") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!orgName || !adminName || !adminEmail || password.length < 8) {
    redirect("/register?error=" + encodeURIComponent("Fill everything in — password at least 8 characters"));
  }

  let result;
  try {
    result = await createPendingRegistration({ orgName, orgSlug, adminName, adminEmail, password });
  } catch (err) {
    redirect("/register?error=" + encodeURIComponent(err instanceof Error ? err.message : "Couldn't start signup"));
  }

  const emailed = await sendEmail(adminEmail, "Verify your MeetMate workspace", otpEmail(adminName, result.otpCode));
  // When no email provider is set (local/dev), pass the code through the URL so
  // signup is still completable. Harmless in that mode; never reached in prod.
  const devCode = emailed ? "" : `&code=${result.otpCode}`;
  redirect(`/register/verify?token=${result.pendingId}${devCode}`);
}

export async function verifyRegistration(formData: FormData) {
  const token = String(formData.get("token") || "").trim();
  const code = String(formData.get("code") || "").trim();
  if (!token || !code) redirect(`/register/verify?token=${token}&error=${encodeURIComponent("Enter the code")}`);

  let result;
  try {
    result = await verifyPendingRegistration(token, code);
  } catch (err) {
    redirect(`/register/verify?token=${token}&error=${encodeURIComponent(err instanceof Error ? err.message : "Invalid code")}`);
  }

  await createSession(result.user);
  redirect("/meetings");
}

export async function resendRegistration(formData: FormData) {
  const token = String(formData.get("token") || "").trim();
  if (!token) redirect("/register");
  try {
    const r = await resendRegistrationOtp(token);
    await sendEmail(r.adminEmail, "Your new MeetMate code", otpEmail(r.adminName, r.otpCode));
  } catch (err) {
    redirect(`/register/verify?token=${token}&error=${encodeURIComponent(err instanceof Error ? err.message : "Couldn't resend")}`);
  }
  redirect(`/register/verify?token=${token}&resent=1`);
}
