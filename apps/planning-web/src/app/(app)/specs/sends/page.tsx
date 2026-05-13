import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SendsTable from "./_components/sends-table";
import { TENANT_FULL_FETCH } from "@/lib/limits";

/**
 * Spec / PIF send history.
 *
 * Tino May 7 2026 ask: "we also need a list of emails with specs sent to
 * XYZ with filters to search for details such as name sent to or
 * companies if linked to a company." This page is the audit list.
 *
 * Pulls every spec_sends row for the tenant with the joins needed to
 * filter by recipient, customer, sender, item, status and date.
 */
export default async function SpecSendsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: sends } = await supabase
    .from("spec_sends")
    .select(`
      id, sent_at, document_type, version_label,
      recipient_name, recipient_email,
      to_addresses, cc_addresses,
      subject, status, error_message, provider_message_id,
      customer:customer_id(id, name),
      sender:sent_by(id, full_name),
      item:item_id(id, code, name),
      spec:spec_id(id, version_label)
    `)
    .order("sent_at", { ascending: false })
    .limit(TENANT_FULL_FETCH);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Spec send history</h1>
          <p className="page-subtitle">Every spec / PIF email this tenant has sent — newest first.</p>
        </div>
        <Link href="/specs" className="btn-secondary">← Back to specs</Link>
      </div>
      <SendsTable sends={sends ?? []} />
    </div>
  );
}
