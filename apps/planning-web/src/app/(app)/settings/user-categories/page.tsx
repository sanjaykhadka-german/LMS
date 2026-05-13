import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import UserCategoriesManager from "./_components/user-categories-manager";

export default async function UserCategoriesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).single();
  const role = profile?.role ?? "viewer";
  if (!["admin", "super_admin"].includes(role)) redirect("/settings");

  const { data: categories } = await supabase
    .from("user_categories")
    .select("*")
    .order("name");

  return (
    <div style={{ maxWidth: "640px" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">User Categories</h1>
          <p className="page-subtitle">Define the categories used to classify staff, contractors and contacts</p>
        </div>
      </div>
      <UserCategoriesManager initialCategories={categories ?? []} />
    </div>
  );
}
