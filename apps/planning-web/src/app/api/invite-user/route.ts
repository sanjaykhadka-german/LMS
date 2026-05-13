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
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role, role_id, tenant_id, full_name")
    .eq("id", user.id)
    .single();

  if (!callerProfile) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  // Resolve caller's role name (prefer new role_id, fall back to old enum)
  let callerRoleName = callerProfile.role ?? "";
  if (callerProfile.role_id) {
    const { data: rr } = await supabase.from("roles").select("name").eq("id", callerProfile.role_id).single();
    if (rr) callerRoleName = rr.name.toLowerCase();
  }
  if (!["admin", "manager"].includes(callerRoleName)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { email, role_id, notes } = await req.json() as { email: string; role_id: string; notes?: string };
  if (!email || !role_id) return NextResponse.json({ error: "email and role_id are required" }, { status: 400 });

  // Validate role_id belongs to this tenant
  const { data: targetRole } = await supabase
    .from("roles")
    .select("id, name")
    .eq("id", role_id)
    .eq("tenant_id", callerProfile.tenant_id)
    .single();
  if (!targetRole) return NextResponse.json({ error: "Invalid role" }, { status: 400 });

  if (callerRoleName === "manager" && targetRole.name.toLowerCase() === "admin") {
    return NextResponse.json({ error: "Managers cannot invite admins" }, { status: 403 });
  }

  const cleanEmail = email.toLowerCase().trim();
  const admin = createAdminClient();

  const { data: existingInTenant } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("tenant_id", callerProfile.tenant_id)
    .eq("email", cleanEmail)
    .maybeSingle();

  if (existingInTenant) {
    return NextResponse.json({ error: "This email already has an account in your team." }, { status: 409 });
  }

  const tempPassword = generateTempPassword();

  const { data: { users: existingUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existingAuthUser = existingUsers.find(u => u.email?.toLowerCase() === cleanEmail);

  let newUserId: string;

  if (existingAuthUser) {
    const { error: updateErr } = await admin.auth.admin.updateUserById(existingAuthUser.id, { password: tempPassword });
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    newUserId = existingAuthUser.id;
  } else {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
    });
    if (createErr || !newUser.user) {
      return NextResponse.json({ error: createErr?.message ?? "Failed to create user" }, { status: 500 });
    }
    newUserId = newUser.user.id;
  }

  const { error: profileErr } = await admin.from("profiles").upsert({
    id: newUserId,
    tenant_id: callerProfile.tenant_id,
    email: cleanEmail,
    role: targetRole.name.toLowerCase(),  // keep old enum in sync for backward compat
    role_id: targetRole.id,
    force_password_change: true,
  }, { onConflict: "id" });

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });

  await supabase.from("user_invites").insert({
    tenant_id: callerProfile.tenant_id,
    invited_by: user.id,
    email: cleanEmail,
    role: targetRole.name.toLowerCase(),
    role_id: targetRole.id,
    notes: notes ?? null,
    status: "accepted",
  }).then(() => {});

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "Email not configured" }, { status: 500 });

  const fromEmail = process.env.EMAIL_FROM ?? "noreply@send.germanbutchery.com.au";
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tracey-planning-app.vercel.app";
  const loginLink = `${appUrl}/auth/login?email=${encodeURIComponent(cleanEmail)}&tmp=${encodeURIComponent(tempPassword)}`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `German Butchery <${fromEmail}>`,
      to: [cleanEmail],
      subject: "Welcome to German Butchery Production Planning",
      html: buildLoginEmail({
        greetingLine: "Welcome to the team!",
        subtitleLine: `Your account has been set up by ${callerProfile.full_name ?? "your admin"}. Click below to log in and set your password.`,
        userEmail: cleanEmail,
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
