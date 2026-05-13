import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import CustomerExportImport from "./_components/customer-export-import";
import CustomersTable from "./_components/customers-table";

type CustomerRow = {
  id: string;
  code: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  price_group: { name: string } | null;
  currency: string;
  is_active: boolean;
};

export default async function CustomersPage() {
  const supabase = await createClient();

  const { data: customers } = await supabase
    .from("customers")
    .select("id, code, name, contact_name, email, phone, city, state, currency, is_active, price_group:price_group_id(name)")
    .order("code");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">Manage customer accounts, pricing, and delivery preferences</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <CustomerExportImport />
          <Link href="/customers/new" className="btn-primary">+ New Customer</Link>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <CustomersTable customers={(customers as CustomerRow[]) ?? []} />
      </div>
    </div>
  );
}
