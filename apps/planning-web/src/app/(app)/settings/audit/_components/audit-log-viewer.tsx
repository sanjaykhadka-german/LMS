"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { BackButton } from "@/components/back-button";
import Link from "next/link";

type AuditEntry = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  record_label: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_fields: string[] | null;
  created_at: string;
};

const ACTION_COLORS: Record<string, { bg: string; color: string }> = {
  INSERT: { bg: "#f0fdf4", color: "#15803d" },
  UPDATE: { bg: "#eff6ff", color: "#1d4ed8" },
  DELETE: { bg: "#fef2f2", color: "#dc2626" },
};

const TABLE_LABELS: Record<string, string> = {
  suppliers: "Suppliers", customers: "Customers", items: "Items",
  bom_headers: "BOM Headers", production_orders: "Production Orders",
  departments: "Departments", machines: "Machines", machine_breakdowns: "Machine Breakdowns",
};

export default function AuditLogViewer({
  logs, total, page, pageSize, currentTable, distinctTables,
}: {
  logs: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  currentTable?: string;
  distinctTables: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);

  function buildUrl(params: Record<string, string | undefined>) {
    const p = new URLSearchParams(searchParams.toString());
    Object.entries(params).forEach(([k, v]) => {
      if (v) p.set(k, v); else p.delete(k);
    });
    return `${pathname}?${p.toString()}`;
  }

  const totalPages = Math.ceil(total / pageSize);

  function DiffView({ entry }: { entry: AuditEntry }) {
    if (entry.action === "INSERT") {
      return (
        <div style={{ fontSize: "0.8125rem" }}>
          <div style={{ color: "#15803d", fontWeight: 600, marginBottom: "0.25rem" }}>New record created</div>
          <pre style={{ margin: 0, background: "#f0fdf4", padding: "0.5rem", borderRadius: "0.375rem",
            fontSize: "0.75rem", overflow: "auto", maxHeight: "200px" }}>
            {JSON.stringify(entry.new_values, null, 2)}
          </pre>
        </div>
      );
    }
    if (entry.action === "DELETE") {
      return (
        <div style={{ fontSize: "0.8125rem" }}>
          <div style={{ color: "#dc2626", fontWeight: 600, marginBottom: "0.25rem" }}>Record deleted</div>
          <pre style={{ margin: 0, background: "#fef2f2", padding: "0.5rem", borderRadius: "0.375rem",
            fontSize: "0.75rem", overflow: "auto", maxHeight: "200px" }}>
            {JSON.stringify(entry.old_values, null, 2)}
          </pre>
        </div>
      );
    }
    // UPDATE — show only changed fields
    const fields = entry.changed_fields ?? [];
    return (
      <div style={{ fontSize: "0.8125rem" }}>
        <div style={{ color: "#1d4ed8", fontWeight: 600, marginBottom: "0.5rem" }}>
          {fields.length} field(s) changed: {fields.join(", ")}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.25rem 0.5rem", background: "#f5f5f4", borderBottom: "1px solid #e7e5e4" }}>Field</th>
              <th style={{ textAlign: "left", padding: "0.25rem 0.5rem", background: "#fef2f2", borderBottom: "1px solid #e7e5e4" }}>Before</th>
              <th style={{ textAlign: "left", padding: "0.25rem 0.5rem", background: "#f0fdf4", borderBottom: "1px solid #e7e5e4" }}>After</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(field => (
              <tr key={field}>
                <td style={{ padding: "0.25rem 0.5rem", fontFamily: "monospace", fontWeight: 600 }}>{field}</td>
                <td style={{ padding: "0.25rem 0.5rem", background: "#fef2f2", color: "#dc2626" }}>
                  {JSON.stringify(entry.old_values?.[field])}
                </td>
                <td style={{ padding: "0.25rem 0.5rem", background: "#f0fdf4", color: "#15803d" }}>
                  {JSON.stringify(entry.new_values?.[field])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1100px" }}>
      <BackButton href="/settings" label="Settings" />
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">
            All changes made in the system — {total.toLocaleString()} total entries — admin access only
          </p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <select
          className="form-select"
          style={{ width: "auto", fontSize: "0.875rem" }}
          value={currentTable ?? ""}
          onChange={e => router.push(buildUrl({ table: e.target.value || undefined, page: "1" }))}
        >
          <option value="">All tables</option>
          {distinctTables.map(t => (
            <option key={t} value={t}>{TABLE_LABELS[t] ?? t}</option>
          ))}
        </select>
        {currentTable && (
          <Link href={buildUrl({ table: undefined, page: "1" })} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
            Clear filter
          </Link>
        )}
        <span style={{ fontSize: "0.8125rem", color: "#78716c", marginLeft: "auto" }}>
          Page {page} of {totalPages} ({total.toLocaleString()} entries)
        </span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: "160px" }}>When</th>
              <th style={{ width: "80px" }}>Action</th>
              <th style={{ width: "140px" }}>Table</th>
              <th>Record</th>
              <th>Changed By</th>
              <th style={{ width: "80px" }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
                No audit entries found.
              </td></tr>
            )}
            {logs.map(entry => (
              <>
                <tr key={entry.id} style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
                  <td style={{ fontSize: "0.8125rem", color: "#78716c", whiteSpace: "nowrap" }}>
                    {new Date(entry.created_at).toLocaleString("en-AU", {
                      day: "2-digit", month: "short", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                  <td>
                    <span style={{
                      display: "inline-block", padding: "0.125rem 0.5rem", borderRadius: "0.25rem",
                      fontSize: "0.75rem", fontWeight: 700, fontFamily: "monospace",
                      background: ACTION_COLORS[entry.action]?.bg ?? "#f5f5f4",
                      color: ACTION_COLORS[entry.action]?.color ?? "#44403c",
                    }}>
                      {entry.action}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.8125rem", fontFamily: "monospace", color: "#78716c" }}>
                    {TABLE_LABELS[entry.table_name] ?? entry.table_name}
                  </td>
                  <td>
                    <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{entry.record_label ?? "—"}</div>
                    {entry.action === "UPDATE" && entry.changed_fields && (
                      <div style={{ color: "#78716c", fontSize: "0.75rem" }}>
                        {entry.changed_fields.slice(0, 4).join(", ")}
                        {entry.changed_fields.length > 4 && ` +${entry.changed_fields.length - 4} more`}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                    {entry.user_email ?? "—"}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span style={{ fontSize: "0.75rem", color: "#b91c1c", cursor: "pointer" }}>
                      {expanded === entry.id ? "▲" : "▼"}
                    </span>
                  </td>
                </tr>
                {expanded === entry.id && (
                  <tr key={`${entry.id}-detail`}>
                    <td colSpan={6} style={{ background: "#fafaf9", padding: "1rem", borderTop: "none" }}>
                      <DiffView entry={entry} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1.25rem" }}>
          {page > 1 && (
            <Link href={buildUrl({ page: String(page - 1) })} className="btn-secondary" style={{ fontSize: "0.875rem" }}>
              ← Previous
            </Link>
          )}
          <span style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "#78716c" }}>
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link href={buildUrl({ page: String(page + 1) })} className="btn-secondary" style={{ fontSize: "0.875rem" }}>
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
