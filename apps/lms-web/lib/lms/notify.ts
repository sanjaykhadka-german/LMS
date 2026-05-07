import "server-only";
import { Resend } from "resend";
import { siteConfig } from "~/lib/site-config";

// Port of Flask's notify_attempt. Sends a one-line summary to LMS_ADMIN_EMAIL
// after a learner submits a quiz. No-op when LMS_ADMIN_EMAIL is unset, which
// matches Flask's behavior of skipping send when ADMIN_EMAIL is empty.

const apiKey = process.env.RESEND_API_KEY;
const adminEmail = process.env.LMS_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? "";
const from = `${process.env.MAIL_FROM_NAME ?? "Tracey"} <${
  process.env.MAIL_FROM ?? "no-reply@example.com"
}>`;

let resend: Resend | null = null;
function client(): Resend {
  resend ??= new Resend(apiKey!);
  return resend;
}

export async function notifyAttempt(opts: {
  learnerEmail: string;
  learnerName: string;
  moduleTitle: string;
  score: number;
  passed: boolean;
}): Promise<void> {
  if (!adminEmail || !apiKey) return; // intentional no-op
  const verdict = opts.passed ? "PASSED" : "did NOT pass";
  const subject = `[${siteConfig.name}] ${opts.learnerName} ${verdict} ${opts.moduleTitle} (${opts.score}%)`;
  const text =
    `${opts.learnerName} <${opts.learnerEmail}> ${verdict} the quiz for ` +
    `"${opts.moduleTitle}" with a score of ${opts.score}%.`;
  try {
    await client().emails.send({ from, to: adminEmail, subject, text });
  } catch (err) {
    // Don't let a Resend hiccup roll back a successful attempt insert.
    console.error("notifyAttempt failed", err);
  }
}
