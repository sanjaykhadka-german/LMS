import Link from "next/link";
import { BackButton } from "@/components/back-button";
import BomForm from "../_components/bom-form";

export default async function NewBomPage({ searchParams }: { searchParams: Promise<{ item_id?: string }> }) {
  const { item_id } = await searchParams;

  return (
    <div>
      <div className="page-header">
        <div>
          <BackButton href="/bom" label="Bills of Materials" />
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>New BOM Version</h1>
          <p className="page-subtitle">Create a new recipe / bill of materials</p>
        </div>
      </div>
      <BomForm mode="create" defaultItemId={item_id} />
    </div>
  );
}
