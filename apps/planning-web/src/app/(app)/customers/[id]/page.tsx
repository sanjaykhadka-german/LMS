import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import CustomerForm from "../_components/customer-form";
import CustomerContactsPanel from "../_components/customer-contacts-panel";
import CustomerPriceOverridesPanel, { type CustomerOverride, type SimpleItem } from "../_components/customer-price-overrides-panel";
import CustomerPricingPanel, { type GroupPriceLine, type CustomerOverrideForPanel, type Buffers, type ItemCost } from "../_components/customer-pricing-panel";
import { TENANT_FULL_FETCH } from "@/lib/limits";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: customer }, { data: orders }, { data: contacts }, { data: overrideRows }, { data: allItems }] = await Promise.all([
    supabase.from("customers").select("*, price_group:price_group_id(id, code, name)").eq("id", id).single(),
    supabase.from("customer_orders")
      .select("id, order_number, order_date, required_date, status, currency")
      .eq("customer_id", id)
      .order("order_date", { ascending: false })
      .limit(20),
    supabase.from("customer_contacts")
      .select("*")
      .eq("customer_id", id)
      .order("is_primary", { ascending: false }),
    supabase.from("item_price_targets")
      .select("id, item_id, target_margin_pct, target_sell_price, target_unit, effective_from, effective_to, notes, updated_at, item:item_id(id, code, name, unit, item_type)")
      .eq("scope_type", "customer")
      .eq("scope_id", id)
      .order("updated_at", { ascending: false }),
    supabase.from("items")
      .select("id, code, name, unit, item_type, weight_mode, target_weight_g")
      .eq("is_active", true)
      .in("item_type", ["finished_good", "wip"])
      .order("name")
      .limit(TENANT_FULL_FETCH),
  ]);

  // Customer-pricing-panel data: fetch the price group's lines (with item
  // pack + losses) + tenant buffers + per-item cogs from v_item_landed_cost_v3.
  const customerPriceGroupId = (customer?.price_group_id as string | null) ?? null;
  const [{ data: groupLineRows }, { data: buffers }, { data: itemCosts }] = await Promise.all([
    customerPriceGroupId
      ? supabase.from("price_group_lines")
          .select("id, item_id, unit_price, unit, item:item_id(id, code, name, unit, item_type, weight_mode, target_weight_g, fill_weight_g, units_per_inner, units_per_outer, units_per_pallet, production_loss_pct, cooking_loss_pct, packing_loss_pct, open_pack_pct, giveaway_pct)")
          .eq("price_group_id", customerPriceGroupId)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase.from("v_pricing_buffers_current")
      .select("production_loss_pct, cooking_loss_pct, packing_loss_pct, open_pack_pct, giveaway_pct, depreciation_pct, sample_pct, product_dev_pct, error_pct, target_margin_pct")
      .maybeSingle(),
    supabase.from("v_item_landed_cost_v3").select("item_id, total_cost_per_unit").limit(TENANT_FULL_FETCH),
  ]);
  const priceGroupForPanel = customer?.price_group as { id: string; code: string | null; name: string } | null;

  if (!customer) notFound();

  const STATUS_COLORS: Record<string, string> = {
    draft: "badge-gray", confirmed: "badge-blue", in_production: "badge-yellow",
    ready: "badge-green", dispatched: "badge-blue", invoiced: "badge-gray", cancelled: "badge-red",
  };

  return (
    <div>
      <CustomerForm mode="edit" initial={customer} />

      <div style={{ marginTop: "2rem" }}>
        <CustomerContactsPanel
          customerId={id}
          tenantId={customer.tenant_id}
          initialContacts={contacts ?? []}
        />
      </div>

      <div style={{ marginTop: "2rem" }}>
        <CustomerPricingPanel
          priceGroupId={customerPriceGroupId}
          priceGroupCode={priceGroupForPanel?.code ?? null}
          priceGroupName={priceGroupForPanel?.name ?? null}
          groupLines={(groupLineRows ?? []) as unknown as GroupPriceLine[]}
          overrides={(overrideRows ?? []) as unknown as CustomerOverrideForPanel[]}
          itemCosts={(itemCosts ?? []) as unknown as ItemCost[]}
          buffers={(buffers ?? null) as Buffers | null}
        />
      </div>

      <div style={{ marginTop: "2rem" }}>
        <CustomerPriceOverridesPanel
          customerId={id}
          customerName={customer.name}
          initialOverrides={(overrideRows ?? []) as unknown as CustomerOverride[]}
          allItems={(allItems ?? []) as unknown as SimpleItem[]}
        />
      </div>

      {/* Recent orders */}
      <div style={{ marginTop: "2rem" }}>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Recent Orders</h2>
            <Link href={`/orders/new?customer_id=${id}`} className="btn-primary" style={{ fontSize: "0.8125rem" }}>+ New Order</Link>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Order Date</th>
                <th>Required</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(!orders || orders.length === 0) && (
                <tr>
                  <td colSpan={5} style={{ padding: "1.5rem", textAlign: "center", color: "#78716c" }}>
                    No orders yet for this customer.
                  </td>
                </tr>
              )}
              {(orders ?? []).map(o => (
                <tr key={o.id}>
                  <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{o.order_number}</td>
                  <td style={{ color: "#78716c" }}>{new Date(o.order_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td style={{ color: "#78716c" }}>{o.required_date ? new Date(o.required_date).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "—"}</td>
                  <td>
                    <span className={`badge ${STATUS_COLORS[o.status] ?? "badge-gray"}`} style={{ fontSize: "0.6875rem", textTransform: "capitalize" }}>
                      {o.status.replace("_", " ")}
                    </span>
                  </td>
                  <td>
                    <Link href={`/orders/${o.id}`} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
