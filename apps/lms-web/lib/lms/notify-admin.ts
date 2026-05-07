import "server-only";
import { Resend } from "resend";
import { siteConfig } from "~/lib/site-config";

// Ports of email_service.py notify_invite + notify_password_reset, sent
// via the same Resend account already used by /sign-up + invitations.
// All sends are best-effort: if the Resend call fails, we log and resolve
// — admin actions never roll back because of email I/O. The temp password
// is also surfaced in the admin UI flash, so the admin can share it
// manually if the email never arrives.

const apiKey = process.env.RESEND_API_KEY;
const from = `${process.env.MAIL_FROM_NAME ?? siteConfig.name} <${
  process.env.MAIL_FROM ?? "no-reply@example.com"
}>`;

let resend: Resend | null = null;
function client(): Resend {
  resend ??= new Resend(apiKey!);
  return resend;
}

const baseUrl = (): string => siteConfig.url.replace(/\/$/, "");

interface Envelope {
  to: string;
  name: string | null;
  tempPassword: string;
}

export async function sendInviteEmail(opts: Envelope): Promise<boolean> {
  if (!apiKey) return false;
  const greeting = opts.name ? `Hi ${opts.name},` : "Hi,";
  const html =
    `<p>${greeting}</p>` +
    `<p>You've been invited to the ${siteConfig.name} training portal.</p>` +
    `<p><b>Sign in:</b> <a href="${baseUrl()}/sign-in">${baseUrl()}/sign-in</a><br>` +
    `<b>Email:</b> ${opts.to}<br>` +
    `<b>Temporary password:</b> ${opts.tempPassword}</p>` +
    `<p>Please change your password after signing in.</p>`;
  try {
    await client().emails.send({
      from,
      to: opts.to,
      subject: `Your ${siteConfig.name} training account`,
      html,
    });
    return true;
  } catch (err) {
    console.error("[admin/invite] email failed:", err);
    return false;
  }
}

export async function sendAssignmentReminderEmail(opts: {
  to: string;
  name: string | null;
  moduleTitles: string[];
}): Promise<boolean> {
  if (!apiKey) return false;
  const greeting = opts.name ? `Hi ${opts.name},` : "Hi,";
  const items = opts.moduleTitles.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const html =
    `<p>${greeting}</p>` +
    `<p>You have outstanding training modules:</p>` +
    `<ul>${items}</ul>` +
    `<p><a href="${baseUrl()}/app/my/modules">Open your portal</a></p>`;
  try {
    await client().emails.send({
      from,
      to: opts.to,
      subject: "Reminder: outstanding training",
      html,
    });
    return true;
  } catch (err) {
    console.error("[admin/reminder] email failed:", err);
    return false;
  }
}

export async function sendWhsExpiryReminderEmail(opts: {
  to: string;
  name: string | null;
  kindLabel: string;
  recordTitle: string;
  expiresOn: string | null;
}): Promise<boolean> {
  if (!apiKey) return false;
  const greeting = opts.name ? `Hi ${opts.name},` : "Hi,";
  const expires = opts.expiresOn ? formatDate(opts.expiresOn) : "soon";
  const html =
    `<p>${greeting}</p>` +
    `<p>Your ${escapeHtml(opts.kindLabel.toLowerCase())} <b>${escapeHtml(
      opts.recordTitle,
    )}</b> expires on <b>${expires}</b>.</p>` +
    `<p>Please start renewal now and let your manager know once it's done.</p>`;
  try {
    await client().emails.send({
      from,
      to: opts.to,
      subject: `Reminder: ${opts.kindLabel} expires ${expires}`,
      html,
    });
    return true;
  } catch (err) {
    console.error("[admin/whs-reminder] email failed:", err);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(yyyyMmDd: string): string {
  const d = new Date(yyyyMmDd);
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

export async function sendPasswordResetEmail(opts: Envelope): Promise<boolean> {
  if (!apiKey) return false;
  const greeting = opts.name ? `Hi ${opts.name},` : "Hi,";
  const html =
    `<p>${greeting}</p>` +
    `<p>An administrator has reset your password for the ${siteConfig.name} training portal.</p>` +
    `<p><b>Sign in:</b> <a href="${baseUrl()}/sign-in">${baseUrl()}/sign-in</a><br>` +
    `<b>Email:</b> ${opts.to}<br>` +
    `<b>New temporary password:</b> ${opts.tempPassword}</p>` +
    `<p>Please change your password after signing in.</p>`;
  try {
    await client().emails.send({
      from,
      to: opts.to,
      subject: `Your ${siteConfig.name} password was reset`,
      html,
    });
    return true;
  } catch (err) {
    console.error("[admin/password-reset] email failed:", err);
    return false;
  }
}
