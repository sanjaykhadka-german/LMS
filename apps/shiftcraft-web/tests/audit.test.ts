import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  inserts: [] as Array<Record<string, unknown>>,
};

const currentUserMock = vi.fn();
const currentMembershipMock = vi.fn();

vi.mock("@tracey/db", () => ({
  auditEvents: { __table: "auditEvents" },
  db: {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        state.inserts.push(v);
        return [];
      },
    }),
  },
}));

vi.mock("~/lib/auth/current", () => ({
  currentUser: () => currentUserMock(),
  currentMembership: () => currentMembershipMock(),
}));

beforeEach(() => {
  state.inserts = [];
  vi.clearAllMocks();
  currentUserMock.mockResolvedValue({
    id: "user-1",
    email: "admin@example.com",
    name: "Admin",
    image: null,
  });
  currentMembershipMock.mockResolvedValue({
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "admin",
  });
});

async function load() {
  return await import("../lib/audit");
}

describe("logAuditEvent", () => {
  it("writes a row with tenant + actor stamped from the session", async () => {
    const { logAuditEvent } = await load();
    await logAuditEvent({
      action: "shiftcraft.employee.deleted",
      targetKind: "sc_employee",
      targetId: "emp-1",
      details: { fullName: "Jane Doe", email: "jane@example.com" },
    });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      tenantId: "tenant-A",
      actorUserId: "user-1",
      actorEmail: "admin@example.com",
      action: "shiftcraft.employee.deleted",
      targetKind: "sc_employee",
      targetId: "emp-1",
    });
  });

  it("nulls tenant/actor when there's no session (system action)", async () => {
    currentUserMock.mockResolvedValueOnce(null);
    currentMembershipMock.mockResolvedValueOnce(null);
    const { logAuditEvent } = await load();
    await logAuditEvent({ action: "system.heartbeat" });
    expect(state.inserts[0]).toMatchObject({
      tenantId: null,
      actorUserId: null,
      actorEmail: null,
      action: "system.heartbeat",
    });
  });

  it("swallows errors so the calling action isn't broken by audit failures", async () => {
    // Stub the next insert to throw.
    const { logAuditEvent } = await load();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Replace state.inserts.push to throw once.
    const origPush = state.inserts.push.bind(state.inserts);
    state.inserts.push = () => {
      state.inserts.push = origPush;
      throw new Error("DB down");
    };
    await expect(
      logAuditEvent({ action: "shiftcraft.task.deleted" }),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
