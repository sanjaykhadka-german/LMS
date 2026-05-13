import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import MachineForm from "../_components/machine-form";
import MachineBreakdownsPanel from "../_components/machine-breakdowns-panel";
import MachineSparePartsPanel from "../_components/machine-spare-parts-panel";
import MachineDocumentsPanel from "../_components/machine-documents-panel";
import MachineMaintenancePanel from "../_components/machine-maintenance-panel";

export default async function MachineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: machine },
    { data: departments },
    { data: rooms },
    { data: breakdowns },
    { data: spareParts },
    { data: documents },
    { data: maintenanceLogs },
  ] = await Promise.all([
    supabase.from("machines").select("*").eq("id", id).single(),
    supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
    supabase.from("rooms").select("id, name, code").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("machine_breakdowns").select("*, reported_by:reported_by(full_name), resolved_by:resolved_by(full_name)")
      .eq("machine_id", id).order("reported_at", { ascending: false }),
    supabase.from("machine_spare_parts").select("*").eq("machine_id", id).order("part_name"),
    supabase.from("machine_documents").select("*, uploaded_by:uploaded_by(full_name)")
      .eq("machine_id", id).order("created_at", { ascending: false }),
    supabase.from("machine_maintenance_logs").select("id, log_type, performed_date, performed_by, description, cost, parts_used, next_service_date, downtime_hours, is_resolved, notes")
      .eq("machine_id", id).order("performed_date", { ascending: false }),
  ]);

  if (!machine) notFound();

  return (
    <div>
      <MachineForm mode="edit" initial={machine} departments={departments ?? []} rooms={rooms ?? []} />

      <div className="card" style={{ marginTop: "2rem", padding: "1.25rem" }}>
        <MachineMaintenancePanel machineId={id} initialLogs={maintenanceLogs ?? []} />
      </div>

      <div style={{ marginTop: "2rem" }}>
        <MachineBreakdownsPanel machineId={id} initialBreakdowns={breakdowns ?? []} />
      </div>
      <div style={{ marginTop: "2rem" }}>
        <MachineSparePartsPanel machineId={id} initialParts={spareParts ?? []} />
      </div>
      <div style={{ marginTop: "2rem" }}>
        <MachineDocumentsPanel machineId={id} initialDocuments={documents ?? []} />
      </div>
    </div>
  );
}
