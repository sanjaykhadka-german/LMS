import { createClient } from "@/lib/supabase/server";
import TaxCodesClient from "./_components/tax-codes-client";

export default async function TaxCodesPage() {
  const supabase = await createClient();

  const { data: taxCodes } = await supabase
    .from("tax_codes")
    .select("*")
    .order("name");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tax Codes</h1>
          <p className="page-subtitle">
            Manage GST / VAT codes for purchases and sales. Assign them to items in the Item Master.
          </p>
        </div>
      </div>
      <TaxCodesClient initialTaxCodes={taxCodes ?? []} />
    </div>
  );
}
