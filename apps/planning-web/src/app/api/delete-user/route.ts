import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  if (userId === user.id) return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });

  // Verify target user belongs to same tenant
  const { data: target } = await supabase
    .from("profiles")
    .select("id, tenant_id")
    .eq("id", userId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Also delete any pending invites for this user
  await supabase
    .from("user_invites")
    .delete()
    .eq("tenant_id", profile.tenant_id)
    .eq("email", (await supabase.from("profiles").select("email").eq("id", userId).single()).data?.email ?? "");

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
