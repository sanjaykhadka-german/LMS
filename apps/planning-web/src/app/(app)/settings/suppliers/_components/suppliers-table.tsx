"use client";

/**
 * Suppliers register — bulk-edit grid (Tino May 7 2026).
 *
 * Read-only DataTable by default with an "Edit Grid" toggle (managed by
 * DataTable itself) that flips inline cells into edit mode. Bulk save
 * routes every changed row through one Supabase update each, with
 * field-level coercion (empty strings → null on nullable text columns,
 * boolean cast on is_active).
 *
 * Mirrors the bulk-machines-grid convention so /settings/suppliers
 * behaves the same way as /settings/machines and /items.
 */

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type ColumnDef } from "@/components/data-table";

type SupplierRow = {
  id: string;
  code: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
  payment_terms: string | null;
  is_active: boolean;
};

const CURRENCIES = ["AUD", "USD", "EUR", "GBP", "NZD", "JPY", "CNY", "SGD"] as const;

export default function SuppliersTable({ suppliers }: { suppliers: SupplierRow[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return suppliers.filter(s => {
      if (statusFilter === "active" && !s.is_active) return false;
      if (statusFilter === "inactive" && s.is_active) return false;
      if (!q) return true;
      return (
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.contact_name ?? "").toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [suppliers, query, statusFilter]);

  const columns: ColumnDef<SupplierRow>[] = useMemo(() => [
    {
      key: "code",
      label: "Code",
      width: 100,
      render: (v) => <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{String(v)}</span>,
      sortable: true,
      editable: { type: "text", placeholder: "SUP-001" },
    },
    {
      key: "name",
      label: "Name",
      width: 220,
      render: (v) => <span style={{ fontWeight: 500 }}>{String(v)}</span>,
      sortable: true,
      editable: { type: "text", placeholder: "Supplier name" },
    },
    {
      key: "contact_name",
      label: "Contact",
      width: 160,
      render: (v) => <span style={{ color: "#78716c" }}>{v ? String(v) : "—"}</span>,
      editable: { type: "text", placeholder: "Primary contact" },
    },
    {
      key: "email",
      label: "Email",
      width: 220,
      render: (v) => v ? (
        <a href={`mailto:${v}`} onClick={e => e.stopPropagation()} style={{ color: "#b91c1c", textDecoration: "none" }}>{String(v)}</a>
      ) : <span style={{ color: "#a8a29e" }}>—</span>,
      editable: { type: "text", placeholder: "name@example.com" },
    },
    {
      key: "phone",
      label: "Phone",
      width: 140,
      render: (v) => <span style={{ color: "#78716c" }}>{v ? String(v) : "—"}</span>,
      editable: { type: "text", placeholder: "+61 …" },
    },
    {
      key: "payment_terms",
      label: "Payment Terms",
      width: 130,
      render: (v) => <span style={{ color: "#78716c" }}>{v ? String(v) : "—"}</span>,
      editable: { type: "text", placeholder: "Net 30 …" },
    },
    {
      key: "currency",
      label: "Currency",
      width: 90,
      render: (v) => <span style={{ fontFamily: "monospace", color: "#78716c" }}>{String(v)}</span>,
      editable: {
        type: "select",
        options: CURRENCIES.map(c => ({ value: c, label: c })),
      },
    },
    {
      key: "is_active",
      label: "Active",
      width: 90,
      render: (v) => v
        ? <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Active</span>
        : <span className="badge badge-gray" style={{ fontSize: "0.6875rem" }}>Inactive</span>,
      editable: {
        type: "select",
        options: [
          { value: "true",  label: "Yes" },
          { value: "false", label: "No"  },
        ],
      },
    },
  ], []);

  // ── Bulk save handler ─────────────────────────────────────────────────────
  // Same shape as bulk-machines-grid + items-table. Coerce empty strings to
  // null on nullable text columns, cast is_active to boolean.
  async function handleBulkSave(
    changes: { id: string; fields: Record<string, unknown> }[],
  ): Promise<string | null> {
    const supabase = createClient();
    const errors: string[] = [];

    const NULLABLE_TEXT = new Set(["contact_name", "email", "phone", "payment_terms"]);
    const BOOLEAN_FIELDS = new Set(["is_active"]);

    await Promise.all(changes.map(async ({ id, fields }) => {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (BOOLEAN_FIELDS.has(k)) {
          payload[k] = v === true || v === "true";
          continue;
        }
        if (NULLABLE_TEXT.has(k)) {
          const s = typeof v === "string" ? v.trim() : v;
          payload[k] = s === "" || s == null ? null : s;
          continue;
        }
        payload[k] = typeof v === "string" ? v.trim() : (v ?? null);
      }
      const { error } = await supabase.from("suppliers").update(payload).eq("id", id);
      if (error) errors.push(`${id.slice(0, 8)}: ${error.message}`);
    }));

    return errors.length > 0 ? errors.join("; ") : null;
  }

  return (
    <>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", padding: "0.75rem 1rem", borderBottom: "1px solid #e7e5e4", flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Search by code, name, contact, email…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="form-input"
          style={{ width: 300, fontSize: "0.875rem" }}
        />
        <div style={{ display: "flex", gap: "0.375rem" }}>
          {(["all", "active", "inactive"] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "0.3125rem 0.75rem",
                borderRadius: "0.375rem",
                border: "1px solid",
                fontSize: "0.8125rem",
                cursor: "pointer",
                borderColor: statusFilter === s ? "#2563eb" : "var(--border)",
                background: statusFilter === s ? "#dbeafe" : "transparent",
                color: statusFilter === s ? "#1d4ed8" : "inherit",
                fontWeight: statusFilter === s ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <span style={{ fontSize: "0.8125rem", color: "#78716c", marginLeft: "auto" }}>
          {filtered.length} of {suppliers.length}
        </span>
      </div>

      {/* Scroll container for stickyHeader: the <thead> stays pinned to the
          top of this div as the operator scrolls through the supplier rows. */}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <DataTable
          columns={columns}
          data={filtered}
          href={(row) => `/settings/suppliers/${row.id}`}
          onBulkSave={handleBulkSave}
          emptyMessage="No suppliers match your search."
          emptyHref="/settings/suppliers/new"
          emptyLabel="Add your first supplier →"
          storageKey="suppliers.v1"
          stickyHeader
        />
      </div>
    </>
  );
}
