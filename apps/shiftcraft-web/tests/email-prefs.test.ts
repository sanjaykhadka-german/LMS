import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  rows: [] as Array<{ traceyTenantId: string; appUserId: string; kind: string }>,
  inserts: 0,
  deletes: 0,
};

function reset() {
  state.rows = [];
  state.inserts = 0;
  state.deletes = 0;
}

vi.mock("@tracey/db", () => ({
  scEmailUnsubscribes: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    appUserId: { __field: "appUserId" },
    kind: { __field: "kind" },
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      // Tracks the call sequence so successive select() / insert() /
      // delete() see the right view of `state.rows`. The where() clauses
      // are opaque here, so we use the action's own narrowing in args.
      const tx = {
        select: (cols: Record<string, unknown>) => ({
          from: () => ({
            where: (whereArgs: unknown) => {
              // Best-effort: detect "filter by kind=X" by checking the
              // last argument tree the action built. The action only
              // ever inspects kind on the WHERE, so we can pull the
              // kind from the second-to-last arg in the row scan.
              return {
                async limit(_n: number) {
                  return matchAll(whereArgs, state.rows);
                },
                then(
                  onF: (val: unknown[]) => unknown,
                  onR?: (e: unknown) => unknown,
                ) {
                  // Treat unawaited `await tx.select().where()` as the
                  // full-list path — used by getUnsubscribedUserIds and
                  // getEmailPrefsForUser.
                  return Promise.resolve(
                    matchAll(whereArgs, state.rows).map((r) => {
                      // Match the shape requested by `cols`.
                      const out: Record<string, unknown> = {};
                      for (const k of Object.keys(cols)) {
                        out[k] = (r as Record<string, unknown>)[
                          mapColumn(k)
                        ];
                      }
                      return out;
                    }),
                  ).then(onF, onR);
                },
              };
            },
          }),
        }),
        insert: () => ({
          values: (v: { traceyTenantId: string; appUserId: string; kind: string }) => ({
            onConflictDoNothing: async () => {
              const exists = state.rows.some(
                (r) =>
                  r.traceyTenantId === v.traceyTenantId &&
                  r.appUserId === v.appUserId &&
                  r.kind === v.kind,
              );
              if (!exists) {
                state.rows.push(v);
                state.inserts += 1;
              }
              return [];
            },
          }),
        }),
        delete: () => ({
          where: async (whereArgs: unknown) => {
            const before = state.rows.length;
            state.rows = state.rows.filter(
              (r) => !matches(r, whereArgs),
            );
            state.deletes += before - state.rows.length;
            return [];
          },
        }),
      };
      return fn(tx);
    },
  }),
}));

// Crude where-arg matcher: scans the AND tree for { __field, value }
// markers we recorded in the column proxies, defaulting to "match all"
// when we can't recognise a clause. Good enough for the test surface
// since the action only filters on (tenant, user?, kind?).
type Row = { traceyTenantId: string; appUserId: string; kind: string };

function matchAll(whereArgs: unknown, rows: Row[]): Row[] {
  return rows.filter((r) => matches(r, whereArgs));
}

function matches(row: Row, whereArgs: unknown): boolean {
  if (!whereArgs || typeof whereArgs !== "object") return true;
  const w = whereArgs as Record<string, unknown> & {
    __filters?: Array<{ field: keyof Row; value: string }>;
  };
  const filters = w.__filters;
  if (!filters) return true;
  return filters.every((f) => row[f.field] === f.value);
}

vi.mock("drizzle-orm", () => {
  return {
    eq: (col: { __field: string }, value: string) => ({
      __filters: [{ field: col.__field, value }],
    }),
    and: (...args: Array<{ __filters: Array<{ field: string; value: string }> }>) => ({
      __filters: args.flatMap((a) => a.__filters),
    }),
    inArray: (col: { __field: string }, _values: string[]) => ({
      // Match-all: getEmailPrefsForUser's inArray is across the known
      // kinds, which is already filtered by tenant + user.
      __filters: [],
      __isInArray: col.__field,
    }),
  };
});

function mapColumn(label: string): keyof Row {
  if (label === "kind") return "kind";
  if (label === "appUserId") return "appUserId";
  if (label === "id") return "appUserId"; // good-enough id surrogate
  return "kind";
}

async function load() {
  return await import("../lib/email-prefs");
}

beforeEach(() => {
  reset();
});

describe("setEmailPref / getEmailPrefsForUser", () => {
  it("defaults to all-on when no rows exist", async () => {
    const { getEmailPrefsForUser, EMAIL_KINDS } = await load();
    const prefs = await getEmailPrefsForUser("tenant-A", "user-1");
    for (const k of EMAIL_KINDS) expect(prefs[k]).toBe(true);
  });

  it("setEmailPref(false) inserts an unsubscribe row", async () => {
    const { setEmailPref, getEmailPrefsForUser } = await load();
    await setEmailPref("tenant-A", "user-1", "announcements", false);
    expect(state.inserts).toBe(1);
    const prefs = await getEmailPrefsForUser("tenant-A", "user-1");
    expect(prefs.announcements).toBe(false);
    expect(prefs.offers).toBe(true);
  });

  it("setEmailPref(true) removes the row (re-subscribes)", async () => {
    const { setEmailPref, getEmailPrefsForUser } = await load();
    await setEmailPref("tenant-A", "user-1", "announcements", false);
    expect(state.inserts).toBe(1);
    await setEmailPref("tenant-A", "user-1", "announcements", true);
    expect(state.deletes).toBe(1);
    const prefs = await getEmailPrefsForUser("tenant-A", "user-1");
    expect(prefs.announcements).toBe(true);
  });

  it("setEmailPref(false) twice is idempotent (no duplicate row)", async () => {
    const { setEmailPref } = await load();
    await setEmailPref("tenant-A", "user-1", "announcements", false);
    await setEmailPref("tenant-A", "user-1", "announcements", false);
    expect(state.inserts).toBe(1);
    expect(state.rows.length).toBe(1);
  });
});

describe("getUnsubscribedUserIds", () => {
  it("returns the set of users opted out for that kind in that tenant", async () => {
    state.rows = [
      { traceyTenantId: "tenant-A", appUserId: "u-1", kind: "announcements" },
      { traceyTenantId: "tenant-A", appUserId: "u-2", kind: "announcements" },
      { traceyTenantId: "tenant-A", appUserId: "u-3", kind: "offers" },
      { traceyTenantId: "tenant-B", appUserId: "u-1", kind: "announcements" },
    ];
    const { getUnsubscribedUserIds } = await load();
    const ids = await getUnsubscribedUserIds("tenant-A", "announcements");
    expect(ids.has("u-1")).toBe(true);
    expect(ids.has("u-2")).toBe(true);
    // u-3 is opted out of a different kind.
    expect(ids.has("u-3")).toBe(false);
  });
});
