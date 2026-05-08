import { SignJWT } from "jose";
import { requireUser, requireTenant } from "~/lib/auth/current";
import { siteConfig } from "~/lib/site-config";

// Phase 2 SSO bridge. The dashboard's "Open Training" button GETs this
// route; we mint a 60-second HS256 JWT scoped to the user's active tenant
// and return an auto-submitting form that POSTs the token to Flask
// `/sso/callback`. Form-post (rather than ?token=...) keeps the JWT out of
// browser history, the Render access log, and any subsequent Referer
// header.
export async function GET() {
  const secret = process.env.LMS_SSO_SECRET;
  const flaskBase = process.env.FLASK_BASE_URL ?? siteConfig.links.flask;
  if (!secret) {
    return new Response("SSO is not configured (missing LMS_SSO_SECRET).", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!flaskBase) {
    return new Response("SSO is not configured (missing FLASK_BASE_URL).", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // requireUser/requireMembership redirect to /sign-in or /onboarding when
  // their preconditions are unmet, so by the time we read these we have a
  // real user with an active tenant + role.
  const user = await requireUser();
  const { tenant, role } = await requireTenant();

  const token = await new SignJWT({
    email: user.email.toLowerCase(),
    name: user.name ?? null,
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    tenant_status: tenant.status,
    role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("tracey")
    .setAudience("flask-lms")
    .setSubject(user.id)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(new TextEncoder().encode(secret));

  const action = `${flaskBase.replace(/\/$/, "")}/sso/callback`;
  // Auto-submitting form. The <noscript> branch keeps it usable for users
  // with JS disabled — they get a one-click button instead of an instant
  // redirect.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Opening Training…</title>
<meta name="referrer" content="no-referrer">
</head>
<body>
<form id="sso" method="POST" action="${escapeHtml(action)}">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<noscript><button type="submit">Continue to Training</button></noscript>
</form>
<script>document.getElementById('sso').submit();</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
