"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Role = { id: string; name: string; description: string | null; is_system: boolean; is_active: boolean; sort_order: number };
type Permission = { id: string; role_id: string; section: string; access: string };
type AccessLevel = "none" | "read" | "write";

const SECTIONS: { key: string; label: string; group: string }[] = [
  { key: "items",             label: "Item Master",       group: "Inventory" },
  { key: "boms",              label: "Bill of Materials",  group: "Inventory" },
  { key: "stocktakes",        label: "Stocktakes",         group: "Inventory" },
  { key: "production_orders", label: "Production Orders",  group: "Production" },
  { key: "purchase_orders",   label: "Purchase Orders",    group: "Purchasing" },
  { key: "customer_orders",   label: "Customer Orders",    group: "Sales" },
  { key: "dispatch",          label: "Dispatch Floor",     group: "Sales" },
  { key: "invoices",          label: "Invoices",           group: "Sales" },
  { key: "suppliers",         label: "Suppliers",          group: "Contacts" },
  { key: "customers",         label: "Customers",          group: "Contacts" },
  { key: "reports",           label: "Reports",            group: "Reports" },
  { key: "settings",          label: "Settings (general)", group: "Admin" },
  { key: "settings_users",    label: "User Management",    group: "Admin" },
  { key: "settings_roles",    label: "Roles & Permissions",group: "Admin" },
  { key: "audit_log",         label: "Audit Log",          group: "Admin" },
];

const ACCESS_OPTIONS: { value: AccessLevel; label: string; color: string }[] = [
  { value: "none",  label: "None",  color: "#e5e7eb" },
  { value: "read",  label: "Read",  color: "#dbeafe" },
  { value: "write", label: "Write", color: "#dcfce7" },
];

const GROUPS = Array.from(new Set(SECTIONS.map(s => s.group)));

export default function RolesManager({
  initialRoles,
  initialPermissions,
  tenantId,
}: {
  initialRoles: Role[];
  initialPermissions: Permission[];
  tenantId: string;
}) {
  const supabase = createClient();

  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [permissions, setPermissions] = useState<Permission[]>(initialPermissions);
  const [saving, setSaving] = useState<string | null>(null); // section::role_id being saved
  const [error, setError] = useState<string | null>(null);

  // New role form
  const [showAddRole, setShowAddRole] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [addingRole, setAddingRole] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const getAccess = (roleId: string, section: string): AccessLevel => {
    return (permissions.find(p => p.role_id === roleId && p.section === section)?.access ?? "none") as AccessLevel;
  };

  const handleAccessChange = async (roleId: string, section: string, newAccess: AccessLevel) => {
    const key = `${section}::${roleId}`;
    setSaving(key);
    setError(null);

    const existing = permissions.find(p => p.role_id === roleId && p.section === section);

    if (existing) {
      const { error: e } = await supabase
        .from("role_permissions")
        .update({ access: newAccess })
        .eq("id", existing.id);
      if (e) { setError(e.message); setSaving(null); return; }
      setPermissions(prev => prev.map(p => p.id === existing.id ? { ...p, access: newAccess } : p));
    } else {
      const { data, error: e } = await supabase
        .from("role_permissions")
        .insert({ role_id: roleId, section, access: newAccess })
        .select("id, role_id, section, access")
        .single();
      if (e || !data) { setError(e?.message ?? "Failed"); setSaving(null); return; }
      setPermissions(prev => [...prev, data as Permission]);
    }
    setSaving(null);
  };

  const handleToggleRole = async (role: Role) => {
    if (role.is_system) return;
    const { error: e } = await supabase.from("roles").update({ is_active: !role.is_active }).eq("id", role.id);
    if (!e) setRoles(prev => prev.map(r => r.id === role.id ? { ...r, is_active: !role.is_active } : r));
  };

  const handleAddRole = async () => {
    if (!newName.trim()) { setAddError("Name is required"); return; }
    setAddingRole(true); setAddError(null);
    const { data, error: e } = await supabase
      .from("roles")
      .insert({ tenant_id: tenantId, name: newName.trim(), description: newDesc.trim() || null, is_system: false, sort_order: roles.length + 1 })
      .select("id, name, description, is_system, is_active, sort_order")
      .single();
    if (e || !data) { setAddError(e?.message ?? "Failed"); setAddingRole(false); return; }
    // Seed all sections as 'none' for the new role
    const inserts = SECTIONS.map(s => ({ role_id: data.id, section: s.key, access: "none" }));
    const { data: newPerms } = await supabase.from("role_permissions").insert(inserts).select("id, role_id, section, access");
    setRoles(prev => [...prev, data as Role]);
    setPermissions(prev => [...prev, ...(newPerms ?? []) as Permission[]]);
    setNewName(""); setNewDesc(""); setShowAddRole(false); setAddingRole(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {error && (
        <div style={{ padding: "0.5rem 1rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", color: "#991b1b", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {/* Permission grid */}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, flex: 1 }}>Permission Matrix</h2>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            {ACCESS_OPTIONS.map(opt => (
              <span key={opt.value} style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "#57534e" }}>
                <span style={{ width: "12px", height: "12px", borderRadius: "3px", background: opt.color, border: "1px solid #d1d5db", display: "inline-block" }} />
                {opt.label}
              </span>
            ))}
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr style={{ background: "#fafaf9" }}>
              <th style={{ padding: "0.625rem 1.25rem", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #e7e5e4", color: "#57534e", minWidth: "180px" }}>
                Section
              </th>
              {roles.map(role => (
                <th key={role.id} style={{ padding: "0.625rem 1rem", textAlign: "center", fontWeight: 600, borderBottom: "1px solid #e7e5e4", borderLeft: "1px solid #f5f5f4", color: "#1c1917", minWidth: "110px" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
                    <span>{role.name}</span>
                    {role.is_system
                      ? <span style={{ fontSize: "0.6rem", color: "#a8a29e", fontWeight: 400, textTransform: "uppercase", letterSpacing: "0.05em" }}>system</span>
                      : <button onClick={() => handleToggleRole(role)} style={{ fontSize: "0.6rem", background: "none", border: "none", cursor: "pointer", color: role.is_active ? "#15803d" : "#dc2626", padding: 0, fontWeight: 400 }}>
                          {role.is_active ? "active" : "inactive"}
                        </button>
                    }
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(group => (
              <>
                <tr key={`group-${group}`}>
                  <td colSpan={roles.length + 1} style={{ padding: "0.4rem 1.25rem", background: "#f5f5f4", fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #e7e5e4" }}>
                    {group}
                  </td>
                </tr>
                {SECTIONS.filter(s => s.group === group).map(section => (
                  <tr key={section.key} style={{ borderBottom: "1px solid #f5f5f4" }}>
                    <td style={{ padding: "0.5rem 1.25rem", color: "#374151" }}>{section.label}</td>
                    {roles.map(role => {
                      const current = getAccess(role.id, section.key);
                      const key = `${section.key}::${role.id}`;
                      const isSaving = saving === key;
                      return (
                        <td key={role.id} style={{ padding: "0.375rem 0.625rem", borderLeft: "1px solid #f5f5f4", textAlign: "center" }}>
                          <div style={{ display: "flex", gap: "0.25rem", justifyContent: "center" }}>
                            {ACCESS_OPTIONS.map(opt => (
                              <button
                                key={opt.value}
                                onClick={() => handleAccessChange(role.id, section.key, opt.value)}
                                disabled={isSaving}
                                title={opt.label}
                                style={{
                                  width: "28px", height: "24px", borderRadius: "4px",
                                  border: current === opt.value ? "2px solid #374151" : "1px solid #d1d5db",
                                  background: current === opt.value ? opt.color : "#fff",
                                  cursor: isSaving ? "wait" : "pointer",
                                  fontSize: "0.625rem", fontWeight: current === opt.value ? 700 : 400,
                                  color: current === opt.value ? "#1c1917" : "#9ca3af",
                                  transition: "all 0.1s",
                                }}
                              >
                                {isSaving && current === opt.value ? "…" : opt.label.charAt(0)}
                              </button>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Roles list + add */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, flex: 1 }}>Roles ({roles.length})</h2>
          <button onClick={() => setShowAddRole(v => !v)} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
            {showAddRole ? "Cancel" : "+ Add Role"}
          </button>
        </div>

        {showAddRole && (
          <div style={{ marginBottom: "1rem", padding: "1rem", background: "#fafaf9", borderRadius: "0.625rem", border: "1px solid #e7e5e4", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: "160px" }}>
              <label className="form-label">Role Name *</label>
              <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Warehouse" autoFocus />
            </div>
            <div style={{ flex: 2, minWidth: "200px" }}>
              <label className="form-label">Description</label>
              <input className="form-input" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What can this role do?" />
            </div>
            <button onClick={handleAddRole} disabled={addingRole} className="btn-primary" style={{ fontSize: "0.875rem" }}>
              {addingRole ? "Adding…" : "Add Role"}
            </button>
            {addError && <span style={{ color: "#dc2626", fontSize: "0.8125rem", width: "100%" }}>{addError}</span>}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {roles.map(role => (
            <div key={role.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.625rem 0.75rem", borderRadius: "0.5rem", background: role.is_active ? "#fafaf9" : "#f5f5f4", border: "1px solid #e7e5e4", opacity: role.is_active ? 1 : 0.6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.875rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {role.name}
                  {role.is_system && <span style={{ fontSize: "0.6875rem", color: "#78716c", background: "#f5f5f4", border: "1px solid #e7e5e4", borderRadius: "9999px", padding: "0.1rem 0.5rem" }}>system</span>}
                </div>
                {role.description && <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.125rem" }}>{role.description}</div>}
              </div>
              <span className={`badge ${role.is_active ? "badge-green" : "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
                {role.is_active ? "Active" : "Inactive"}
              </span>
              {!role.is_system && (
                <button onClick={() => handleToggleRole(role)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>
                  {role.is_active ? "Deactivate" : "Activate"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
