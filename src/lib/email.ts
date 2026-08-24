import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type { Invitee, Minutes } from "@/db/schema";

// Email delivery with two backends, chosen by env:
//   1. SMTP (free — send through your own Gmail/Workspace mailbox). Set:
//        SMTP_HOST (e.g. smtp.gmail.com), SMTP_PORT (465), SMTP_USER, SMTP_PASS
//        (a Google *app password*), and EMAIL_FROM.
//   2. Resend (https://resend.com) — set RESEND_API_KEY + EMAIL_FROM.
// If neither is configured, sending is skipped (logged) so the pipeline still
// runs in local dev.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Notti <onboarding@resend.dev>";
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 465);
const useSmtp = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const useResend = Boolean(RESEND_API_KEY);

export type EmailResult = { sent: number; skipped: boolean; errors: string[] };

type Attachment = {
  filename: string;
  content: string; // base64
  contentType?: string;
};

let _transport: Transporter | null = null;
function smtp(): Transporter {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return _transport;
}

// Low-level delivery: one email per recipient (so addresses aren't exposed to
// each other). Uses SMTP if configured, else Resend, else skips.
async function deliver(
  label: string,
  recipients: Invitee[],
  subject: string,
  html: string,
  attachments?: Attachment[],
): Promise<EmailResult> {
  const to = recipients.filter((i) => i.email && i.email.includes("@"));
  if (!useSmtp && !useResend) {
    console.warn(
      `[email] No email provider configured (SMTP_* or RESEND_API_KEY) — skipping ${label} to ${to.length} recipient(s).`,
    );
    return { sent: 0, skipped: true, errors: [] };
  }
  if (to.length === 0) return { sent: 0, skipped: true, errors: [] };

  const errors: string[] = [];
  let sent = 0;
  for (const r of to) {
    try {
      if (useSmtp) {
        await smtp().sendMail({
          from: EMAIL_FROM,
          to: r.email,
          subject,
          html,
          attachments: attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
            encoding: "base64",
            contentType: a.contentType,
          })),
        });
      } else {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: [r.email],
            subject,
            html,
            ...(attachments && attachments.length ? { attachments } : {}),
          }),
        });
        if (!res.ok) {
          throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        }
      }
      sent++;
    } catch (err) {
      errors.push(
        `${r.email}: ${err instanceof Error ? err.message : "send failed"}`,
      );
    }
  }
  if (errors.length) console.error(`[email] Some ${label} failed:`, errors);
  return { sent, skipped: false, errors };
}

/**
 * Send one transactional email (OTP codes, invitations). Returns whether it
 * actually went out, so callers can fall back to showing the code/link on
 * screen when no email provider is configured.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const res = await deliver("transactional", [{ name: "", email: to }], subject, html);
  return res.sent > 0;
}

export async function sendMinutesEmail(
  meeting: { id: string; title: string; meetingDate: Date | null },
  minutes: Minutes,
  invitees: Invitee[],
): Promise<EmailResult> {
  return deliver(
    "minutes email",
    invitees,
    `Minutes of Meeting — ${meeting.title}`,
    renderMinutesHtml(meeting, minutes),
  );
}

// Invitation email sent when a meeting is scheduled for later, with an .ics
// calendar attachment and a link to the meeting in Echo.
export async function sendInviteEmail(
  meeting: { id: string; title: string; meetingDate: Date | null },
  invitees: Invitee[],
): Promise<EmailResult> {
  const attachments = meeting.meetingDate
    ? [
        {
          filename: "invite.ics",
          content: toBase64(buildIcs(meeting)),
          contentType: "text/calendar; method=REQUEST",
        },
      ]
    : undefined;
  return deliver(
    "invite email",
    invitees,
    `Meeting invite — ${meeting.title}`,
    renderInviteHtml(meeting, invitees),
    attachments,
  );
}

function toBase64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

// Minimal RFC-5545 VEVENT so the invite lands in the recipient's calendar.
// Defaults to a 30-minute slot (we don't know the real duration up front).
function buildIcs(meeting: {
  id: string;
  title: string;
  meetingDate: Date | null;
}): string {
  const start = meeting.meetingDate ?? new Date();
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Notti//Meeting//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@echo`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${icsEscape(meeting.title)}`,
    `DESCRIPTION:${icsEscape(`Join in Notti: ${APP_URL}/meetings/${meeting.id}`)}`,
    `URL:${APP_URL}/meetings/${meeting.id}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function icsEscape(s: string): string {
  return s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

function renderInviteHtml(
  meeting: { id: string; title: string; meetingDate: Date | null },
  invitees: Invitee[],
): string {
  const dateStr = meeting.meetingDate
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(meeting.meetingDate)
    : "Time to be decided";
  const who = invitees
    .map((i) => esc(i.name))
    .filter(Boolean)
    .join(", ");
  const link = `${APP_URL}/meetings/${meeting.id}`;

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;padding:8px">
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border-radius:12px;padding:20px 24px">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.85">Meeting invite</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(meeting.title)}</div>
    </div>
    <div style="padding:16px 4px;color:#374151;font-size:14px;line-height:1.6">
      <p style="margin:0 0 10px"><strong>When:</strong> ${esc(dateStr)} (IST)</p>
      ${who ? `<p style="margin:0 0 10px"><strong>Participants:</strong> ${who}</p>` : ""}
      <p style="margin:14px 0">
        <a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open in Notti</a>
      </p>
      <p style="color:#6b7280;font-size:13px;margin:8px 0 0">A calendar invite (.ics) is attached. You'll receive the minutes here automatically once the meeting is recorded and analyzed.</p>
    </div>
    <div style="color:#9ca3af;font-size:12px;padding:12px 4px;border-top:1px solid #f3f4f6">Sent by Echo.</div>
  </div>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function list(items: string[]): string {
  if (!items.length) return "";
  return `<ul style="margin:6px 0 16px;padding-left:20px;color:#374151;font-size:14px;line-height:1.6">${items
    .map((i) => `<li>${esc(i)}</li>`)
    .join("")}</ul>`;
}

function section(title: string, inner: string): string {
  if (!inner) return "";
  return `<h2 style="margin:20px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">${esc(
    title,
  )}</h2>${inner}`;
}

function renderMinutesHtml(
  meeting: { title: string; meetingDate: Date | null },
  m: Minutes,
): string {
  const dateStr = meeting.meetingDate
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(meeting.meetingDate)
    : "";

  const actionRows = m.actionItems.length
    ? `<table style="width:100%;border-collapse:collapse;margin:6px 0 16px;font-size:14px">
        <thead>
          <tr style="text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase">
            <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">Owner</th>
            <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">Task</th>
            <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">Due</th>
          </tr>
        </thead>
        <tbody>
          ${m.actionItems
            .map(
              (a) =>
                `<tr>
                  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#111827">${esc(
                    a.owner,
                  )}</td>
                  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;color:#374151">${esc(
                    a.task,
                  )}</td>
                  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;color:#6b7280">${esc(
                    a.due ?? "—",
                  )}</td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>`
    : `<p style="color:#6b7280;font-size:14px">No action items recorded.</p>`;

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;padding:8px">
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border-radius:12px;padding:20px 24px">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.85">Minutes of Meeting</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(meeting.title)}</div>
      ${dateStr ? `<div style="font-size:13px;opacity:.9;margin-top:2px">${esc(dateStr)}</div>` : ""}
    </div>
    <div style="padding:12px 4px">
      ${section("Summary", `<p style="color:#374151;font-size:14px;line-height:1.6;margin:6px 0 16px">${esc(m.summary)}</p>`)}
      ${section("Attendees", m.attendees.length ? `<p style="color:#374151;font-size:14px;margin:6px 0 16px">${m.attendees.map(esc).join(" · ")}</p>` : "")}
      ${section("Agenda", list(m.agenda))}
      ${section("Key points", list(m.keyPoints))}
      ${section("Decisions", list(m.decisions))}
      ${section("Action items", actionRows)}
      ${section("Risks & open questions", list(m.risks))}
      ${section("Next steps", list(m.nextSteps))}
    </div>
    <div style="color:#9ca3af;font-size:12px;padding:12px 4px;border-top:1px solid #f3f4f6">
      Generated automatically by Echo.
    </div>
  </div>`;
}
