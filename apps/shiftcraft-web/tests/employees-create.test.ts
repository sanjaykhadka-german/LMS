import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// The action under test touches the real DB via @tracey/db and the real
// session via ~/lib/auth/current. We replace both with controllable doubles
// so we can assert the action's branching (Zod validation, the email-dedup
// precheck, the conditional notification fan-out) without standing up a
// Postgres or Auth.js harness.

const state = {
  existingEmployees: [] as Array<{ id: string; email: string | null; traceyTenantId: string }>,
  inserted: [] as Array<Record<string, unknown>>,
  lastTenantIdForTenant: undefined as string | undefined,
  notifyCalls: [] as Array<{
    tenantId: string;
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }>,
};

function resetState() {
  state.existingEmployees = [];
  state.inserted = [];
  state.lastTenantIdForTenant = undefined;
  state.notifyCalls = [];
}

vi.mock("@tracey/db", () => {
  const scEmployees = {
    traceyTenantId: { __field: "traceyTenantId" },
    email: { __field: "email" },
    id: { __field: "id" },
  };
  return {
    scEmployees,
    forTenant: (tenantId: string) => ({
      tenantId,
      async run(fn: (tx: unknown) => Promise<unknown>) {
        state.lastTenantIdForTenant = tenantId;
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: async () =>
                  state.existingEmployees
                    .filter((r) => r.traceyTenantId === tenantId)
                    .slice(0, 1),
              }),
            }),
          }),
          insert: () => ({
            values: async (values: Record<string, unknown>) => {
              state.inserted.push(values);
              return [{ id: `inserted-${state.inserted.length}` }];
            },
          }),
        };
        return fn(tx);
      },
    }),
  };
});

vi.mock("~/lib/auth/current", () => ({
  currentMembership: vi.fn(async () => ({
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "admin",
  })),
  currentUser: vi.fn(async () => ({
    id: "user-1",
    email: "admin@example.com",
    name: "Admin",
    image: null,
  })),
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
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    // Mirror Next.js's behaviour: redirect throws so callers can't fall through.
    const e = new Error(`NEXT_REDIRECT: ${url}`);
    (e as Error & { __redirect?: string }).__redirect = url;
    throw e;
  }),
}));

// Lazy import so the mocks above are set up first.
async function load() {
  return await import("../app/app/employees/new/actions");
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  resetState();
  vi.clearAllMocks();
});

describe("createEmployeeAction", () => {
  it("inserts a permanent employee and notifies admins when email is provided", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "jane@example.com",
          mobile: "0400 000 000",
          department: "Butchery",
          employmentType: "permanent",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      fullName: "Jane Doe",
      email: "jane@example.com",
      mobile: "0400 000 000",
      department: "Butchery",
      employmentType: "permanent",
      traceyTenantId: "tenant-A",
      createdByUserId: "user-1",
    });
    expect(state.notifyCalls).toHaveLength(1);
    expect(state.notifyCalls[0]).toMatchObject({
      tenantId: "tenant-A",
      input: {
        kind: "shiftcraft_employee_added",
        actionUrl: "/app/admin/employees",
      },
      options: { excludeUserId: "user-1" },
    });
  });

  it("rejects a duplicate email within the same tenant via the precheck", async () => {
    state.existingEmployees = [
      { id: "x", email: "jane@example.com", traceyTenantId: "tenant-A" },
    ];
    const { createEmployeeAction } = await load();
    const result = await createEmployeeAction(
      { status: "idle" },
      fd({
        fullName: "Jane Doe",
        email: "jane@example.com",
        employmentType: "permanent",
      }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.email?.[0]).toMatch(/already exists/i);
    }
    expect(state.inserted).toHaveLength(0);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("accepts a labour-hire row with no email and skips the LMS suggestion", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Contractor A",
          email: "",
          mobile: "0400 111 222",
          employmentType: "labour_hire",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      fullName: "Contractor A",
      email: null,
      employmentType: "labour_hire",
    });
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("does not fire the LMS suggestion when email is set but type is labour_hire", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Contractor B",
          email: "contractor@example.com",
          employmentType: "labour_hire",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.inserted).toHaveLength(1);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("passes the caller's tenant id to forTenant so per-tenant isolation kicks in", async () => {
    // Sanity check that the action does not run unscoped against the shared
    // pool — the search_path setting inside forTenant() is the mechanism that
    // routes the query to tenant_<uuid>.sc_employees rather than public.
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "scoped@example.com",
          employmentType: "casual",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.lastTenantIdForTenant).toBe("tenant-A");
  });

  it("returns a field error for an invalid email format", async () => {
    const { createEmployeeAction } = await load();
    const result = await createEmployeeAction(
      { status: "idle" },
      fd({
        fullName: "Jane Doe",
        email: "not-an-email",
        employmentType: "permanent",
      }),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.email).toBeTruthy();
    }
    expect(state.inserted).toHaveLength(0);
  });
});
