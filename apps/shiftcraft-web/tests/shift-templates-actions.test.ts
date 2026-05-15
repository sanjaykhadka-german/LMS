import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  existingByName: [] as Array<{ id: string; name: string; traceyTenantId: string }>,
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  deletes: 0,
  auditCalls: [] as Record<string, unknown>[],
};

const currentMembershipMock = vi.fn();

function reset() {
  state.existingByName = [];
  state.inserts = [];
  state.updates = [];
  state.deletes = 0;
  state.auditCalls = [];
}

vi.mock("@tracey/db", () => ({
  scShiftTemplates: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    name: { __field: "name" },
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () =>
                state.existingByName
                  .filter((r) => r.traceyTenantId === tid)
                  .slice(0, 1),
            }),
          }),
        }),
        insert: () => ({
          values: async (v: Record<string, unknown>) => {
            state.inserts.push(v);
            return [];
          },
        }),
        update: () => ({
          set: (patch: Record<string, unknown>) => ({
            where: async () => {
              state.updates.push(patch);
              return [];
            },
          }),
        }),
        delete: () => ({
          where: async () => {
            state.deletes += 1;
            return [];
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
  return await import("../app/app/shift-templates/actions");
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

const validLocation = "11111111-1111-1111-1111-111111111111";

describe("createShiftTemplateAction", () => {
  it("parses HH:MM into hour + minute, snapping minutes to the 15-min grid", async () => {
    const { createShiftTemplateAction } = await load();
    await expect(
      createShiftTemplateAction(
        { status: "idle" },
        fd({
          name: "Sat morning butcher",
          locationId: validLocation,
          role: "Butcher",
          startsAt: "07:00",
          endsAt: "15:30",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      name: "Sat morning butcher",
      locationId: validLocation,
      role: "Butcher",
      startHour: 7,
      startMinute: 0,
      endHour: 15,
      endMinute: 30,
    });
    expect(state.auditCalls[0]?.action).toBe(
      "shiftcraft.shift_template.created",
    );
  });

  it("snaps a 9:32 minute to 30 (closest grid step)", async () => {
    const { createShiftTemplateAction } = await load();
    await expect(
      createShiftTemplateAction(
        { status: "idle" },
        fd({
          name: "Casual",
          locationId: validLocation,
          role: "Counter",
          startsAt: "09:32",
          endsAt: "17:00",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserts[0]!.startMinute).toBe(30);
  });

  it("rejects duplicate names (case-insensitive)", async () => {
    state.existingByName = [
      { id: "x", name: "Sat morning butcher", traceyTenantId: "tenant-A" },
    ];
    const { createShiftTemplateAction } = await load();
    const r = await createShiftTemplateAction(
      { status: "idle" },
      fd({
        name: "SAT MORNING BUTCHER",
        locationId: validLocation,
        role: "Butcher",
        startsAt: "07:00",
        endsAt: "15:00",
      }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.fieldErrors?.name?.[0]).toMatch(/already exists/i);
    }
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects equal start + end", async () => {
    const { createShiftTemplateAction } = await load();
    const r = await createShiftTemplateAction(
      { status: "idle" },
      fd({
        name: "Zero",
        locationId: validLocation,
        role: "Counter",
        startsAt: "10:00",
        endsAt: "10:00",
      }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.fieldErrors?.endsAt?.[0]).toMatch(/can't be the same/i);
    }
    expect(state.inserts).toHaveLength(0);
  });

  it("requires a non-empty name", async () => {
    const { createShiftTemplateAction } = await load();
    const r = await createShiftTemplateAction(
      { status: "idle" },
      fd({
        name: "",
        locationId: validLocation,
        role: "Butcher",
        startsAt: "07:00",
        endsAt: "15:00",
      }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.fieldErrors?.name).toBeTruthy();
    expect(state.inserts).toHaveLength(0);
  });

  it("refuses non-managers", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { createShiftTemplateAction } = await load();
    const r = await createShiftTemplateAction(
      { status: "idle" },
      fd({
        name: "Sat morning butcher",
        locationId: validLocation,
        role: "Butcher",
        startsAt: "07:00",
        endsAt: "15:00",
      }),
    );
    expect(r.status).toBe("error");
    expect(state.inserts).toHaveLength(0);
  });
});

describe("updateShiftTemplateAction", () => {
  it("writes patched values + audit", async () => {
    const { updateShiftTemplateAction } = await load();
    const r = await updateShiftTemplateAction(
      "tpl-1",
      { status: "idle" },
      fd({
        name: "Sat morning butcher",
        locationId: validLocation,
        role: "Butcher",
        startsAt: "07:15",
        endsAt: "15:45",
        defaultNotes: "Whole-animal break.",
      }),
    );
    expect(r.status).toBe("ok");
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({
      name: "Sat morning butcher",
      role: "Butcher",
      startHour: 7,
      startMinute: 15,
      endHour: 15,
      endMinute: 45,
      defaultNotes: "Whole-animal break.",
    });
    expect(state.auditCalls[0]?.action).toBe(
      "shiftcraft.shift_template.updated",
    );
  });
});

describe("deleteShiftTemplateAction", () => {
  it("removes the row + audits", async () => {
    const { deleteShiftTemplateAction } = await load();
    await expect(
      deleteShiftTemplateAction(fd({ id: "tpl-1" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.deletes).toBe(1);
    expect(state.auditCalls[0]?.action).toBe(
      "shiftcraft.shift_template.deleted",
    );
  });

  it("is a no-op for a non-manager", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { deleteShiftTemplateAction } = await load();
    await deleteShiftTemplateAction(fd({ id: "tpl-1" }));
    expect(state.deletes).toBe(0);
  });
});
