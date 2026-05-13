import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import BulkMachinesGrid from "./_components/bulk-machines-grid";

export default async function MachinesPage() {
  const supabase = await createClient();

  // Pull everything the bulk grid needs in parallel — machines, plus the
  // reference data the inline cells need (departments, rooms, units of
  // measure). Keeps the grid client-only logic simple.
  const [machinesRes, deptsRes, roomsRes, uomsRes] = await Promise.all([
    supabase
      .from("machines")
      .select(`
        id, code, name, machine_type, status,
        department_id, department:department_id(name),
        capacity_value, capacity_unit, room_id,
        next_service_date, is_active
      `)
      .order("name"),
    supabase.from("departments").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("rooms").select("id, name, code").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("units_of_measure").select("id, code, name").eq("is_active", true).order("sort_order").order("code"),
  ]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Machine Register</h1>
          <p className="page-subtitle">Equipment, maintenance schedules, spare parts and documents</p>
        </div>
        <Link href="/settings/machines/new" className="btn-primary">+ New Machine</Link>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <BulkMachinesGrid
          machines={(machinesRes.data ?? []) as Parameters<typeof BulkMachinesGrid>[0]["machines"]}
          departments={(deptsRes.data ?? []) as Parameters<typeof BulkMachinesGrid>[0]["departments"]}
          rooms={(roomsRes.data ?? []) as Parameters<typeof BulkMachinesGrid>[0]["rooms"]}
          uoms={(uomsRes.data ?? []) as Parameters<typeof BulkMachinesGrid>[0]["uoms"]}
        />
      </div>
    </div>
  );
}
