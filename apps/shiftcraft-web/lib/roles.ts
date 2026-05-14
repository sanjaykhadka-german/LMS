import type { Role } from "@tracey/db";

// ShiftCraft uses Deputy-style tier names (Admin / Manager / Employee) in
// the UI on top of Tracey's underlying owner/admin/member roles. Mapping
// is purely cosmetic — the auth/DB layer stays unchanged.
//
//   Tracey owner  → "Admin"     (full access incl. billing)
//   Tracey admin  → "Manager"   (can manage schedule, employees, tasks)
//   Tracey member → "Employee"  (own-self actions only)
//
// Keeping the cosmetic layer here means lms-web / planning-web continue
// using the same owner/admin/member labels they already do — no
// cross-app schema or label coordination needed.

export type FriendlyRole = "Admin" | "Manager" | "Employee";

export function friendlyRoleLabel(role: Role | string): FriendlyRole {
  switch (role) {
    case "owner":
      return "Admin";
    case "admin":
      return "Manager";
    case "member":
    default:
      return "Employee";
  }
}

export interface RoleDescription {
  label: FriendlyRole;
  underlying: Role;
  blurb: string;
  can: string[];
  cannot: string[];
}

export const ROLE_DESCRIPTIONS: Record<Role, RoleDescription> = {
  owner: {
    label: "Admin",
    underlying: "owner",
    blurb:
      "Full access to the workspace including billing, members, and tenant settings.",
    can: [
      "Everything a Manager can do",
      "Change billing plan and seat count",
      "Invite or remove members",
      "Transfer ownership",
    ],
    cannot: [],
  },
  admin: {
    label: "Manager",
    underlying: "admin",
    blurb:
      "Day-to-day workspace management. Manage rosters, schedules, and tasks; cannot touch billing or membership.",
    can: [
      "Add / edit employees, locations, shifts",
      "Approve time-off and shift swaps",
      "Post announcements and tasks",
      "View Reports and export timesheets",
    ],
    cannot: ["Change billing", "Invite or remove members"],
  },
  member: {
    label: "Employee",
    underlying: "member",
    blurb:
      "Self-service access. See your own shifts, clock in/out, request time off.",
    can: [
      "View own shifts and timesheets",
      "Clock in / out and take breaks",
      "Request time off and propose shift swaps",
      "See dashboard announcements and assigned tasks",
    ],
    cannot: [
      "Edit other employees",
      "Modify the schedule",
      "Approve time-off",
    ],
  },
};

/** Numeric rank — useful for comparisons. owner=2, admin=1, member=0. */
export function roleRank(role: Role | string): number {
  switch (role) {
    case "owner":
      return 2;
    case "admin":
      return 1;
    case "member":
    default:
      return 0;
  }
}

export function isAtLeastManager(role: Role | string): boolean {
  return roleRank(role) >= 1;
}

export function isAdmin(role: Role | string): boolean {
  return roleRank(role) >= 2;
}
