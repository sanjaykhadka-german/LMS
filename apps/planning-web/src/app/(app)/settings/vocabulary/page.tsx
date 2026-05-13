import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import VocabularyManager from "./_components/vocabulary-manager";

export default async function VocabularyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Permission check — only admin / super_admin can see this page
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const role = (profile as { role?: string } | null)?.role ?? "viewer";
  if (!["admin", "super_admin"].includes(role)) {
    redirect("/dashboard");
  }

  // Initial label set — server-fetched so the page hydrates without a flicker.
  const { data: labels } = await supabase.rpc("get_tenant_labels");

  return <VocabularyManager initialLabels={labels ?? []} />;
}
