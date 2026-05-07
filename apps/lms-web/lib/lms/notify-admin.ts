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
