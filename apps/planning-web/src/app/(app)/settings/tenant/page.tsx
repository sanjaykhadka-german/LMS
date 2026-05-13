import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import TenantSettingsClient from "./_components/tenant-settings-client";

export default async function TenantSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user!.id)
    .single();

  if (!profile || !["admin", "super_admin"].includes(profile.role)) {
    redirect("/settings");
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select(`
      id, name, invoice_prefix, has_multi_currency,
      abn, company_phone, company_email,
      billing_address_line1, billing_address_line2,
      billing_city, billing_state, billing_postcode, billing_country,
      logo_url, brand_color, invoice_template_id, invoice_custom_template,
      bank_name, bank_bsb, bank_account_number, bank_account_name,
      default_currency, purchasing_email, email_send_domain
    `)
    .eq("id", profile.tenant_id)
    .single();

  if (!tenant) redirect("/settings");

  return <TenantSettingsClient tenant={tenant} />;
}
