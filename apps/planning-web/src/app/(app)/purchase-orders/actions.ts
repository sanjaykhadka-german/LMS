"use server";

/**
 * Purchase order server actions.
 *
 * sendPurchaseOrder:
 *   • Loads PO + lines + supplier + tenant + the user clicking Send.
 *   • Builds the email envelope per spec:
 *       From:     "{Tenant Name} Purchasing" <RESEND_FROM_EMAIL>
 *       Reply-To: user.email
 *       To:       supplier primary contact (or override)
 *       Cc:       user.email + tenants.purchasing_email (if set)
 *   • Renders the PO PDF and attaches it.
 *   • Posts via Resend.
 *   • Writes purchase_order_sends audit row with full snapshot.
 */

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { renderPurchaseOrderPdfBuffer, type PurchaseOrderPdfData } from "@/lib/po-pdf";

export interface SendPurchaseOrderInput {
  orderId: string;
  /** Override default recipient (supplier primary contact). One or more
   *  email addresses comma- or semicolon-separated. When empty we resolve
   *  from supplier_contacts where is_primary=true. */
  toOverride?: string;
  /** Extra Cc addresses (comma/semicolon-separated). Always merged with
   *  the auto Cc set (current user + tenant.purchasing_email). */
  ccOverride?: string;
  /** Editable subject — defaults to "Purchase Order {po_number} — {tenant}". */
  subject?: string;
  /** Editable body — defaults to the user's profile.po_email_template
   *  with {{po_number}} and {{supplier_name}} substituted. Markdown not
   *  rendered at MVP; sent as both plaintext and a simple HTML wrapper. */
  body?: string;
}

export interface SendPurchaseOrderResult {
  ok: boolean;
  error?: string;
  sendId?: string;
  providerMessageId?: string;
}

/** Comma-or-semicolon split + de-dupe + drop empties + lowercase normalise. */
function parseAddrList(s: string | null | undefined): string[] {
  if (!s) return [];
  return [...new Set(
    s.split(/[,;]/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
  )];
}

export async function sendPurchaseOrder(
  input: SendPurchaseOrderInput,
): Promise<SendPurchaseOrderResult> {
  const supabase = await createClient();

  // ── Authenticated user ─────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, tenant_id, po_email_template")
    .eq("id", user.id)
    .single();
  if (!profile) return { ok: false, error: "Profile not found." };

  // ── Tenant + PO + lines + supplier + supplier contacts ────────────────
  const [{ data: tenant }, { data: po }, { data: lines }] = await Promise.all([
    supabase
      .from("tenants")
      .select(`
        name, abn, default_currency, purchasing_email,
        company_phone, company_email, brand_color, logo_url,
        billing_address_line1, billing_address_line2,
        billing_city, billing_state, billing_postcode, billing_country
      `)
      .eq("id", profile.tenant_id)
      .single(),
    supabase
      .from("purchase_orders")
      .select(`
        id, po_number, status, order_date, expected_date, notes,
        show_prices_on_printout, fx_rate_currency, fx_rate,
        supplier:supplier_id(
          id, name, code,
          address_line1, address_line2, city, state, postcode, country_code
        )
      `)
      .eq("id", input.orderId)
      .single(),
    supabase
      .from("purchase_order_lines")
      .select(`
        id, qty_ordered, unit, unit_price, currency, notes,
        item:item_id(id, code, name, unit),
        supplier_item:supplier_item_id(supplier_item_code, supplier_item_name, purchase_uom)
      `)
      .eq("purchase_order_id", input.orderId)
      .order("created_at"),
  ]);

  if (!tenant) return { ok: false, error: "Tenant not found." };
  if (!po)     return { ok: false, error: "Purchase order not found." };

  const supplier = po.supplier as {
    id: string; name: string; code: string | null;
    address_line1: string | null; address_line2: string | null;
    city: string | null; state: string | null; postcode: string | null; country_code: string | null;
  } | null;
  if (!supplier) return { ok: false, error: "Purchase order has no supplier set." };

  // Pick a primary supplier contact for the To address. Operator can
  // override at send time via toOverride.
  let resolvedTo: string[] = parseAddrList(input.toOverride);
  if (resolvedTo.length === 0) {
    const { data: contacts } = await supabase
      .from("supplier_contacts")
      .select("email, is_primary")
      .eq("supplier_id", supplier.id)
      .not("email", "is", null)
      .order("is_primary", { ascending: false });
    resolvedTo = parseAddrList((contacts ?? []).map(c => c.email).filter(Boolean).join(","));
  }
  if (resolvedTo.length === 0) {
    return { ok: false, error: `No email contact set for ${supplier.name}. Add a supplier contact (email) first, or specify a recipient at send time.` };
  }

  // Cc: current user + tenant.purchasing_email + any extras.
  const userEmail = profile.email ?? user.email ?? null;
  const ccSet = new Set<string>();
  if (userEmail) ccSet.add(userEmail.toLowerCase());
  if (tenant.purchasing_email) ccSet.add(tenant.purchasing_email.toLowerCase());
  for (const e of parseAddrList(input.ccOverride)) ccSet.add(e);
  // Don't double-up if a user is already in To.
  for (const t of resolvedTo) ccSet.delete(t);
  const cc = [...ccSet];

  // ── Build subject + body ───────────────────────────────────────────────
  const subject = (input.subject?.trim() ||
    `Purchase Order ${po.po_number ?? ""} — ${tenant.name}`).slice(0, 240);

  const templateBody = input.body ?? profile.po_email_template ?? defaultBodyTemplate();
  const body = templateBody
    .replaceAll("{{po_number}}",     po.po_number ?? "")
    .replaceAll("{{supplier_name}}", supplier.name)
    .replaceAll("{{user_name}}",     profile.full_name ?? "")
    .replaceAll("{{tenant_name}}",   tenant.name);

  // ── Build PO PDF ───────────────────────────────────────────────────────
  const linesArr = (lines ?? []) as {
    qty_ordered: number; unit: string; unit_price: number | null; notes: string | null;
    item: { code: string; name: string; unit: string } | null;
    supplier_item: { supplier_item_code: string | null } | null;
  }[];
  const pdfLines: PurchaseOrderPdfData["lines"] = linesArr.map((l, i) => ({
    lineNumber: i + 1,
    itemCode: l.item?.code ?? "—",
    itemName: l.item?.name ?? "—",
    qty: Number(l.qty_ordered ?? 0),
    unit: l.unit ?? l.item?.unit ?? "",
    unitPrice: l.unit_price != null ? Number(l.unit_price) : null,
    total: Number(l.qty_ordered ?? 0) * Number(l.unit_price ?? 0),
    supplierItemCode: l.supplier_item?.supplier_item_code ?? null,
    notes: l.notes,
  }));
  const totalValue = pdfLines.reduce((s, x) => s + (x.total ?? 0), 0);

  const tenantAddressLines = [
    tenant.billing_address_line1,
    tenant.billing_address_line2,
    [tenant.billing_city, tenant.billing_state, tenant.billing_postcode].filter(Boolean).join(" "),
    tenant.billing_country,
  ].filter(Boolean) as string[];
  const supplierAddressLines = [
    supplier.address_line1,
    supplier.address_line2,
    [supplier.city, supplier.state, supplier.postcode].filter(Boolean).join(" "),
    supplier.country_code,
  ].filter(Boolean) as string[];

  // Pick a contact name/email for the supplier block (reuses the resolved
  // primary contact when one was found via auto-resolve above).
  let primaryContactName: string | null = null;
  let primaryContactEmail: string | null = null;
  if (!input.toOverride) {
    const { data: c } = await supabase
      .from("supplier_contacts")
      .select("name, email")
      .eq("supplier_id", supplier.id)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    primaryContactName  = c?.name  ?? null;
    primaryContactEmail = c?.email ?? null;
  }

  const pdfData: PurchaseOrderPdfData = {
    poNumber: po.po_number ?? "—",
    orderDate: po.order_date,
    expectedDate: po.expected_date,
    notes: po.notes,
    showPrices: po.show_prices_on_printout !== false,
    currency: po.fx_rate_currency || tenant.default_currency || "AUD",
    tenant: {
      name: tenant.name,
      abn: tenant.abn,
      addressLines: tenantAddressLines,
      phone: tenant.company_phone,
      email: tenant.company_email,
      brandColor: tenant.brand_color || "#b91c1c",
      logoUrl: tenant.logo_url,
    },
    supplier: {
      name: supplier.name,
      code: supplier.code,
      addressLines: supplierAddressLines,
      contactName: primaryContactName,
      contactEmail: primaryContactEmail,
    },
    lines: pdfLines,
    total: totalValue,
  };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderPurchaseOrderPdfBuffer(pdfData);
  } catch (e) {
    return { ok: false, error: `PDF render failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const attachmentFilename = `${po.po_number ?? "PO"}.pdf`;

  // ── Resend send ────────────────────────────────────────────────────────
  const resendKey  = process.env.RESEND_API_KEY;
  const fromEmail  = process.env.RESEND_FROM_EMAIL  ?? "orders@send.germanbutchery.com.au";
  const fromName   = process.env.RESEND_FROM_NAME   ?? `${tenant.name} Purchasing`;
  if (!resendKey) {
    return { ok: false, error: "RESEND_API_KEY not configured. Set it in Vercel → Settings → Environment Variables and redeploy." };
  }

  let providerMessageId: string | null = null;
  let sendStatus: "sent" | "failed" = "sent";
  let sendError: string | null = null;

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(resendKey);
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: resolvedTo,
      cc: cc.length > 0 ? cc : undefined,
      // Resend Node SDK accepts replyTo (camelCase); it maps internally to
      // the wire-format reply_to. Using the SDK's documented camelCase.
      replyTo: userEmail ?? undefined,
      subject,
      text: body,
      html: bodyToHtml(body),
      attachments: [
        {
          filename: attachmentFilename,
          content: pdfBuffer.toString("base64"),
        },
      ],
    });
    if (error) {
      sendStatus = "failed";
      sendError = error.message ?? String(error);
    } else {
      providerMessageId = data?.id ?? null;
    }
  } catch (e) {
    sendStatus = "failed";
    sendError = e instanceof Error ? e.message : String(e);
  }

  // ── Audit: write purchase_order_sends row ──────────────────────────────
  // Snapshot captures the final body / subject / addressing so historical
  // replays remain accurate even after templates / contacts change.
  const snapshot = {
    from: `${fromName} <${fromEmail}>`,
    reply_to: userEmail,
    to: resolvedTo,
    cc,
    subject, body,
    pdf_bytes: pdfBuffer.length,
    show_prices: pdfData.showPrices,
    currency: pdfData.currency,
    line_count: pdfLines.length,
    total: totalValue,
  };

  const { data: sendRow, error: sendInsErr } = await supabase
    .from("purchase_order_sends")
    .insert({
      tenant_id: profile.tenant_id,
      purchase_order_id: input.orderId,
      sent_by: profile.id,
      to_addresses: resolvedTo.join(", "),
      cc_addresses: cc.join(", "),
      subject,
      body_text: body,
      attachment_filename: attachmentFilename,
      provider: "resend",
      provider_message_id: providerMessageId,
      status: sendStatus,
      error_message: sendError,
      snapshot,
    })
    .select("id")
    .single();
  if (sendInsErr) {
    // Don't fail the user request if logging fails — the email already
    // went out. Surface as a warning via the error field instead.
    return {
      ok: sendStatus === "sent",
      error: sendStatus === "failed"
        ? sendError ?? "Send failed"
        : `Send succeeded but audit log write failed: ${sendInsErr.message}`,
      providerMessageId: providerMessageId ?? undefined,
    };
  }

  // Bump PO status from draft → sent on first successful send. Doesn't
  // touch already-sent / received / cancelled POs.
  if (sendStatus === "sent" && po.status === "draft") {
    await supabase
      .from("purchase_orders")
      .update({ status: "sent" })
      .eq("id", input.orderId);
  }

  revalidatePath(`/purchase-orders/${input.orderId}`);

  if (sendStatus === "failed") {
    return { ok: false, error: sendError ?? "Send failed", sendId: sendRow.id };
  }
  return { ok: true, sendId: sendRow.id, providerMessageId: providerMessageId ?? undefined };
}

function defaultBodyTemplate(): string {
  // Seeded into the body when the user hasn't set profile.po_email_template.
  // Plain text — the bodyToHtml helper wraps it in a basic HTML container
  // for clients that prefer HTML.
  return `Hi {{supplier_name}},\n\nPlease find attached our purchase order {{po_number}} for the items listed in the PDF.\n\nLet me know if anything is unclear or if there are any issues with availability or delivery dates.\n\nThanks,\n{{user_name}}\n{{tenant_name}}`;
}

function bodyToHtml(text: string): string {
  // Minimal escape + paragraph-on-blank-line rendering. Keeps emails
  // readable in HTML clients without needing a markdown library.
  const esc = (s: string) => s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const paragraphs = text.split(/\n\s*\n/).map(p => `<p style="margin:0 0 12px;line-height:1.55;">${esc(p).replaceAll("\n", "<br />")}</p>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c1917;max-width:600px;">${paragraphs}</div>`;
}

// ============================================================================
// Phase 9.5 (Tino May 2026): create draft POs from suggestions + approval gate
// ============================================================================

export interface CreateDraftPosInput {
  planId?: string | null;
  expectedDate?: string | null;
  notes?: string | null;
  allocations: Array<{
    item_id: string;
    supplier_id: string;
    supplier_item_id?: string | null;
    qty: number;
    unit: string;
    unit_price: number | null;
    currency: string | null;
    notes?: string | null;
  }>;
}

export interface CreateDraftPosResult {
  ok: boolean;
  error?: string;
  created?: Array<{ poId: string; poNumber: string; supplierId: string; supplierName: string; lineCount: number }>;
}

export async function createDraftPosFromAllocations(
  input: CreateDraftPosInput,
): Promise<CreateDraftPosResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).single();
  if (!profile?.tenant_id) return { ok: false, error: "No tenant on profile" };
  const tenantId = profile.tenant_id;

  const valid = input.allocations.filter(a => a.supplier_id && a.item_id && a.qty > 0);
  if (valid.length === 0) return { ok: false, error: "No allocations with a supplier and qty > 0" };

  const bySupplier = new Map<string, typeof valid>();
  for (const a of valid) {
    const arr = bySupplier.get(a.supplier_id) ?? [];
    arr.push(a);
    bySupplier.set(a.supplier_id, arr);
  }

  const supplierIds = [...bySupplier.keys()];
  const { data: supplierRows } = await supabase
    .from("suppliers").select("id, name").in("id", supplierIds);
  const supplierName = new Map<string, string>();
  for (const s of (supplierRows ?? [])) supplierName.set((s as { id: string }).id, (s as { name: string }).name);

  const { count: existingCount } = await supabase
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  const year = new Date().getFullYear();
  let nextSeq = (existingCount ?? 0) + 1;

  const created: NonNullable<CreateDraftPosResult["created"]> = [];

  for (const [supplierId, allocs] of bySupplier) {
    const poNumber = `PO-${year}-${String(nextSeq).padStart(4, "0")}`;
    nextSeq++;

    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .insert({
        tenant_id: tenantId,
        po_number: poNumber,
        supplier_id: supplierId,
        status: "draft",
        approval_status: "pending",
        order_date: new Date().toISOString().slice(0, 10),
        expected_date: input.expectedDate ?? null,
        notes: input.notes ?? null,
        source_plan_id: input.planId ?? null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (poErr || !po) return { ok: false, error: `PO insert failed: ${poErr?.message ?? "unknown"}` };

    const lineInserts = allocs.map(a => ({
      tenant_id: tenantId,
      purchase_order_id: (po as { id: string }).id,
      item_id: a.item_id,
      supplier_item_id: a.supplier_item_id ?? null,
      qty_ordered: a.qty,
      unit: a.unit,
      unit_price: a.unit_price ?? null,
      currency: a.currency ?? "AUD",
      notes: a.notes ?? null,
    }));
    const { error: linesErr } = await supabase.from("purchase_order_lines").insert(lineInserts);
    if (linesErr) return { ok: false, error: `Line insert failed for ${poNumber}: ${linesErr.message}` };

    created.push({
      poId: (po as { id: string }).id,
      poNumber,
      supplierId,
      supplierName: supplierName.get(supplierId) ?? "Unknown",
      lineCount: allocs.length,
    });
  }

  revalidatePath("/purchase-orders");
  return { ok: true, created };
}

export async function approvePurchaseOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!["admin", "super_admin", "manager"].includes(role)) {
    return { ok: false, error: "Only managers and admins can approve POs." };
  }
  const { error } = await supabase
    .from("purchase_orders")
    .update({ approval_status: "approved", approved_at: new Date().toISOString(), approved_by: user.id })
    .eq("id", orderId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}

export async function unapprovePurchaseOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!["admin", "super_admin", "manager"].includes(role)) {
    return { ok: false, error: "Only managers and admins can unapprove POs." };
  }
  const { error } = await supabase
    .from("purchase_orders")
    .update({ approval_status: "pending", approved_at: null, approved_by: null })
    .eq("id", orderId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/purchase-orders/${orderId}`);
  return { ok: true };
}
