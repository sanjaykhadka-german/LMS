import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "manager"].includes(profile.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { user_id } = await req.json() as { user_id: string };
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  // Get the target user's email (must be in same tenant)
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user_id)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!targetProfile?.email) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Use admin client to generate recovery link (bypasses rate limits)
  const admin = createAdminClient();
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: targetProfile.email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/reset-password`,
    },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    return NextResponse.json({ error: linkErr?.message ?? "Failed to generate reset link" }, { status: 500 });
  }

  // Send via Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: "Email not configured" }, { status: 500 });
  }

  const fromEmail = process.env.EMAIL_FROM ?? "noreply@send.germanbutchery.com.au";
  const resetLink = linkData.properties.action_link;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `German Butchery <${fromEmail}>`,
      to: [targetProfile.email],
      subject: "Reset your password — German Butchery Production Planning",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
          <h2 style="color: #1c1917; margin-bottom: 0.5rem;">Reset your password</h2>
          <p style="color: #57534e;">A password reset has been requested for your account. Click the button below to set a new password.</p>
          <a href="${resetLink}" style="display: inline-block; margin: 1.5rem 0; background: #b91c1c; color: white; text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600;">
            Reset password
          </a>
          <p style="color: #a8a29e; font-size: 0.8125rem;">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e7e5e4; margin: 1.5rem 0;" />
          <p style="color: #a8a29e; font-size: 0.75rem;">German Butchery Pty Ltd · Internal use only</p>
        </div>
      `,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.json();
    return NextResponse.json({ error: err.message ?? "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
