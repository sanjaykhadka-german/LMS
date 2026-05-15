import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  sourceShifts: [] as Array<{
    id: string;
    locationId: string;
    role: string;
    startsAt: Date;
    endsAt: Date;
    notes: string | null;
  }>,
  destShifts: [] as Array<{
    locationId: string;
    role: string;
    startsAt: Date;
  }>,
  inserted: [] as Array<unknown>,
  auditCalls: [] as Array<Record<string, unknown>>,
  // duplicateWeekAction makes two forTenant().run() calls in sequence:
  // first the source-week pull, then the destination-week pull. The
  // mock has to thread the count *across* run() invocations, so we
  // track it on the module-scope state object.
  selectIdx: 0,
};

const currentMembershipMock = vi.fn();

function reset() {
  state.sourceShifts = [];
  state.destShifts = [];
  state.inserted = [];
  state.auditCalls = [];
  state.selectIdx = 0;
}

vi.mock("@tracey/db", () => {
  const SOURCE = Symbol("source-select");
  const DEST = Symbol("dest-select");
  return {
    scShifts: {
      id: { __field: "id" },
      traceyTenantId: { __field: "traceyTenantId" },
      locationId: { __field: "locationId" },
      role: { __field: "role" },
      startsAt: { __field: "startsAt" },
    },
    scShiftAssignments: {},
    scLocations: {},
    users: {},
    db: { /* unused on this code path */ },
    forTenant: (tid: string) => ({
      tenantId: tid,
      async run(fn: (tx: unknown) => Promise<unknown>) {
        // Tag the next select by `state.selectIdx`, which threads
        // across multiple run() calls within one action — see the
        // module-scope comment.
        const tx = {
          select: () => {
            const which = state.selectIdx === 0 ? SOURCE : DEST;
            state.selectIdx += 1;
            return {
              from: () => ({
                where: async () =>
                  which === SOURCE ? state.sourceShifts : state.destShifts,
              }),
            };
          },
          insert: () => ({
            values: async (rows: unknown) => {
              if (Array.isArray(rows)) {
                state.inserted.push(...rows);
              } else {
                state.inserted.push(rows);
              }
              return [];
            },
          }),
        };
        return fn(tx);
      },
    }),
  };
});

vi.mock("~/lib/auth/current", () => ({
  currentMembership: () => currentMembershipMock(),
  currentUser: vi.fn(async () => ({
    id: "user-admin",
    email: "admin@example.com",
    name: "Admin",
    image: null,
  })),
  requireUser: vi.fn(),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.auditCalls.push(input);
  }),
}));

vi.mock("~/lib/email", () => ({ notifyShiftOffered: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
}));

async function load() {
  return await import("../app/app/schedule/actions");
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

const MON_2026_05_11 = "2026-05-11T00:00:00.000Z";

describe("duplicateWeekAction", () => {
  it("copies each source shift forward by 7 days as a draft", async () => {
    state.sourceShifts = [
      {
        id: "shift-1",
        locationId: "loc-1",
        role: "Butcher",
        startsAt: new Date("2026-05-11T08:00:00.000Z"),
        endsAt: new Date("2026-05-11T16:00:00.000Z"),
        notes: "End-of-day clean",
      },
      {
        id: "shift-2",
        locationId: "loc-1",
        role: "Counter",
        startsAt: new Date("2026-05-12T10:00:00.000Z"),
        endsAt: new Date("2026-05-12T18:00:00.000Z"),
        notes: null,
      },
    ];
    const { duplicateWeekAction } = await load();
    await expect(
      duplicateWeekAction(fd({ weekStart: MON_2026_05_11 })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted).toHaveLength(2);
    const first = state.inserted[0] as Record<string, unknown>;
    expect(first).toMatchObject({
      locationId: "loc-1",
      role: "Butcher",
      status: "draft",
      notes: "End-of-day clean",
      createdByUserId: "user-admin",
    });
    expect((first.startsAt as Date).toISOString()).toBe(
      "2026-05-18T08:00:00.000Z",
    );
    expect((first.endsAt as Date).toISOString()).toBe(
      "2026-05-18T16:00:00.000Z",
    );
  });

  it("skips a source shift when an identical (location, role, time) exists next week", async () => {
    state.sourceShifts = [
      {
        id: "shift-1",
        locationId: "loc-1",
        role: "Butcher",
        startsAt: new Date("2026-05-11T08:00:00.000Z"),
        endsAt: new Date("2026-05-11T16:00:00.000Z"),
        notes: null,
      },
    ];
    state.destShifts = [
      {
        locationId: "loc-1",
        role: "Butcher",
        startsAt: new Date("2026-05-18T08:00:00.000Z"),
      },
    ];
    const { duplicateWeekAction } = await load();
    await expect(
      duplicateWeekAction(fd({ weekStart: MON_2026_05_11 })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted).toHaveLength(0);
    expect(state.auditCalls[0]?.details).toMatchObject({
      copied: 0,
      skipped: 1,
    });
  });

  it("only de-dupes on exact match — different time/role/location is treated as new", async () => {
    state.sourceShifts = [
      {
        id: "shift-1",
        locationId: "loc-1",
        role: "Butcher",
        startsAt: new Date("2026-05-11T08:00:00.000Z"),
        endsAt: new Date("2026-05-11T16:00:00.000Z"),
        notes: null,
      },
    ];
    state.destShifts = [
      // Same role + time but different location.
      {
        locationId: "loc-2",
        role: "Butcher",
        startsAt: new Date("2026-05-18T08:00:00.000Z"),
      },
      // Same location + time but different role.
      {
        locationId: "loc-1",
        role: "Counter",
        startsAt: new Date("2026-05-18T08:00:00.000Z"),
      },
    ];
    const { duplicateWeekAction } = await load();
    await expect(
      duplicateWeekAction(fd({ weekStart: MON_2026_05_11 })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted).toHaveLength(1);
  });

  it("refuses non-admins", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    state.sourceShifts = [
      {
        id: "shift-1",
        locationId: "loc-1",
        role: "Butcher",
        startsAt: new Date("2026-05-11T08:00:00.000Z"),
        endsAt: new Date("2026-05-11T16:00:00.000Z"),
        notes: null,
      },
    ];
    const { duplicateWeekAction } = await load();
    await expect(
      duplicateWeekAction(fd({ weekStart: MON_2026_05_11 })),
    ).rejects.toThrow(/admin/i);
    expect(state.inserted).toHaveLength(0);
  });

  it("logs an audit entry with copied + skipped counts", async () => {
    state.sourceShifts = [
      {
        id: "shift-1",
        locationId: "loc-1",
        role: "Butcher",
        startsAt: new Date("2026-05-11T08:00:00.000Z"),
        endsAt: new Date("2026-05-11T16:00:00.000Z"),
        notes: null,
      },
      {
        id: "shift-2",
        locationId: "loc-1",
        role: "Counter",
        startsAt: new Date("2026-05-12T10:00:00.000Z"),
        endsAt: new Date("2026-05-12T18:00:00.000Z"),
        notes: null,
      },
    ];
    state.destShifts = [
      {
        locationId: "loc-1",
        role: "Butcher",
        startsAt: new Date("2026-05-18T08:00:00.000Z"),
      },
    ];
    const { duplicateWeekAction } = await load();
    await expect(
      duplicateWeekAction(fd({ weekStart: MON_2026_05_11 })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.auditCalls[0]).toMatchObject({
      action: "shiftcraft.schedule.week_duplicated",
      details: { copied: 1, skipped: 1 },
    });
  });

  it("does no work when there's nothing in the source week", async () => {
    state.sourceShifts = [];
    const { duplicateWeekAction } = await load();
    await expect(
      duplicateWeekAction(fd({ weekStart: MON_2026_05_11 })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted).toHaveLength(0);
    expect(state.auditCalls[0]?.details).toMatchObject({
      copied: 0,
      skipped: 0,
    });
  });

  it("ignores an empty weekStart", async () => {
    const { duplicateWeekAction } = await load();
    await duplicateWeekAction(fd({ weekStart: "" }));
    expect(state.inserted).toHaveLength(0);
    expect(state.auditCalls).toHaveLength(0);
  });
});
