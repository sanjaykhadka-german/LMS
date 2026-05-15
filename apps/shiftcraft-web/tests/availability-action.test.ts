import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  // The mock UPDATE returns whatever's in `existingMatch`. Empty array
  // models the "no sc_employees row for this user" case.
  existingMatch: [] as Array<{ id: string }>,
  patches: [] as Record<string, unknown>[],
  auditCalls: [] as Record<string, unknown>[],
};

const currentUserMock = vi.fn();
const currentMembershipMock = vi.fn();

function reset() {
  state.existingMatch = [{ id: "emp-1" }];
  state.patches = [];
  state.auditCalls = [];
}

vi.mock("@tracey/db", () => ({
  scEmployees: {
    id: { __field: "id" },
    appUserId: { __field: "appUserId" },
    traceyTenantId: { __field: "traceyTenantId" },
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      const tx = {
        update: () => ({
          set: (patch: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => {
                state.patches.push(patch);
                return state.existingMatch;
              },
            }),
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function load() {
  return await import("../app/app/availability/actions");
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

describe("updateMyAvailabilityAction", () => {
  it("saves the 7-day grid as a jsonb object keyed by short weekday", async () => {
    const { updateMyAvailabilityAction } = await load();
    const r = await updateMyAvailabilityAction(
      { status: "idle" },
      fd({
        availability_mon: "9-5",
        availability_tue: "9-5",
        availability_wed: "  ", // whitespace-only → dropped
        availability_thu: "evenings",
        availability_fri: "",
        availability_sat: "all day",
        availability_sun: "",
      }),
    );
    expect(r.status).toBe("ok");
    expect(state.patches).toHaveLength(1);
    expect(state.patches[0]!.availability).toEqual({
      mon: "9-5",
      tue: "9-5",
      thu: "evenings",
      sat: "all day",
    });
    expect(state.auditCalls[0]?.action).toBe(
      "shiftcraft.availability.updated",
    );
  });

  it("stores null when every day is empty (unspecified)", async () => {
    const { updateMyAvailabilityAction } = await load();
    const r = await updateMyAvailabilityAction({ status: "idle" }, fd({}));
    expect(r.status).toBe("ok");
    expect(state.patches[0]!.availability).toBeNull();
  });

  it("truncates per-day values to 80 chars", async () => {
    const { updateMyAvailabilityAction } = await load();
    const long = "x".repeat(120);
    await updateMyAvailabilityAction(
      { status: "idle" },
      fd({ availability_mon: long }),
    );
    const saved = state.patches[0]!.availability as Record<string, string>;
    expect(saved.mon).toBeDefined();
    expect(saved.mon!.length).toBe(80);
  });

  it("returns an error if the caller has no sc_employees row", async () => {
    state.existingMatch = [];
    const { updateMyAvailabilityAction } = await load();
    const r = await updateMyAvailabilityAction(
      { status: "idle" },
      fd({ availability_mon: "9-5" }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.message).toMatch(/not on the shiftcraft roster|ask a manager/i);
    }
    // The UPDATE still ran (returning came back empty); audit should NOT fire.
    expect(state.auditCalls).toHaveLength(0);
  });

  it("refuses when not signed in", async () => {
    currentUserMock.mockResolvedValueOnce(null);
    const { updateMyAvailabilityAction } = await load();
    const r = await updateMyAvailabilityAction(
      { status: "idle" },
      fd({ availability_mon: "9-5" }),
    );
    expect(r.status).toBe("error");
    expect(state.patches).toHaveLength(0);
  });

  it("refuses when there's no active workspace", async () => {
    currentMembershipMock.mockResolvedValueOnce(null);
    const { updateMyAvailabilityAction } = await load();
    const r = await updateMyAvailabilityAction(
      { status: "idle" },
      fd({ availability_mon: "9-5" }),
    );
    expect(r.status).toBe("error");
    expect(state.patches).toHaveLength(0);
  });
});
