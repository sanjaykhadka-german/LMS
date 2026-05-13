import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import PriceGroupsManager from "./_components/price-groups-manager";
import { TENANT_FULL_FETCH } from "@/lib/limits";

export default async function PriceGroupsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role, tenant_id").eq("id", user!.id).single();
  const role = profile?.role ?? "viewer";
  if (!["admin", "manager", "super_admin"].includes(role)) redirect("/settings");

  const [{ data: groups }, { data: items }, { data: costs }, { data: buffers }] = await Promise.all([
    supabase.from("price_groups").select(`
      id, code, name, description, is_default, is_active, is_standard, default_margin_pct, default_target_unit, sort_order,
      lines:price_group_lines(id, item_id, unit_price, unit, discount_pct, currency, valid_from, valid_to, notes,
        item:item_id(id, code, name, unit, item_type, weight_mode, target_weight_g, fill_weight_g, units_per_inner, units_per_outer, units_per_pallet, default_sell_uom, production_loss_pct, cooking_loss_pct, packing_loss_pct, open_pack_pct, giveaway_pct))
    `).order("sort_order", { nullsFirst: false }).order("name"),
    supabase.from("items")
      .select("id, code, name, unit, item_type, weight_mode, target_weight_g, fill_weight_g, units_per_inner, units_per_outer, units_per_pallet, default_sell_uom")
      .eq("is_active", true)
      .in("item_type", ["finished_good", "wip"])
      .order("name")
      .limit(TENANT_FULL_FETCH),
    supabase.from("v_item_landed_cost_v3")
      .select("item_id, total_cost_per_unit")
      .limit(TENANT_FULL_FETCH),
    supabase.from("v_pricing_buffers_current")
      .select("production_loss_pct, cooking_loss_pct, packing_loss_pct, open_pack_pct, giveaway_pct, depreciation_pct, sample_pct, product_dev_pct, error_pct, target_margin_pct")
      .maybeSingle(),
  ]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Price Groups</h1>
          <p className="page-subtitle">Manage price groups and set per-item prices for retail, wholesale, export and custom accounts</p>
        </div>
      </div>
      <PriceGroupsManager
        initialGroups={(groups ?? []) as unknown as Parameters<typeof PriceGroupsManager>[0]["initialGroups"]}
        allItems={(items ?? []) as unknown as Parameters<typeof PriceGroupsManager>[0]["allItems"]}
        itemCosts={(costs ?? []) as Array<{ item_id: string; total_cost_per_unit: number | string | null }>}
        buffers={buffers as Parameters<typeof PriceGroupsManager>[0]["buffers"]}
        tenantId={profile?.tenant_id ?? ""}
      />
    </div>
  );
}
