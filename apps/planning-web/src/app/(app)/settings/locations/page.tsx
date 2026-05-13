import { createClient } from "@/lib/supabase/server";
import LocationsManager from "./_components/locations-manager";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const supabase = await createClient();
  const [{ data: locations }, { data: rooms }] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, code, description, sort_order, is_active, room_id, barcode, color, room:room_id(id, name, code, department_id, department:department_id(id, name))")
      .order("sort_order")
      .order("name"),
    supabase
      .from("rooms")
      .select("id, name, code, department_id, department:department_id(id, name)")
      .eq("is_active", true)
      .order("name"),
  ]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Locations</h1>
          <p className="page-subtitle">Sub-zones inside rooms (shelves, racks, bins). Each location belongs to one room and inherits its department. Auto-assigned barcode for stocktake / put-away scanning.</p>
        </div>
      </div>
      <LocationsManager initialLocations={(locations ?? []) as any} rooms={(rooms ?? []) as any} />
    </div>
  );
}
