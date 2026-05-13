import { createClient } from "@/lib/supabase/server";
import MachineForm from "../_components/machine-form";

export default async function NewMachinePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user!.id)
    .single();

  const [{ data: departments }, { data: rooms }] = await Promise.all([
    supabase
      .from("departments")
      .select("id, name")
      .eq("tenant_id", profile!.tenant_id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("rooms")
      .select("id, name, code")
      .eq("tenant_id", profile!.tenant_id)
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
  ]);

  return <MachineForm mode="create" departments={departments ?? []} rooms={rooms ?? []} />;
}
