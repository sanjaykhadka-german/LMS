import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import GoodsInTable, { type GoodsInReceipt } from "./_components/goods-in-table";

export default async function GoodsInPage() {
  const supabase = await createClient();

  const { data: receipts } = await supabase
    .from("goods_in_receipts")
    .select(`
      id, receipt_number, received_date, status, supplier_delivery_ref, notes,
      supplier:supplier_id(id, code, name)
    `)
    .order("received_date", { ascending: false })
    .limit(50);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Goods In</h1>
          <p className="page-subtitle">Record incoming deliveries and create lot numbers for traceability</p>
        </div>
        <Link href="/goods-in/new" className="btn-primary">+ New Receipt</Link>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <GoodsInTable receipts={(receipts ?? []) as unknown as GoodsInReceipt[]} />
      </div>
    </div>
  );
}
