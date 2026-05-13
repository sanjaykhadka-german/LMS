import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildLoginEmail } from "@/lib/email-template";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const rand = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `GB-${rand(4)}-${rand(4)}`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role, tenant_id, full_name")
    .eq("id", user.id)
    .single();

  if (!callerProfile || !["admin", "manager"].includes(callerProfile.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { user_id } = await req.json() as { user_id: string };
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("email, role")
    .eq("id", user_id)
    .eq("tenant_id", callerProfile.tenant_id)
    .single();

  if (!targetProfile?.email) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const tempPassword = generateTempPassword();
  const admin = createAdminClient();

  const { error: updateErr } = await admin.auth.admin.updateUserById(user_id, { password: tempPassword });
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await admin.from("profiles").update({ force_password_change: true }).eq("id", user_id);

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "Email not configured" }, { status: 500 });

  const fromEmail = process.env.EMAIL_FROM ?? "noreply@send.germanbutchery.com.au";
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tracey-planning-app.vercel.app";
  const loginLink = `${appUrl}/auth/login?email=${encodeURIComponent(targetProfile.email)}&tmp=${encodeURIComponent(tempPassword)}`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `German Butchery <${fromEmail}>`,
      to: [targetProfile.email],
      subject: "Your new login details — German Butchery Production Planning",
      html: buildLoginEmail({
        greetingLine: "New login details",
        subtitleLine: `Your access has been reset by ${callerProfile.full_name ?? "your admin"}. Click below to log in and set a new password.`,
        userEmail: targetProfile.email,
        loginLink,
      }),
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.json().catch(() => ({}));
    return NextResponse.json({ error: (err as any).message ?? "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
