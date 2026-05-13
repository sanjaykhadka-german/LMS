import { createClient } from "@/lib/supabase/server";
import UnitsOfMeasureManager from "./_components/units-of-measure-manager";

export default async function UnitsOfMeasurePage() {
  const supabase = await createClient();
  const { data: uoms } = await supabase
    .from("units_of_measure")
    .select("*")
    .order("sort_order")
    .order("code");

  // Pull current usage counts so the operator can see which UOMs are in use
  // (and avoid deleting a UOM that's wired into items).
  const { data: items } = await supabase
    .from("items")
    .select("unit, batch_unit, purchase_uom");

  const usage: Record<string, number> = {};
  for (const it of items ?? []) {
    for (const code of [it.unit, it.batch_unit, it.purchase_uom]) {
      if (!code) continue;
      const k = String(code).trim().toLowerCase();
      if (!k) continue;
      usage[k] = (usage[k] ?? 0) + 1;
    }
  }

  return <UnitsOfMeasureManager initialUoms={uoms ?? []} usage={usage} />;
}
