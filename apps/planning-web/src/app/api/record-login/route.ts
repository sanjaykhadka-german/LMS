import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, force_password_change")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.json({ ok: false }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Insert login record
  await supabase.from("user_logins").insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    user_email: user.email,
    ip_address: ip,
  });

  // Update last_sign_in_at on profile
  await supabase
    .from("profiles")
    .update({ last_sign_in_at: new Date().toISOString() })
    .eq("id", user.id);

  return NextResponse.json({ ok: true, force_password_change: profile.force_password_change ?? false });
}
