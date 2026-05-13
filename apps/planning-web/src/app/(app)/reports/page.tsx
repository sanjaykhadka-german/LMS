import { createClient } from "@/lib/supabase/server";
import ReportsClient from "./reports-client";

export default async function ReportsPage() {
  const supabase = await createClient();

  const [{ data: schedules }, { data: rawMaterials }, { data: products }] = await Promise.all([
    supabase.from("production_schedules").select("id, week_start, status").order("week_start", { ascending: false }).limit(20),
    supabase.from("raw_materials").select("*").order("name"),
    supabase.from("products").select("*").order("name"),
  ]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports & Export</h1>
          <p className="page-subtitle">Download production schedules, specifications and inventory data</p>
        </div>
      </div>

      <ReportsClient
        schedules={schedules ?? []}
        rawMaterials={rawMaterials ?? []}
        products={products ?? []}
      />
    </div>
  );
}
