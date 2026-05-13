import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (!myProfile || !["admin", "manager"].includes(myProfile.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const profileId = searchParams.get("user_id");
  if (!profileId) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const admin = createAdminClient();

  const [{ data: logins }, { data: actions }] = await Promise.all([
    admin
      .from("user_logins")
      .select("id, ip_address, created_at")
      .eq("user_id", profileId)
      .eq("tenant_id", myProfile.tenant_id)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("audit_log")
      .select("id, action, table_name, record_label, changed_fields, created_at")
      .eq("user_id", profileId)
      .eq("tenant_id", myProfile.tenant_id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return NextResponse.json({ logins: logins ?? [], actions: actions ?? [] });
}
