import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  shift: null as
    | null
    | {
        id: string;
        status: string;
        startsAt: Date;
        role: string;
        acceptedCount: number;
      },
  inserted: [] as Array<Record<string, unknown>>,
  auditCalls: [] as Array<Record<string, unknown>>,
  notifyCalls: [] as Array<{
    tenantId: string;
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }>,
};

const currentUserMock = vi.fn();
const currentMembershipMock = vi.fn();

function reset() {
  state.shift = {
    id: "shift-1",
    status: "published",
    startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
    role: "Butcher",
    acceptedCount: 0,
  };
  state.inserted = [];
  state.auditCalls = [];
  state.notifyCalls = [];
}

vi.mock("@tracey/db", () => ({
  scShifts: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    status: { __field: "status" },
    startsAt: { __field: "startsAt" },
    role: { __field: "role" },
  },
  scShiftAssignments: {
    shiftId: { __field: "shiftId" },
    userId: { __field: "userId" },
    status: { __field: "status" },
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => (state.shift ? [state.shift] : []),
            }),
          }),
        }),
        insert: () => ({
          values: (v: Record<string, unknown>) => ({
            onConflictDoNothing: async () => {
              state.inserted.push(v);
              return [];
            },
          }),
        }),
      };
      return fn(tx);
    },
  }),
}));

vi.mock("~/lib/auth/current", () => ({
  currentUser: () => currentUserMock(),
  currentMembership: () => currentMembershipMock(),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.auditCalls.push(input);
  }),
}));

vi.mock("~/lib/notifications", () => ({
  notifyTenantAdmins: vi.fn(
    async (
      tenantId: string,
      input: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      state.notifyCalls.push({ tenantId, input, options });
    },
  ),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function load() {
  return await import("../app/app/open-shifts/actions");
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  currentUserMock.mockResolvedValue({
    id: "user-lena",
    email: "lena@example.com",
    name: "Lena",
    image: null,
  });
  currentMembershipMock.mockResolvedValue({
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "member",
  });
});

describe("claimShiftAction", () => {
  it("inserts an accepted assignment for the caller", async () => {
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      shiftId: "shift-1",
      userId: "user-lena",
      status: "accepted",
    });
    expect(state.auditCalls[0]?.action).toBe("shiftcraft.shift.claimed");
    expect(state.notifyCalls).toHaveLength(1);
  });

  it("refuses to claim a draft shift", async () => {
    state.shift!.status = "draft";
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
    expect(state.auditCalls).toHaveLength(0);
  });

  it("refuses to claim a shift that's already started", async () => {
    state.shift!.startsAt = new Date(Date.now() - 60_000);
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses when someone else already accepted", async () => {
    state.shift!.acceptedCount = 1;
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("ignores a missing shift id", async () => {
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "" }));
    expect(state.inserted).toHaveLength(0);
  });

  it("ignores an unauthenticated caller", async () => {
    currentUserMock.mockResolvedValueOnce(null);
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
  });

  it("ignores when there's no active workspace", async () => {
    currentMembershipMock.mockResolvedValueOnce(null);
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
  });

  it("notifies admins with the role + start time", async () => {
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.notifyCalls[0]?.input).toMatchObject({
      kind: "shiftcraft_shift_claimed",
      actionUrl: "/app/schedule",
    });
    expect(String(state.notifyCalls[0]?.input.body)).toContain("Butcher");
  });
});
