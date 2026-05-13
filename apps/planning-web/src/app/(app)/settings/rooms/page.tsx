import { createClient } from "@/lib/supabase/server";
import RoomsManager from "./_components/rooms-manager";

export default async function RoomsPage() {
  const supabase = await createClient();
  const [{ data: rooms }, { data: departments }] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, name, code, description, sort_order, is_active, department_id, barcode, color, department:department_id(id, name)")
      .order("sort_order")
      .order("name"),
    supabase
      .from("departments")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
  ]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rooms</h1>
          <p className="page-subtitle">Physical locations within the facility. Rooms can be linked to a department and have a scannable barcode for stocktakes.</p>
        </div>
      </div>
      <RoomsManager initialRooms={(rooms ?? []) as any} departments={departments ?? []} />
    </div>
  );
}
