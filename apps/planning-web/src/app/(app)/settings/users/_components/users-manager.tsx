"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";

type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  role_id: string | null;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  date_of_birth: string | null;
  start_date: string | null;
  finished_date: string | null;
  work_department_id: string | null;
  all_departments: boolean;
  category_id: string | null;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  role_id: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  notes: string | null;
};

type Department = { id: string; name: string; code: string };
type Category = { id: string; name: string };
type DeptAccess = { profile_id: string; department_id: string };
type Role = { id: string; name: string; is_active: boolean };

const ROLE_BADGE: Record<string, string> = {
  admin: "badge-red", manager: "badge-blue", operator: "badge-green", viewer: "badge-gray",
};

export default function UsersManager({
  profiles, invites, departments, categories, deptAccess, roles,
  myRole, myId, tenantId,
}: {
  profiles: Profile[];
  invites: Invite[];
  departments: Department[];
  categories: Category[];
  deptAccess: DeptAccess[];
  roles: Role[];
  myRole: string;
  myId: string;
  tenantId: string;
}) {
  const supabase = createClient();
  const router = useRouter();

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("");  // role_id from roles table
  const [inviteNotes, setInviteNotes] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok?: boolean; error?: string } | null>(null);

  // Expanded profile state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Partial<Profile> & { id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);

  // Activity panel
  const [activityTab, setActivityTab] = useState<"details" | "activity">("details");
  const [activity, setActivity] = useState<{ logins: any[]; actions: any[] } | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // Resend invite / password reset
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<Record<string, string>>({});
  const [sendingReset, setSendingReset] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function loadActivity(userId: string) {
    setActivityLoading(true);
    const res = await fetch(`/api/user-activity?user_id=${userId}`);
    if (res.ok) setActivity(await res.json());
    setActivityLoading(false);
  }

  const canInviteAdmin = myRole === "admin";
  // Only admins can invite to the Admin role
  const adminRoleId = roles.find(r => r.name.toLowerCase() === "admin")?.id;
  const availableRoles = canInviteAdmin ? roles : roles.filter(r => r.id !== adminRoleId);

  // Helpers: resolve role name + badge from role_id (falls back to old role string)
  const getRoleName = (roleId: string | null, fallback: string) =>
    (roleId ? roles.find(r => r.id === roleId)?.name : null) ?? fallback;
  const getRoleBadge = (name: string) => ROLE_BADGE[name.toLowerCase()] ?? "badge-gray";

  // Build dept access lookup
  const accessMap: Record<string, string[]> = {};
  deptAccess.forEach(d => {
    if (!accessMap[d.profile_id]) accessMap[d.profile_id] = [];
    accessMap[d.profile_id].push(d.department_id);
  });

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true); setInviteResult(null);
    const res = await fetch("/api/invite-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim(), role_id: inviteRole, notes: inviteNotes }),
    });
    const json = await res.json();
    if (res.ok) {
      setInviteResult({ ok: true });
      setInviteEmail(""); setInviteNotes("");
      router.refresh();
    } else {
      setInviteResult({ error: json.error });
    }
    setInviting(false);
  }

  async function resendCredentials(userId: string) {
    setResendingInvite(userId);
    setResendResult(prev => ({ ...prev, [userId]: "" }));
    const res = await fetch("/api/resend-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const json = await res.json();
    setResendResult(prev => ({ ...prev, [userId]: res.ok ? "Sent!" : (json.error ?? "Failed") }));
    setResendingInvite(null);
  }

  async function sendPasswordReset(userId: string) {
    setSendingReset(userId);
    setResetResult(prev => ({ ...prev, [userId]: "" }));
    const res = await fetch("/api/resend-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const json = await res.json();
    setResetResult(prev => ({ ...prev, [userId]: res.ok ? "New credentials sent!" : (json.error ?? "Failed") }));
    setSendingReset(null);
  }

  async function deleteUser(userId: string) {
    setDeletingId(userId);
    const res = await fetch("/api/delete-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      setConfirmDeleteId(null);
      setExpandedId(null);
      setEditingProfile(null);
      router.refresh();
    } else {
      const j = await res.json();
      alert(j.error ?? "Failed to delete user");
    }
    setDeletingId(null);
  }

  function expandProfile(p: Profile) {
    if (expandedId === p.id) {
      // Already expanded in view mode — collapse
      if (!isEditing) {
        setExpandedId(null);
      }
      // If editing, ignore row click (use Cancel button)
      return;
    }
    setExpandedId(p.id);
    setIsEditing(false);
    setEditingProfile({ ...p });
    setSelectedDepts(accessMap[p.id] ?? []);
    setActivityTab("details");
    setActivity(null);
  }

  function startEdit() {
    setIsEditing(true);
  }

  function cancelEdit() {
    if (isEditing) {
      // Back to view mode, reset any changes
      const original = profiles.find(p => p.id === expandedId);
      if (original) setEditingProfile({ ...original });
      setIsEditing(false);
    } else {
      setExpandedId(null);
      setEditingProfile(null);
    }
  }

  async function saveProfile() {
    if (!editingProfile) return;
    setSaving(true);
    const { id, ...rest } = editingProfile;

    // Keep old role string in sync for backward compat
    const resolvedRoleName = rest.role_id
      ? (roles.find(r => r.id === rest.role_id)?.name?.toLowerCase() ?? rest.role)
      : rest.role;

    await supabase.from("profiles").update({
      full_name:          rest.full_name || null,
      role:               resolvedRoleName,
      role_id:            rest.role_id || null,
      phone:              rest.phone || null,
      address_line1:      rest.address_line1 || null,
      address_line2:      rest.address_line2 || null,
      city:               rest.city || null,
      state:              rest.state || null,
      postcode:           rest.postcode || null,
      country:            rest.country || "AU",
      date_of_birth:      rest.date_of_birth || null,
      start_date:         rest.start_date || null,
      finished_date:      rest.finished_date || null,
      work_department_id: rest.work_department_id || null,
      all_departments:    rest.all_departments ?? true,
      category_id:        rest.category_id || null,
      is_active:          rest.is_active,
    }).eq("id", id);

    if (!rest.all_departments) {
      await supabase.from("user_department_access").delete().eq("profile_id", id);
      if (selectedDepts.length > 0) {
        await supabase.from("user_department_access").insert(
          selectedDepts.map(dept_id => ({ tenant_id: tenantId, profile_id: id, department_id: dept_id }))
        );
      }
    }

    setSaving(false);
    setIsEditing(false);
    router.refresh();
  }

  async function toggleActive(profile: Profile) {
    if (profile.id === myId) { alert("You cannot deactivate your own account."); return; }
    await supabase.from("profiles").update({ is_active: !profile.is_active }).eq("id", profile.id);
    router.refresh();
  }

  async function cancelInvite(inviteId: string) {
    await supabase.from("user_invites").update({ status: "cancelled" }).eq("id", inviteId);
    router.refresh();
  }

  function setField<K extends keyof Profile>(k: K, v: Profile[K]) {
    setEditingProfile(p => p ? { ...p, [k]: v } : p);
  }

  const inp = (k: keyof Profile, placeholder = "") => ({
    className: "form-input",
    value: (editingProfile?.[k] as string) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setField(k, e.target.value as Profile[typeof k]),
    placeholder,
  });

  const pendingInvites = invites.filter(i => i.status === "pending");
  const pastInvites = invites.filter(i => i.status !== "pending");

  return (
    <div style={{ maxWidth: "960px" }}>
      <BackButton href="/settings" label="Settings" />
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Manage staff access, roles, contact details and department assignments</p>
        </div>
        <button onClick={() => setShowInvite(s => !s)} className="btn-primary">
          + Invite User
        </button>
      </div>

      {/* Role guide */}
      <div className="card" style={{ marginBottom: "1.5rem", fontSize: "0.875rem" }}>
        <h2 style={{ fontSize: "0.9rem", fontWeight: "600", margin: "0 0 0.5rem" }}>Role Reference</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem" }}>
          {[
            { role: "viewer",   desc: "Read-only access to all data" },
            { role: "operator", desc: "Can enter production data and scan lots" },
            { role: "manager",  desc: "Can edit items, suppliers, customers; invite operators" },
            { role: "admin",    desc: "Full access including user management and audit log" },
          ].map(r => (
            <div key={r.role} style={{ padding: "0.5rem 0.75rem", background: "#fafaf9", borderRadius: "0.5rem", border: "1px solid #e7e5e4" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>
                <span className={`badge ${getRoleBadge(r.role)}`} style={{ fontSize: "0.6875rem" }}>{r.role}</span>
              </div>
              <div style={{ color: "#78716c", fontSize: "0.8rem" }}>{r.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Send Invitation</h2>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label className="form-label">Email Address *</label>
              <input className="form-input" type="email" value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)} placeholder="staff@germanbutchery.com.au" />
            </div>
            <div>
              <label className="form-label">Role *</label>
              <select className="form-select" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                <option value="">Select a role…</option>
                {availableRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Notes (internal — not sent to user)</label>
              <input className="form-input" value={inviteNotes} onChange={e => setInviteNotes(e.target.value)}
                placeholder="e.g. New production operator starting Monday" />
            </div>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
            The user will receive an email with a link to set their password and join the team. Invite expires in 7 days.
          </p>
          {inviteResult?.error && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: "0 0 0.75rem" }}>Error: {inviteResult.error}</p>}
          {inviteResult?.ok && <p style={{ color: "#15803d", fontSize: "0.875rem", margin: "0 0 0.75rem" }}>Invitation sent!</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={sendInvite} className="btn-primary" disabled={inviting}>{inviting ? "Sending…" : "Send Invite"}</button>
            <button onClick={() => { setShowInvite(false); setInviteResult(null); }} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Team members */}
      <div className="card" style={{ marginBottom: "1.5rem", padding: 0 }}>
        <div style={{ padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid #f5f5f4" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Team Members ({profiles.length})</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Category</th>
              <th>Role</th>
              <th>Department</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map(p => {
              const cat = categories.find(c => c.id === p.category_id);
              const workDept = departments.find(d => d.id === p.work_department_id);
              const isExpanded = expandedId === p.id;
              return (
                <React.Fragment key={p.id}>
                  <tr
                    style={{ opacity: p.is_active ? 1 : 0.55, cursor: "pointer" }}
                    onClick={() => expandProfile(p)}
                  >
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.full_name ?? "(No name set)"}</div>
                      {p.id === myId && <div style={{ fontSize: "0.75rem", color: "#78716c" }}>You</div>}
                    </td>
                    <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>{p.email ?? "—"}</td>
                    <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>{cat?.name ?? "—"}</td>
                    <td>
                      <span className={`badge ${getRoleBadge(getRoleName(p.role_id, p.role))}`} style={{ fontSize: "0.6875rem" }}>
                        {getRoleName(p.role_id, p.role)}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                      {workDept?.name ?? "—"}
                      {p.all_departments && <span style={{ fontSize: "0.7rem", color: "#a78bfa", marginLeft: "0.375rem" }}>all depts</span>}
                    </td>
                    <td>
                      {p.is_active
                        ? <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Active</span>
                        : <span className="badge badge-gray" style={{ fontSize: "0.6875rem" }}>Inactive</span>}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{ fontSize: "0.75rem", color: "#b91c1c" }}>{isExpanded ? "▲" : "▼"}</span>
                    </td>
                  </tr>

                  {/* Expanded panel */}
                  {isExpanded && editingProfile && (
                    <tr key={`${p.id}-detail`}>
                      <td colSpan={7} style={{ background: "#fafaf9", padding: "1.25rem", borderTop: "none" }}>

                        {/* ── View mode ── */}
                        {!isEditing && (
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                              {/* Tabs */}
                              <div style={{ display: "flex", gap: "0.25rem", background: "#f0efee", borderRadius: "0.5rem", padding: "0.2rem" }}>
                                {(["details", "activity"] as const).map(tab => (
                                  <button
                                    key={tab}
                                    type="button"
                                    onClick={() => {
                                      setActivityTab(tab);
                                      if (tab === "activity" && !activity) loadActivity(p.id);
                                    }}
                                    style={{
                                      padding: "0.3rem 0.875rem",
                                      borderRadius: "0.375rem",
                                      border: "none",
                                      fontSize: "0.8125rem",
                                      fontWeight: 500,
                                      cursor: "pointer",
                                      background: activityTab === tab ? "#fff" : "transparent",
                                      color: activityTab === tab ? "#1c1917" : "#78716c",
                                      boxShadow: activityTab === tab ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                                    }}
                                  >
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                  </button>
                                ))}
                              </div>
                              <button type="button" className="btn-secondary" onClick={startEdit}>Edit</button>
                            </div>

                            {/* Activity tab */}
                            {activityTab === "activity" && (
                              <div>
                                {activityLoading ? (
                                  <div style={{ color: "#78716c", fontSize: "0.875rem", padding: "1rem 0" }}>Loading activity…</div>
                                ) : activity ? (
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
                                    {/* Logins */}
                                    <div>
                                      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.625rem" }}>Login History</div>
                                      {activity.logins.length === 0 ? (
                                        <div style={{ fontSize: "0.8125rem", color: "#a8a29e" }}>No logins recorded yet</div>
                                      ) : (
                                        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                                          {activity.logins.map((l: any) => (
                                            <div key={l.id} style={{ fontSize: "0.8125rem", display: "flex", justifyContent: "space-between", padding: "0.375rem 0.5rem", background: "#fff", borderRadius: "0.375rem", border: "1px solid #e7e5e4" }}>
                                              <span style={{ color: "#1c1917" }}>
                                                {new Date(l.created_at).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                              </span>
                                              {l.ip_address && <span style={{ color: "#a8a29e", fontSize: "0.75rem" }}>{l.ip_address}</span>}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    {/* Actions */}
                                    <div>
                                      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.625rem" }}>Recent Actions</div>
                                      {activity.actions.length === 0 ? (
                                        <div style={{ fontSize: "0.8125rem", color: "#a8a29e" }}>No actions recorded yet</div>
                                      ) : (
                                        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                                          {activity.actions.map((a: any) => (
                                            <div key={a.id} style={{ fontSize: "0.8125rem", padding: "0.375rem 0.5rem", background: "#fff", borderRadius: "0.375rem", border: "1px solid #e7e5e4" }}>
                                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                                <span style={{ fontWeight: 500 }}>
                                                  <span style={{ color: a.action === "DELETE" ? "#b91c1c" : a.action === "INSERT" ? "#166534" : "#1e40af", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", marginRight: "0.375rem" }}>{a.action}</span>
                                                  {a.record_label ?? a.table_name}
                                                </span>
                                                <span style={{ color: "#a8a29e", fontSize: "0.75rem", flexShrink: 0, marginLeft: "0.5rem" }}>
                                                  {new Date(a.created_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                                </span>
                                              </div>
                                              {a.changed_fields?.length > 0 && (
                                                <div style={{ color: "#78716c", fontSize: "0.75rem", marginTop: "0.125rem" }}>
                                                  Changed: {a.changed_fields.join(", ")}
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            )}

                            {/* Details tab */}
                            {activityTab === "details" && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
                              {/* Identity */}
                              <div>
                                <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.625rem" }}>Identity &amp; Role</div>
                                <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "0.4rem 0.75rem", fontSize: "0.875rem" }}>
                                  {[
                                    ["Name", editingProfile.full_name || "—"],
                                    ["Email", editingProfile.email || "—"],
                                    ["Role", null],
                                    ["Category", categories.find(c => c.id === editingProfile.category_id)?.name ?? "—"],
                                    ["Status", editingProfile.is_active ? "Active" : "Inactive"],
                                  ].map(([k, v]) => (
                                    <React.Fragment key={k as string}>
                                      <div style={{ color: "#78716c" }}>{k}</div>
                                      <div>
                                        {k === "Role"
                                          ? <span className={`badge ${getRoleBadge(getRoleName(editingProfile.role_id ?? null, editingProfile.role ?? ""))}`} style={{ fontSize: "0.6875rem" }}>{getRoleName(editingProfile.role_id ?? null, editingProfile.role ?? "")}</span>
                                          : v as string}
                                      </div>
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                              {/* Contact */}
                              <div>
                                <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.625rem" }}>Contact &amp; Employment</div>
                                <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "0.4rem 0.75rem", fontSize: "0.875rem" }}>
                                  {[
                                    ["Phone", editingProfile.phone || "—"],
                                    ["Date of Birth", editingProfile.date_of_birth ? new Date(editingProfile.date_of_birth).toLocaleDateString("en-AU") : "—"],
                                    ["Address", [editingProfile.address_line1, editingProfile.city, editingProfile.state, editingProfile.postcode].filter(Boolean).join(", ") || "—"],
                                    ["Start Date", editingProfile.start_date ? new Date(editingProfile.start_date).toLocaleDateString("en-AU") : "—"],
                                    ["Department", departments.find(d => d.id === editingProfile.work_department_id)?.name ?? "—"],
                                  ].map(([k, v]) => (
                                    <React.Fragment key={k as string}>
                                      <div style={{ color: "#78716c" }}>{k}</div>
                                      <div>{v as string}</div>
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                            </div>
                            )}
                            <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #e7e5e4", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                              <button onClick={() => { setExpandedId(null); setEditingProfile(null); setActivityTab("details"); setActivity(null); }} className="btn-secondary">Close</button>
                              {myRole === "admin" && editingProfile && p.id !== myId && (
                                <>
                                  <button
                                    onClick={() => sendPasswordReset(p.id)}
                                    disabled={sendingReset === p.id}
                                    className="btn-secondary"
                                    style={{ fontSize: "0.8125rem" }}
                                  >
                                    {sendingReset === p.id ? "Sending…" : "Send Password Reset"}
                                  </button>
                                  {resetResult[p.id] && (
                                    <span style={{ fontSize: "0.8125rem", color: !resetResult[p.id]?.includes("Failed") ? "#15803d" : "#dc2626" }}>
                                      {resetResult[p.id]}
                                    </span>
                                  )}
                                </>
                              )}
                              {myRole === "admin" && editingProfile && p.id !== myId && (
                                confirmDeleteId === p.id ? (
                                  <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "auto" }}>
                                    <span style={{ fontSize: "0.8125rem", color: "#dc2626" }}>Delete this user?</span>
                                    <button
                                      onClick={() => deleteUser(p.id)}
                                      disabled={deletingId === p.id}
                                      style={{ padding: "0.25rem 0.75rem", fontSize: "0.8125rem", background: "#dc2626", color: "#fff", border: "none", borderRadius: "0.375rem", cursor: "pointer" }}
                                    >
                                      {deletingId === p.id ? "Deleting…" : "Yes, delete"}
                                    </button>
                                    <button
                                      onClick={() => setConfirmDeleteId(null)}
                                      style={{ padding: "0.25rem 0.75rem", fontSize: "0.8125rem", background: "none", border: "1px solid #e7e5e4", borderRadius: "0.375rem", cursor: "pointer", color: "#44403c" }}
                                    >
                                      Cancel
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteId(p.id)}
                                    style={{ marginLeft: "auto", padding: "0.25rem 0.75rem", fontSize: "0.8125rem", background: "none", border: "1px solid #fca5a5", borderRadius: "0.375rem", cursor: "pointer", color: "#dc2626" }}
                                  >
                                    Delete User
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        )}

                        {/* ── Edit mode ── */}
                        {isEditing && (
                          <div style={{ display: "grid", gap: "1.25rem" }}>

                            {/* Identity & Role */}
                            <div>
                              <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.625rem" }}>Identity &amp; Role</div>
                              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "0.75rem" }}>
                                <div>
                                  <label className="form-label">Full Name</label>
                                  <input {...inp("full_name", "Full name")} />
                                </div>
                                <div>
                                  <label className="form-label">Role</label>
                                  <select className="form-select" value={editingProfile.role_id ?? ""}
                                    onChange={e => setField("role_id", e.target.value)}
                                    disabled={p.id === myId}>
                                    <option value="">— Select role —</option>
                                    {availableRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="form-label">Category</label>
                                  <select className="form-select" value={editingProfile.category_id ?? ""}
                                    onChange={e => setField("category_id", e.target.value || null)}>
                                    <option value="">— None —</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                </div>
                                <div style={{ display: "flex", alignItems: "flex-end" }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", paddingBottom: "0.5rem", cursor: "pointer" }}>
                                    <input type="checkbox" checked={editingProfile.is_active}
                                      onChange={e => setField("is_active", e.target.checked)}
                                      disabled={p.id === myId} />
                                    Active
                                  </label>
                                </div>
                              </div>
                            </div>

                            {/* Contact */}
                            <div>
                              <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.625rem" }}>Contact Details</div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                                <div>
                                  <label className="form-label">Email <span style={{ fontWeight: 400, color: "#a8a29e", fontSize: "0.75rem" }}>(read-only)</span></label>
                                  <input className="form-input" value={editingProfile.email ?? ""} readOnly
                                    style={{ background: "#f5f5f4", color: "#78716c", cursor: "not-allowed" }} />
                                </div>
                                <div>
                                  <label className="form-label">Phone</label>
                                  <input {...inp("phone", "+61 4xx xxx xxx")} type="tel" />
                                </div>
                                <div>
                                  <label className="form-label">Date of Birth</label>
                                  <input {...inp("date_of_birth")} type="date" />
                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                  <label className="form-label">Address Line 1</label>
                                  <input {...inp("address_line1", "Street address")} />
                                </div>
                                <div>
                                  <label className="form-label">Address Line 2</label>
                                  <input {...inp("address_line2", "Unit / Suite")} />
                                </div>
                                <div>
                                  <label className="form-label">City</label>
                                  <input {...inp("city", "City")} />
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                                  <div>
                                    <label className="form-label">State</label>
                                    <input {...inp("state", "VIC")} />
                                  </div>
                                  <div>
                                    <label className="form-label">Postcode</label>
                                    <input {...inp("postcode", "3000")} />
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Employment */}
                            <div>
                              <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.625rem" }}>Employment</div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                                <div>
                                  <label className="form-label">Start Date</label>
                                  <input {...inp("start_date")} type="date" />
                                </div>
                                <div>
                                  <label className="form-label">Finish Date</label>
                                  <input {...inp("finished_date")} type="date" />
                                </div>
                                <div>
                                  <label className="form-label">Work Department</label>
                                  <select className="form-select" value={editingProfile.work_department_id ?? ""}
                                    onChange={e => setField("work_department_id", e.target.value || null)}>
                                    <option value="">— Not assigned —</option>
                                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                  </select>
                                </div>
                              </div>
                            </div>

                            {/* Department data visibility */}
                            <div>
                              <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.625rem" }}>Data Visibility — Departments</div>
                              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer", marginBottom: "0.625rem" }}>
                                <input type="checkbox" checked={editingProfile.all_departments ?? true}
                                  onChange={e => setField("all_departments", e.target.checked)} />
                                Can see data from <strong>all departments</strong>
                              </label>
                              {!editingProfile.all_departments && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                                  {departments.map(d => {
                                    const checked = selectedDepts.includes(d.id);
                                    return (
                                      <label key={d.id} style={{
                                        display: "flex", alignItems: "center", gap: "0.375rem",
                                        padding: "0.3rem 0.625rem", borderRadius: "0.375rem", cursor: "pointer",
                                        fontSize: "0.8125rem", border: `1px solid ${checked ? "#6366f1" : "#e7e5e4"}`,
                                        background: checked ? "#eef2ff" : "#fafaf9",
                                      }}>
                                        <input type="checkbox" checked={checked}
                                          onChange={() => setSelectedDepts(prev =>
                                            prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id]
                                          )} style={{ display: "none" }} />
                                        <span style={{ color: checked ? "#4338ca" : "#78716c", fontWeight: checked ? 600 : 400 }}>
                                          {checked ? "✓ " : ""}{d.name}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div style={{ display: "flex", gap: "0.5rem", paddingTop: "0.25rem" }}>
                              <button onClick={saveProfile} className="btn-primary" disabled={saving}>
                                {saving ? "Saving…" : "Save Changes"}
                              </button>
                              <button onClick={cancelEdit} className="btn-secondary">Cancel</button>
                              {p.id !== myId && (
                                <button onClick={() => { toggleActive(p); cancelEdit(); }}
                                  className="btn-secondary" style={{ marginLeft: "auto", color: p.is_active ? "#dc2626" : "#15803d" }}>
                                  {p.is_active ? "Deactivate User" : "Activate User"}
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div className="card" style={{ marginBottom: "1.5rem", padding: 0 }}>
          <div style={{ padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid #f5f5f4" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Pending Invitations ({pendingInvites.length})</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Email</th><th>Role</th><th>Notes</th><th>Sent</th><th>Expires</th><th></th></tr>
            </thead>
            <tbody>
              {pendingInvites.map(i => {
                const expired = new Date(i.expires_at) < new Date();
                return (
                  <tr key={i.id} style={{ opacity: expired ? 0.55 : 1 }}>
                    <td>{i.email}</td>
                    <td><span className={`badge ${getRoleBadge(getRoleName(i.role_id, i.role))}`} style={{ fontSize: "0.6875rem" }}>{getRoleName(i.role_id, i.role)}</span></td>
                    <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>{i.notes ?? "—"}</td>
                    <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>{new Date(i.created_at).toLocaleDateString("en-AU")}</td>
                    <td style={{ fontSize: "0.8125rem", color: expired ? "#dc2626" : "#78716c" }}>
                      {new Date(i.expires_at).toLocaleDateString("en-AU")}{expired && " (Expired)"}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
                        <button onClick={() => resendInvite(i.id)}
                          disabled={resendingInvite === i.id}
                          style={{ fontSize: "0.75rem", background: "none", border: "1px solid #bbf7d0",
                            borderRadius: "0.375rem", color: "#15803d", cursor: "pointer", padding: "0.25rem 0.5rem",
                            opacity: resendingInvite === i.id ? 0.6 : 1 }}>
                          {resendingInvite === i.id ? "Sending…" : "Resend"}
                        </button>
                        <button onClick={() => cancelInvite(i.id)}
                          style={{ fontSize: "0.75rem", background: "none", border: "1px solid #fca5a5",
                            borderRadius: "0.375rem", color: "#dc2626", cursor: "pointer", padding: "0.25rem 0.5rem" }}>
                          Cancel
                        </button>
                        {resendResult[i.id] && (
                          <span style={{ fontSize: "0.75rem", color: resendResult[i.id] === "Sent!" ? "#15803d" : "#dc2626" }}>
                            {resendResult[i.id]}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Past invites */}
      {pastInvites.length > 0 && (
        <details style={{ marginBottom: "1rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.875rem", color: "#78716c", padding: "0.5rem" }}>
            Past invitations ({pastInvites.length})
          </summary>
          <div className="card" style={{ padding: 0, marginTop: "0.5rem" }}>
            <table className="data-table">
              <thead>
                <tr><th>Email</th><th>Role</th><th>Status</th><th>Accepted</th></tr>
              </thead>
              <tbody>
                {pastInvites.map(i => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td><span className={`badge ${getRoleBadge(getRoleName(i.role_id, i.role))}`} style={{ fontSize: "0.6875rem" }}>{getRoleName(i.role_id, i.role)}</span></td>
                    <td><span className="badge badge-gray" style={{ fontSize: "0.6875rem" }}>{i.status}</span></td>
                    <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                      {i.accepted_at ? new Date(i.accepted_at).toLocaleDateString("en-AU") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
