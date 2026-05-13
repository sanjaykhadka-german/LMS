import { createClient } from "@/lib/supabase/server";
import ItemCategoriesManager from "./_components/item-categories-manager";

export default async function ItemCategoriesPage() {
  const supabase = await createClient();

  const [{ data: categories }, { data: subcategories }] = await Promise.all([
    supabase
      .from("item_categories")
      .select("id, name, description, color, sort_order, is_active")
      .order("sort_order")
      .order("name"),
    supabase
      .from("item_subcategories")
      .select("id, category_id, name, description, sort_order, is_active")
      .order("sort_order")
      .order("name"),
  ]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Item Categories</h1>
          <p className="page-subtitle">Categories and sub-categories for items — click ▸ to expand subcategories</p>
        </div>
      </div>
      <ItemCategoriesManager
        initialCategories={categories ?? []}
        initialSubcategories={subcategories ?? []}
      />
    </div>
  );
}
