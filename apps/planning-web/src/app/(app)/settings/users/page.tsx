import { createClient } from "@/lib/supabase/server";
import UsersManager from "./_components/users-manager";
import { redirect } from "next/navigation";

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role, role_id, tenant_id")
    .eq("id", user!.id)
    .single();

  if (!myProfile) redirect("/settings");

  // Allow access if admin/manager by old enum OR by role name via role_id
  const { data: myRoleRecord } = myProfile.role_id
    ? await supabase.from("roles").select("name").eq("id", myProfile.role_id).single()
    : { data: null };
  const myRoleName = (myRoleRecord?.name ?? myProfile.role ?? "").toLowerCase();
  if (!["admin", "manager"].includes(myRoleName)) redirect("/settings");

  const [
    { data: profiles },
    { data: invites },
    { data: departments },
    { data: categories },
    { data: deptAccess },
    { data: roles },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(`
        id, email, full_name, role, role_id, is_active, created_at, last_sign_in_at,
        phone, address_line1, address_line2, city, state, postcode, country,
        date_of_birth, start_date, finished_date,
        work_department_id, all_departments, category_id
      `)
      .eq("tenant_id", myProfile.tenant_id)
      .order("full_name"),
    supabase
      .from("user_invites")
      .select("id, email, role, role_id, status, created_at, expires_at, accepted_at, notes")
      .eq("tenant_id", myProfile.tenant_id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("departments")
      .select("id, name, code")
      .eq("tenant_id", myProfile.tenant_id)
      .eq("is_active", true)
      .order("sort_order").order("name"),
    supabase
      .from("user_categories")
      .select("id, name")
      .eq("tenant_id", myProfile.tenant_id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("user_department_access")
      .select("profile_id, department_id")
      .eq("tenant_id", myProfile.tenant_id),
    supabase
      .from("roles")
      .select("id, name, is_active")
      .eq("tenant_id", myProfile.tenant_id)
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  return (
    <UsersManager
      profiles={profiles ?? []}
      invites={invites ?? []}
      departments={departments ?? []}
      categories={categories ?? []}
      deptAccess={deptAccess ?? []}
      roles={roles ?? []}
      myRole={myRoleName}
      myId={user!.id}
      tenantId={myProfile.tenant_id}
    />
  );
}
