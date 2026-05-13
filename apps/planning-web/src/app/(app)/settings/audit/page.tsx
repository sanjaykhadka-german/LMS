import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AuditLogViewer from "./_components/audit-log-viewer";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; user?: string; page?: string }>;
}) {
  const supabase = await createClient();

  // Admin only
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();

  if (profile?.role !== "admin") redirect("/settings");

  const { table, user: userFilter, page } = await searchParams;
  const pageNum = parseInt(page ?? "1") || 1;
  const pageSize = 50;
  const offset = (pageNum - 1) * pageSize;

  let query = supabase
    .from("audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (table) query = query.eq("table_name", table);
  if (userFilter) query = query.eq("user_id", userFilter);

  const { data: logs, count } = await query;

  // Get distinct tables and users for filter dropdowns
  const { data: tables } = await supabase
    .from("audit_log")
    .select("table_name")
    .order("table_name");

  const distinctTables = [...new Set((tables ?? []).map(t => t.table_name))];

  return (
    <AuditLogViewer
      logs={logs ?? []}
      total={count ?? 0}
      page={pageNum}
      pageSize={pageSize}
      currentTable={table}
      distinctTables={distinctTables}
    />
  );
}
