import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  existingDepartments: [] as Array<{ id: string; name: string; traceyTenantId: string }>,
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  deleted: 0,
  lastTenantId: undefined as string | undefined,
  auditCalls: [] as Array<Record<string, unknown>>,
};

const currentMembershipMock = vi.fn();

function reset() {
  state.existingDepartments = [];
  state.inserted = [];
  state.updated = [];
  state.deleted = 0;
  state.lastTenantId = undefined;
  state.auditCalls = [];
}

vi.mock("@tracey/db", () => ({
  scDepartments: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    name: { __field: "name" },
  },
  scEmployees: {
    id: { __field: "id" },
    departmentId: { __field: "departmentId" },
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      state.lastTenantId = tid;
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () =>
                state.existingDepartments
                  .filter((r) => r.traceyTenantId === tid)
                  .slice(0, 1),
            }),
          }),
        }),
        insert: () => ({
          values: async (v: Record<string, unknown>) => {
            state.inserted.push(v);
            return [{ id: "new-id" }];
          },
        }),
        update: () => ({
          set: (patch: Record<string, unknown>) => ({
            where: async () => {
              state.updated.push(patch);
              return [{ id: "updated" }];
            },
          }),
        }),
        delete: () => ({
          where: async () => {
            state.deleted += 1;
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

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.auditCalls.push(input);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
}));

async function load() {
  return await import("../app/app/departments/actions");
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

describe("createDepartmentAction", () => {
  it("inserts a department + logs audit event", async () => {
    const { createDepartmentAction } = await load();
    await expect(
      createDepartmentAction(
        { status: "idle" },
        fd({ name: "Butchery", description: "Whole-animal team" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      traceyTenantId: "tenant-A",
      name: "Butchery",
      description: "Whole-animal team",
    });
    expect(state.auditCalls[0]).toMatchObject({
      action: "shiftcraft.department.created",
    });
  });

  it("rejects a duplicate name (case-insensitive)", async () => {
    state.existingDepartments = [
      { id: "x", name: "Butchery", traceyTenantId: "tenant-A" },
    ];
    const { createDepartmentAction } = await load();
    const r = await createDepartmentAction(
      { status: "idle" },
      fd({ name: "butchery" }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.fieldErrors?.name?.[0]).toMatch(/already exists/i);
    }
    expect(state.inserted).toHaveLength(0);
  });

  it("rejects an empty name", async () => {
    const { createDepartmentAction } = await load();
    const r = await createDepartmentAction(
      { status: "idle" },
      fd({ name: "" }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.fieldErrors?.name).toBeTruthy();
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses non-managers", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { createDepartmentAction } = await load();
    const r = await createDepartmentAction(
      { status: "idle" },
      fd({ name: "Butchery" }),
    );
    expect(r.status).toBe("error");
    expect(state.inserted).toHaveLength(0);
  });
});

describe("updateDepartmentAction", () => {
  it("updates name + description", async () => {
    const { updateDepartmentAction } = await load();
    const r = await updateDepartmentAction(
      "dept-1",
      { status: "idle" },
      fd({ name: "Butchery Floor", description: "Updated team" }),
    );
    expect(r.status).toBe("ok");
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0]).toMatchObject({
      name: "Butchery Floor",
      description: "Updated team",
    });
    expect(state.auditCalls[0]?.action).toBe("shiftcraft.department.updated");
  });
});

describe("deleteDepartmentAction", () => {
  it("deletes the row + logs audit event", async () => {
    const { deleteDepartmentAction } = await load();
    await expect(
      deleteDepartmentAction(fd({ id: "dept-1" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.deleted).toBe(1);
    expect(state.auditCalls[0]?.action).toBe("shiftcraft.department.deleted");
  });

  it("is a no-op for a non-manager", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { deleteDepartmentAction } = await load();
    await deleteDepartmentAction(fd({ id: "dept-1" }));
    expect(state.deleted).toBe(0);
    expect(state.auditCalls).toHaveLength(0);
  });

  it("is a no-op on empty id", async () => {
    const { deleteDepartmentAction } = await load();
    await deleteDepartmentAction(fd({ id: "" }));
    expect(state.deleted).toBe(0);
  });
});
