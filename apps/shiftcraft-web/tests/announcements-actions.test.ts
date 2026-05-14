import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  deleted: 0,
  lastTenantId: undefined as string | undefined,
};

const currentMembershipMock = vi.fn();

function reset() {
  state.inserted = [];
  state.updated = [];
  state.deleted = 0;
  state.lastTenantId = undefined;
}

vi.mock("@tracey/db", () => ({
  scAnnouncements: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      state.lastTenantId = tid;
      const tx = {
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
}));

async function load() {
  return await import("../app/app/announcements/actions");
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

describe("createAnnouncementAction", () => {
  it("inserts a pinned announcement", async () => {
    const { createAnnouncementAction } = await load();
    await expect(
      createAnnouncementAction(
        { status: "idle" },
        fd({
          title: "Public holiday rosters",
          body: "Updated rosters posted. Check My shifts.",
          pinned: "on",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      title: "Public holiday rosters",
      pinned: true,
      createdByUserId: "user-1",
      traceyTenantId: "tenant-A",
    });
  });

  it("defaults pinned=false when the checkbox is not present", async () => {
    const { createAnnouncementAction } = await load();
    await expect(
      createAnnouncementAction(
        { status: "idle" },
        fd({ title: "Quiet note", body: "Heads up" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted[0]!.pinned).toBe(false);
  });

  it("requires a non-empty title and body", async () => {
    const { createAnnouncementAction } = await load();
    const r = await createAnnouncementAction(
      { status: "idle" },
      fd({ title: "", body: "" }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.fieldErrors?.title).toBeTruthy();
      expect(r.fieldErrors?.body).toBeTruthy();
    }
    expect(state.inserted).toHaveLength(0);
  });

  it("blocks non-admin members from posting", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { createAnnouncementAction } = await load();
    const r = await createAnnouncementAction(
      { status: "idle" },
      fd({ title: "Hi", body: "Hello" }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.message).toMatch(/admin/i);
    }
    expect(state.inserted).toHaveLength(0);
  });
});

describe("togglePinnedAction", () => {
  it("flips the pinned flag on the row", async () => {
    const { togglePinnedAction } = await load();
    await togglePinnedAction(fd({ id: "a-1", pinned: "false" }));
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0]!.pinned).toBe(false);
  });

  it("is a no-op without admin role", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { togglePinnedAction } = await load();
    await togglePinnedAction(fd({ id: "a-1", pinned: "true" }));
    expect(state.updated).toHaveLength(0);
  });
});

describe("deleteAnnouncementAction", () => {
  it("removes a row", async () => {
    const { deleteAnnouncementAction } = await load();
    await deleteAnnouncementAction(fd({ id: "a-1" }));
    expect(state.deleted).toBe(1);
  });

  it("is a no-op without admin role", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { deleteAnnouncementAction } = await load();
    await deleteAnnouncementAction(fd({ id: "a-1" }));
    expect(state.deleted).toBe(0);
  });
});
