"use client";

import Link from "next/link";

type Machine = {
  id: string;
  code: string | null;
  name: string;
  machine_type: string | null;
  status: string | null;
  department: { name: string } | null;
  capacity_value: number | null;
  capacity_unit: string | null;
  next_service_date: string | null;
  is_active: boolean;
};

export default function MachinesTable({ machines }: { machines: Machine[] }) {
  const today = new Date();
  const in30 = new Date(); in30.setDate(today.getDate() + 30);

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Name</th>
          <th>Type</th>
          <th>Department</th>
          <th>Capacity</th>
          <th>Next Service</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {machines.length === 0 && (
          <tr><td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
            No machines yet. <Link href="/settings/machines/new" style={{ color: "#b91c1c" }}>Add your first machine</Link>
          </td></tr>
        )}
        {machines.map((m) => {
          const svcDate = m.next_service_date ? new Date(m.next_service_date) : null;
          const svcDue = svcDate && svcDate <= in30;
          const svcOverdue = svcDate && svcDate < today;
          return (
            <tr
              key={m.id}
              onClick={() => window.location.href = `/settings/machines/${m.id}`}
              style={{ cursor: "pointer", opacity: m.is_active ? 1 : 0.55 }}
            >
              <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{m.code ?? "—"}</td>
              <td style={{ fontWeight: 500 }}>{m.name}</td>
              <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>{m.machine_type ?? "—"}</td>
              <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>
                {m.department?.name ?? "—"}
              </td>
              <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>
                {m.capacity_value ? `${m.capacity_value} ${m.capacity_unit ?? ""}` : "—"}
              </td>
              <td>
                {svcDate ? (
                  <span style={{ fontSize: "0.8125rem", fontWeight: svcDue ? 600 : 400,
                    color: svcOverdue ? "#dc2626" : svcDue ? "#d97706" : "#44403c" }}>
                    {svcDate.toLocaleDateString("en-AU")}
                    {svcOverdue ? " ⚠ Overdue" : svcDue ? " ⚠ Due soon" : ""}
                  </span>
                ) : <span style={{ color: "#a8a29e" }}>—</span>}
              </td>
              <td>
                {m.status === "operational"    && <span className="badge badge-green"  style={{ fontSize: "0.6875rem" }}>Operational</span>}
                {m.status === "maintenance"    && <span className="badge badge-blue"   style={{ fontSize: "0.6875rem" }}>Maintenance</span>}
                {m.status === "breakdown"      && <span className="badge" style={{ fontSize: "0.6875rem", background: "#fef2f2", color: "#dc2626" }}>Breakdown</span>}
                {m.status === "decommissioned" && <span className="badge badge-gray"   style={{ fontSize: "0.6875rem" }}>Decommissioned</span>}
              </td>
              <td>
                <Link href={`/settings/machines/${m.id}`} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}>View</Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
