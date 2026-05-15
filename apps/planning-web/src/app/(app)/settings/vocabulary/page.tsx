import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/current";
import { getTenantLabels } from "@/lib/labels/server";
import VocabularyManager from "./_components/vocabulary-manager";

export default async function VocabularyPage() {
  const { tenant, role } = await requireTenant();
  if (role !== "owner" && role !== "admin") {
    redirect("/dashboard");
  }
  const labels = await getTenantLabels(tenant.id);
  return <VocabularyManager initialLabels={labels} />;
}
