import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  inserts: [] as Array<{ values: Record<string, unknown>; conflictPatch?: Record<string, unknown> }>,
  deletes: 0,
  lastTenantId: undefined as string | undefined,
};

const currentMembershipMock = vi.fn();

function reset() {
  state.inserts = [];
  state.deletes = 0;
  state.lastTenantId = undefined;
}

vi.mock("@tracey/db", () => ({
  scTimesheetApprovals: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    employeeUserId: { __field: "employeeUserId" },
    weekStart: { __field: "weekStart" },
    status: { __field: "status" },
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      state.lastTenantId = tid;
      const tx = {
        insert: () => ({
          values: (v: Record<string, unknown>) => ({
            onConflictDoUpdate: async ({
              set,
            }: {
              target: unknown;
              set: Record<string, unknown>;
            }) => {
              state.inserts.push({ values: v, conflictPatch: set });
              return [{ id: "new-id" }];
            },
            async then() {
              state.inserts.push({ values: v });
            },
          }),
        }),
        delete: () => ({
          where: async () => {
            state.deletes += 1;
            return [{ id: "deleted" }];
          },
        }),
      };
      return fn(tx);
    },
  }),
}));

vi.mock("~/lib/auth/current", () => ({
  currentMembership: () => currentMembershipMock(),
  currentUser: vi.fn(async () => ({
    id: "user-1",
    email: "admin@example.com",
    name: "Admin",
    image: null,
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function load() {
  return await import("../app/app/timesheets/actions");
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  currentMembershipMock.mockResolvedValue({
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "admin",
  });
});

describe("approveTimesheetAction", () => {
  it("upserts an approved row for the given (user, week)", async () => {
    const { approveTimesheetAction } = await load();
    await approveTimesheetAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-11" }),
    );
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]!.values).toMatchObject({
      traceyTenantId: "tenant-A",
      employeeUserId: "emp-1",
      weekStart: "2026-05-11",
      status: "approved",
      approvedByUserId: "user-1",
    });
    // onConflictDoUpdate set-patch also marks approved.
    expect(state.inserts[0]!.conflictPatch?.status).toBe("approved");
  });

  it("snaps a mid-week date to that week's Monday", async () => {
    const { approveTimesheetAction } = await load();
    // 2026-05-14 is a Thursday. Monday of that week is 2026-05-11.
    await approveTimesheetAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-14" }),
    );
    expect(state.inserts[0]!.values.weekStart).toBe("2026-05-11");
  });

  it("refuses non-managers without writing anything", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { approveTimesheetAction } = await load();
    await approveTimesheetAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-11" }),
    );
    expect(state.inserts).toHaveLength(0);
    expect(state.deletes).toBe(0);
  });

  it("ignores missing employee id", async () => {
    const { approveTimesheetAction } = await load();
    await approveTimesheetAction(fd({ weekStart: "2026-05-11" }));
    expect(state.inserts).toHaveLength(0);
  });
});

describe("disputeTimesheetAction", () => {
  it("writes a disputed row with notes", async () => {
    const { disputeTimesheetAction } = await load();
    await disputeTimesheetAction(
      fd({
        employeeUserId: "emp-1",
        weekStart: "2026-05-11",
        notes: "Please re-check Tuesday.",
      }),
    );
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]!.values).toMatchObject({
      status: "disputed",
      notes: "Please re-check Tuesday.",
    });
  });

  it("stores null notes when blank", async () => {
    const { disputeTimesheetAction } = await load();
    await disputeTimesheetAction(
      fd({
        employeeUserId: "emp-1",
        weekStart: "2026-05-11",
        notes: "   ",
      }),
    );
    expect(state.inserts[0]!.values.notes).toBeNull();
  });
});

describe("clearTimesheetApprovalAction", () => {
  it("deletes the approval row for the given (user, week)", async () => {
    const { clearTimesheetApprovalAction } = await load();
    await clearTimesheetApprovalAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-11" }),
    );
    expect(state.deletes).toBe(1);
    expect(state.lastTenantId).toBe("tenant-A");
  });

  it("is a no-op for a non-manager", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { clearTimesheetApprovalAction } = await load();
    await clearTimesheetApprovalAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-11" }),
    );
    expect(state.deletes).toBe(0);
  });
});
