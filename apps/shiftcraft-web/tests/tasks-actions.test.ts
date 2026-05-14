import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<{ where: unknown; set: Record<string, unknown> }>,
  deleted: 0,
  lastTenantId: undefined as string | undefined,
};

function reset() {
  state.inserted = [];
  state.updated = [];
  state.deleted = 0;
  state.lastTenantId = undefined;
}

vi.mock("@tracey/db", () => ({
  scTasks: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    completedAt: { __field: "completedAt" },
    title: { __field: "title" },
  },
  auditEvents: { __table: "auditEvents" },
  db: {
    insert: () => ({
      // Audit writer goes through bare `db.insert(auditEvents).values(...)`.
      values: async () => [],
    }),
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      state.lastTenantId = tid;
      const tx = {
        // deleteTaskAction now reads the task title for the audit entry
        // before deleting. The actual row content doesn't matter for the
        // delete assertion — return an empty array so the optional chain
        // resolves to `undefined`.
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [],
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
            where: async (w: unknown) => {
              state.updated.push({ where: w, set: patch });
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const e = new Error(`NEXT_REDIRECT: ${url}`);
    throw e;
  }),
}));

async function load() {
  return await import("../app/app/tasks/actions");
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});

describe("createTaskAction", () => {
  it("inserts an open task with normal priority by default", async () => {
    const { createTaskAction } = await load();
    await expect(
      createTaskAction(
        { status: "idle" },
        fd({
          title: "Clean the slicer",
          description: "End of day",
          status: "open",
          priority: "normal",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      title: "Clean the slicer",
      description: "End of day",
      status: "open",
      priority: "normal",
      traceyTenantId: "tenant-A",
      createdByUserId: "user-1",
    });
    expect(state.inserted[0]!.completedAt).toBeNull();
  });

  it("stamps completedAt when a task is created already in done state", async () => {
    const { createTaskAction } = await load();
    await expect(
      createTaskAction(
        { status: "idle" },
        fd({
          title: "Already done",
          status: "done",
          priority: "normal",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.completedAt).toBeInstanceOf(Date);
  });

  it("rejects an empty title", async () => {
    const { createTaskAction } = await load();
    const r = await createTaskAction(
      { status: "idle" },
      fd({ title: "", status: "open", priority: "normal" }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.fieldErrors?.title).toBeTruthy();
    }
    expect(state.inserted).toHaveLength(0);
  });

  it("scopes the insert via forTenant(<tenantId>)", async () => {
    const { createTaskAction } = await load();
    await expect(
      createTaskAction(
        { status: "idle" },
        fd({ title: "T", status: "open", priority: "normal" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.lastTenantId).toBe("tenant-A");
  });
});

describe("moveTaskAction", () => {
  it("updates a row to the new status", async () => {
    const { moveTaskAction } = await load();
    await moveTaskAction(fd({ id: "t-1", status: "in_progress" }));
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0]!.set.status).toBe("in_progress");
    // completedAt is cleared when moving away from done.
    expect(state.updated[0]!.set.completedAt).toBeNull();
  });

  it("is a no-op when the target status is invalid", async () => {
    const { moveTaskAction } = await load();
    await moveTaskAction(fd({ id: "t-1", status: "garbage" }));
    expect(state.updated).toHaveLength(0);
  });

  it("ignores an empty id", async () => {
    const { moveTaskAction } = await load();
    await moveTaskAction(fd({ id: "", status: "done" }));
    expect(state.updated).toHaveLength(0);
  });
});

describe("deleteTaskAction", () => {
  it("removes the row scoped to the tenant", async () => {
    const { deleteTaskAction } = await load();
    await expect(deleteTaskAction(fd({ id: "t-1" }))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(state.deleted).toBe(1);
    expect(state.lastTenantId).toBe("tenant-A");
  });
});
