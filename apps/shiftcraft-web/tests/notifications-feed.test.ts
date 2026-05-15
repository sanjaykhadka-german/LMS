import { describe, it, expect, beforeEach, vi } from "vitest";

interface Row {
  id: string;
  tenantId: string;
  recipientUserId: string;
  kind: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const state = {
  rows: [] as Row[],
};

function reset() {
  state.rows = [];
}

function makeRow(p: Partial<Row> & { id: string }): Row {
  return {
    tenantId: "tenant-A",
    recipientUserId: "user-1",
    kind: "shiftcraft_employee_added",
    title: "Title",
    body: null,
    actionUrl: null,
    readAt: null,
    createdAt: new Date("2026-05-15T10:00:00Z"),
    ...p,
  };
}

// We model the limited subset of Drizzle that the helper uses. The
// where-arg shape mirrors the matcher style from the email-prefs test
// — flat `__filters` array merged via `and()`. Predicates supported:
// eq(col, val), inArray(col, vals), isNull(col).
type Predicate = (row: Row) => boolean;

vi.mock("drizzle-orm", () => ({
  eq: (col: { __field: keyof Row }, value: unknown) => ({
    __predicates: [(r: Row) => r[col.__field] === value],
  }),
  isNull: (col: { __field: keyof Row }) => ({
    __predicates: [(r: Row) => r[col.__field] == null],
  }),
  inArray: (col: { __field: keyof Row }, vals: unknown[]) => ({
    __predicates: [(r: Row) => vals.includes(r[col.__field])],
  }),
  and: (...args: Array<{ __predicates: Predicate[] }>) => ({
    __predicates: args.flatMap((a) => a.__predicates),
  }),
  desc: (col: { __field: keyof Row }) => ({ __orderBy: col.__field, __dir: "desc" as const }),
  sql: ((..._args: unknown[]) => ({ __sql: true })) as unknown as {
    <T>(): T;
  },
}));

vi.mock("@tracey/db", () => {
  function matchesAll(predicate: { __predicates: Predicate[] }, row: Row) {
    return predicate.__predicates.every((p) => p(row));
  }
  const notificationsCol = {
    id: { __field: "id" as const },
    tenantId: { __field: "tenantId" as const },
    recipientUserId: { __field: "recipientUserId" as const },
    kind: { __field: "kind" as const },
    title: { __field: "title" as const },
    body: { __field: "body" as const },
    actionUrl: { __field: "actionUrl" as const },
    readAt: { __field: "readAt" as const },
    createdAt: { __field: "createdAt" as const },
  };
  const db = {
    select: (cols?: Record<string, unknown>) => ({
      from: () => ({
        where: (whereArgs: { __predicates: Predicate[] }) => ({
          orderBy: (_ob: unknown) => ({
            limit: async (n: number) =>
              state.rows
                .filter((r) => matchesAll(whereArgs, r))
                .slice(0, n)
                .map((r) => projectCols(r, cols)),
          }),
          // Bare-await path used by getUnreadCount (a count(*) select).
          then(
            onF: (v: unknown[]) => unknown,
            onR?: (e: unknown) => unknown,
          ) {
            const matched = state.rows.filter((r) => matchesAll(whereArgs, r));
            // The helper looks at row.c for count.
            return Promise.resolve([{ c: matched.length }]).then(onF, onR);
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: (whereArgs: { __predicates: Predicate[] }) => ({
          returning: async () => {
            const matched = state.rows.filter((r) =>
              matchesAll(whereArgs, r),
            );
            for (const m of matched) Object.assign(m, patch);
            return matched.map((r) => ({ id: r.id }));
          },
        }),
      }),
    }),
  };
  return { db, notifications: notificationsCol };
});

function projectCols(row: Row, cols?: Record<string, unknown>) {
  if (!cols) return row;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(cols)) {
    out[key] = row[key as keyof Row];
  }
  return out;
}

async function load() {
  return await import("../lib/notifications-feed");
}

beforeEach(() => {
  reset();
});

describe("getUnreadCount", () => {
  it("counts unread rows for this (tenant, user)", async () => {
    state.rows = [
      makeRow({ id: "n-1", readAt: null }),
      makeRow({ id: "n-2", readAt: new Date("2026-05-15T11:00:00Z") }),
      makeRow({ id: "n-3", readAt: null }),
      // Different user.
      makeRow({ id: "n-4", recipientUserId: "user-2", readAt: null }),
      // Different tenant.
      makeRow({ id: "n-5", tenantId: "tenant-B", readAt: null }),
    ];
    const { getUnreadCount } = await load();
    expect(await getUnreadCount("tenant-A", "user-1")).toBe(2);
  });

  it("returns 0 when there are no rows at all", async () => {
    const { getUnreadCount } = await load();
    expect(await getUnreadCount("tenant-A", "user-1")).toBe(0);
  });
});

describe("getRecentNotifications", () => {
  it("returns up to `limit` rows for this (tenant, user) most-recent first", async () => {
    state.rows = [
      makeRow({ id: "n-1", createdAt: new Date("2026-05-15T09:00:00Z") }),
      makeRow({ id: "n-2", createdAt: new Date("2026-05-15T10:00:00Z") }),
      makeRow({ id: "n-3", createdAt: new Date("2026-05-15T11:00:00Z") }),
      makeRow({
        id: "n-other-tenant",
        tenantId: "tenant-B",
        createdAt: new Date("2026-05-15T12:00:00Z"),
      }),
    ];
    const { getRecentNotifications } = await load();
    const rows = await getRecentNotifications("tenant-A", "user-1", 50);
    expect(rows.map((r) => r.id).sort()).toEqual(["n-1", "n-2", "n-3"]);
  });
});

describe("markNotificationsRead", () => {
  it("only flips rows in the supplied id list for this (tenant, user)", async () => {
    state.rows = [
      makeRow({ id: "n-1", readAt: null }),
      makeRow({ id: "n-2", readAt: null }),
      makeRow({ id: "n-3", readAt: null }),
      // Different user — must NOT be touched even if id matches.
      makeRow({ id: "n-cross", recipientUserId: "user-2", readAt: null }),
    ];
    const { markNotificationsRead } = await load();
    const updated = await markNotificationsRead("tenant-A", "user-1", [
      "n-1",
      "n-2",
      "n-cross",
    ]);
    expect(updated).toBe(2);
    expect(state.rows.find((r) => r.id === "n-1")!.readAt).toBeInstanceOf(
      Date,
    );
    expect(state.rows.find((r) => r.id === "n-2")!.readAt).toBeInstanceOf(
      Date,
    );
    expect(state.rows.find((r) => r.id === "n-3")!.readAt).toBeNull();
    expect(state.rows.find((r) => r.id === "n-cross")!.readAt).toBeNull();
  });

  it("ignores an empty id list", async () => {
    const { markNotificationsRead } = await load();
    expect(await markNotificationsRead("tenant-A", "user-1", [])).toBe(0);
  });

  it("doesn't re-flip already-read rows", async () => {
    const earlier = new Date("2026-05-15T10:00:00Z");
    state.rows = [makeRow({ id: "n-1", readAt: earlier })];
    const { markNotificationsRead } = await load();
    const updated = await markNotificationsRead("tenant-A", "user-1", ["n-1"]);
    expect(updated).toBe(0);
    expect(state.rows[0]!.readAt).toBe(earlier);
  });
});

describe("markAllNotificationsRead", () => {
  it("flips every unread row for this (tenant, user)", async () => {
    state.rows = [
      makeRow({ id: "n-1", readAt: null }),
      makeRow({ id: "n-2", readAt: null }),
      makeRow({ id: "n-3", readAt: new Date("2026-05-15T08:00:00Z") }),
      makeRow({ id: "n-other", recipientUserId: "user-2", readAt: null }),
    ];
    const { markAllNotificationsRead } = await load();
    const updated = await markAllNotificationsRead("tenant-A", "user-1");
    expect(updated).toBe(2);
    expect(state.rows.find((r) => r.id === "n-other")!.readAt).toBeNull();
  });
});
