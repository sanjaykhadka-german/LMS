import { createClient } from "@/lib/supabase/server";
import DepartmentsManager from "./_components/departments-manager";

export default async function DepartmentsPage() {
  const supabase = await createClient();
  const { data: departments } = await supabase
    .from("departments")
    .select("*")
    .order("sort_order")
    .order("name");

  return <DepartmentsManager initialDepartments={departments ?? []} />;
}
