import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import QRCode from "qrcode";
import { getTemplate } from "@/lib/invoice-templates";
import type { CustomTemplate, TemplateLine, TemplateProps } from "@/lib/invoice-templates/types";

const LOGO_BUCKET = "tenant-branding";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, invoice_date, due_date, currency,
      subtotal, tax_total, total, notes, template_id, tenant_id,
      customer:customer_id(
        name, abn, email, phone,
        billing_address_line1, billing_address_line2,
        billing_city, billing_state, billing_postcode, billing_country_code,
        delivery_is_same_as_billing,
        delivery_address_line1, delivery_address_line2,
        delivery_city, delivery_state, delivery_postcode
      ),
      order:customer_order_id(
        order_number, customer_po_number,
        lines:customer_order_lines(
          id, line_number, qty_units, qty_kg, unit_price, line_total,
          item:item_id(name, code),
          lots:customer_order_line_lots(batch_number, use_by_date, qty_dispatched, dispatch_uom)
        )
      )
    `)
    .eq("id", id)
    .single();

  if (invErr || !invoice) {
    console.error("[invoice pdf] invoice query error:", invErr);
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const { data: tenantRow, error: tenantErr } = await supabase
    .from("tenants")
    .select(`
      name, abn, company_phone, company_email,
      billing_address_line1, billing_address_line2,
      billing_city, billing_state, billing_postcode, billing_country,
      logo_url, brand_color, invoice_template_id, invoice_custom_template,
      bank_name, bank_bsb, bank_account_number, bank_account_name
    `)
    .eq("id", invoice.tenant_id)
    .maybeSingle();

  if (tenantErr || !tenantRow) {
    console.error("[invoice pdf] tenant query error:", tenantErr);
    return NextResponse.json({ error: "Tenant data missing" }, { status: 500 });
  }
  const tenant = tenantRow as unknown as Record<string, string | null> & {
    invoice_custom_template: CustomTemplate | null;
  };

  const customer = invoice.customer as unknown as (Record<string, string | null> & {
    delivery_is_same_as_billing: boolean | null;
  }) | null;
  const order = invoice.order as unknown as {
    order_number: string | null;
    customer_po_number: string | null;
    lines: {
      line_number: number;
      qty_units: number | null;
      qty_kg: number | null;
      unit_price: number | null;
      line_total: number | null;
      item: { name: string | null; code: string | null } | null;
      lots: { batch_number: string | null; use_by_date: string | null; qty_dispatched: number | null; dispatch_uom: string | null }[] | null;
    }[];
  } | null;

  const lines: TemplateLine[] = (order?.lines ?? [])
    .slice()
    .sort((a, b) => a.line_number - b.line_number)
    .map(l => ({
      line_number: l.line_number,
      item_name: l.item?.name ?? null,
      item_code: l.item?.code ?? null,
      qty_units: l.qty_units,
      qty_kg: l.qty_kg,
      unit_price: l.unit_price,
      line_total: l.line_total,
      lots: (l.lots ?? []).map(lot => ({
        batch_number:   lot.batch_number,
        use_by_date:    lot.use_by_date,
        qty_dispatched: lot.qty_dispatched,
        dispatch_uom:   lot.dispatch_uom,
      })),
    }));

  const logoDataUrl = await loadLogoDataUrl(supabase, tenant.logo_url);
  const qrDataUrl = await generateQrDataUrl(invoice.invoice_number as string);

  const templateId = invoice.template_id ?? tenant.invoice_template_id ?? "classic";
  const tpl = getTemplate(templateId);

  const props: TemplateProps = {
    invoice: {
      invoice_number: invoice.invoice_number as string,
      invoice_date:   invoice.invoice_date   as string,
      due_date:       invoice.due_date       as string | null,
      currency:       (invoice.currency as string) ?? "AUD",
      subtotal:       invoice.subtotal as number | null,
      tax_total:      invoice.tax_total as number | null,
      total:          invoice.total as number | null,
      notes:          invoice.notes as string | null,
      qr_data_url:    qrDataUrl,
    },
    tenant: {
      name:                  (tenant.name as string) ?? "",
      abn:                   tenant.abn,
      company_phone:         tenant.company_phone,
      company_email:         tenant.company_email,
      billing_address_line1: tenant.billing_address_line1,
      billing_address_line2: tenant.billing_address_line2,
      billing_city:          tenant.billing_city,
      billing_state:         tenant.billing_state,
      billing_postcode:      tenant.billing_postcode,
      billing_country:       tenant.billing_country,
      logo_data_url:         logoDataUrl,
      brand_color:           (tenant.brand_color as string) ?? "#b91c1c",
      bank_name:             tenant.bank_name,
      bank_bsb:              tenant.bank_bsb,
      bank_account_number:   tenant.bank_account_number,
      bank_account_name:     tenant.bank_account_name,
    },
    customer: customer ? {
      name:                        (customer.name as string) ?? "",
      abn:                         customer.abn,
      email:                       customer.email,
      phone:                       customer.phone,
      billing_address_line1:       customer.billing_address_line1,
      billing_address_line2:       customer.billing_address_line2,
      billing_city:                customer.billing_city,
      billing_state:               customer.billing_state,
      billing_postcode:            customer.billing_postcode,
      billing_country:             customer.billing_country_code,
      delivery_is_same_as_billing: customer.delivery_is_same_as_billing ?? true,
      delivery_address_line1:      customer.delivery_address_line1,
      delivery_address_line2:      customer.delivery_address_line2,
      delivery_city:               customer.delivery_city,
      delivery_state:              customer.delivery_state,
      delivery_postcode:           customer.delivery_postcode,
    } : null,
    order: order ? {
      order_number: order.order_number,
      customer_po_number: order.customer_po_number,
    } : null,
    lines,
    customTemplate: tenant.invoice_custom_template ?? null,
  };

  const buffer = await renderToBuffer(tpl.render(props) as ReactElement<DocumentProps>);

  const filename = `${invoice.invoice_number}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_");
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function generateQrDataUrl(text: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, {
      margin: 0,
      width: 200,
      errorCorrectionLevel: "M",
    });
  } catch (err) {
    console.error("[invoice pdf] QR generation failed:", err);
    return null;
  }
}

async function loadLogoDataUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  logoPath: string | null,
): Promise<string | null> {
  if (!logoPath) {
    console.log("[invoice pdf] tenant.logo_url is null — no logo will be embedded");
    return null;
  }
  console.log("[invoice pdf] downloading logo from", LOGO_BUCKET, "/", logoPath);
  const { data, error } = await supabase.storage.from(LOGO_BUCKET).download(logoPath);
  if (error || !data) {
    console.error("[invoice pdf] logo download failed:", error?.message, error);
    return null;
  }
  const arrayBuffer = await data.arrayBuffer();
  const byteLen = arrayBuffer.byteLength;
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const ext = (logoPath.split(".").pop() ?? "png").toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "webp" ? "image/webp"
    : ext === "svg" ? "image/svg+xml"
    : "image/png";
  console.log(`[invoice pdf] logo loaded: ${byteLen} bytes, mime=${mime}`);
  return `data:${mime};base64,${base64}`;
}
