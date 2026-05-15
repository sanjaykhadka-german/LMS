import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  deleted: 0,
  lastTenantId: undefined as string | undefined,
  recipients: [
    { email: "admin@example.com", name: "Admin" },
    { email: "lena@example.com", name: "Lena" },
    { email: "tomas@example.com", name: "Tomas" },
  ] as Array<{ email: string; name: string | null }>,
  emailSends: [] as Array<{ email: string; name: string | null }>,
  auditCalls: [] as Array<Record<string, unknown>>,
};

const currentMembershipMock = vi.fn();

function reset() {
  state.inserted = [];
  state.updated = [];
  state.deleted = 0;
  state.lastTenantId = undefined;
  state.emailSends = [];
  state.auditCalls = [];
}

vi.mock("@tracey/db", () => ({
  scAnnouncements: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
  },
  members: { tenantId: { __field: "tenantId" }, userId: { __field: "userId" } },
  users: { id: { __field: "id" }, name: { __field: "name" }, email: { __field: "email" } },
  // Bare `db` used by createAnnouncementAction to fetch the recipient
  // list when the email checkbox is on. Returns state.recipients.
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => state.recipients,
        }),
      }),
    }),
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      state.lastTenantId = tid;
      const tx = {
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            const chain = {
              async returning() {
                state.inserted.push(v);
                return [{ id: `new-id-${state.inserted.length}` }];
              },
              then(
                onF: (val: Array<{ id: string }>) => unknown,
                onR?: (e: unknown) => unknown,
              ) {
                state.inserted.push(v);
                return Promise.resolve([
                  { id: `new-id-${state.inserted.length}` },
                ]).then(onF, onR);
              },
            };
            return chain;
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

vi.mock("~/lib/email", () => ({
  notifyAnnouncementPosted: vi.fn(
    async (opts: {
      recipients: Array<{ email: string; name: string | null }>;
    }) => {
      for (const r of opts.recipients) state.emailSends.push(r);
      return opts.recipients.length;
    },
  ),
}));

// Default: no opt-outs. Individual cases can override via vi.mocked()
// + mockResolvedValueOnce when we add coverage for the filter.
vi.mock("~/lib/email-prefs", () => ({
  getUnsubscribedUserIds: vi.fn(async () => new Set<string>()),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.auditCalls.push(input);
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

  it("fans the announcement out by email when 'notifyByEmail' is on, excluding the author", async () => {
    const { createAnnouncementAction } = await load();
    await expect(
      createAnnouncementAction(
        { status: "idle" },
        fd({
          title: "Roster change",
          body: "Saturday roster moved earlier — heads up.",
          pinned: "on",
          notifyByEmail: "on",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    // Inserted row + emailed_at update on the same row.
    expect(state.inserted).toHaveLength(1);
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0]!.emailedRecipientCount).toBe(2);
    expect(state.updated[0]!.emailedAt).toBeInstanceOf(Date);
    // Author (admin@example.com) excluded; only Lena + Tomas got mail.
    expect(state.emailSends.map((r) => r.email)).toEqual([
      "lena@example.com",
      "tomas@example.com",
    ]);
    // Two audit entries: announcement.created + announcement.emailed.
    expect(state.auditCalls.map((c) => c.action)).toEqual([
      "shiftcraft.announcement.created",
      "shiftcraft.announcement.emailed",
    ]);
  });

  it("skips email fan-out when the checkbox is off", async () => {
    const { createAnnouncementAction } = await load();
    await expect(
      createAnnouncementAction(
        { status: "idle" },
        fd({ title: "Hi", body: "Hello", pinned: "on" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted).toHaveLength(1);
    expect(state.updated).toHaveLength(0); // no emailed_at write
    expect(state.emailSends).toHaveLength(0);
    expect(state.auditCalls.map((c) => c.action)).toEqual([
      "shiftcraft.announcement.created",
    ]);
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
