import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import TemplateBuilder from "./_components/template-builder";
import type { CustomTemplate } from "@/lib/invoice-templates/types";
import { defaultCustomLayout } from "@/lib/invoice-templates/default-custom-layout";

export default async function InvoiceTemplateBuilderPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "super_admin"].includes(profile.role)) {
    redirect("/settings");
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, brand_color, invoice_custom_template")
    .eq("id", profile.tenant_id)
    .single();

  if (!tenant) redirect("/settings");

  // Find the most recent invoice for the preview link.
  const { data: latestInvoice } = await supabase
    .from("invoices")
    .select("id, invoice_number")
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const initialLayout = (tenant.invoice_custom_template as CustomTemplate | null) ?? defaultCustomLayout;

  return (
    <TemplateBuilder
      tenantId={tenant.id}
      tenantName={tenant.name}
      brandColor={tenant.brand_color ?? "#b91c1c"}
      initialLayout={initialLayout}
      previewInvoiceId={latestInvoice?.id ?? null}
      previewInvoiceNumber={latestInvoice?.invoice_number ?? null}
    />
  );
}
