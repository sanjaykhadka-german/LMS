import { describe, it, expect, beforeEach, vi } from "vitest";

interface Row {
  id: string;
  shiftId: string;
  authorUserId: string | null;
  body: string;
  traceyTenantId: string;
}

const SHIFT_ID = "11111111-1111-1111-1111-111111111111";

const state = {
  rows: [] as Row[],
  inserts: [] as Record<string, unknown>[],
  deletes: 0,
  auditCalls: [] as Record<string, unknown>[],
};

const currentUserMock = vi.fn();
const currentMembershipMock = vi.fn();

function reset() {
  state.rows = [];
  state.inserts = [];
  state.deletes = 0;
  state.auditCalls = [];
}

vi.mock("@tracey/db", () => ({
  scShiftComments: {
    id: { __field: "id" },
    shiftId: { __field: "shiftId" },
    authorUserId: { __field: "authorUserId" },
    body: { __field: "body" },
    traceyTenantId: { __field: "traceyTenantId" },
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => state.rows.slice(0, 1),
            }),
          }),
        }),
        insert: () => ({
          values: async (v: Record<string, unknown>) => {
            state.inserts.push(v);
            return [];
          },
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
  return await import("../app/app/schedule/comment-actions");
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

describe("postShiftCommentAction", () => {
  it("inserts a comment with the caller as author + audits", async () => {
    const { postShiftCommentAction } = await load();
    const r = await postShiftCommentAction(
      { status: "idle" },
      fd({ shiftId: SHIFT_ID, body: "Saturday is busy, plan for cover." }),
    );
    expect(r.status).toBe("ok");
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      traceyTenantId: "tenant-A",
      shiftId: SHIFT_ID,
      authorUserId: "user-lena",
      body: "Saturday is busy, plan for cover.",
    });
    expect(state.auditCalls[0]?.action).toBe(
      "shiftcraft.shift_comment.posted",
    );
  });

  it("rejects an empty body", async () => {
    const { postShiftCommentAction } = await load();
    const r = await postShiftCommentAction(
      { status: "idle" },
      fd({ shiftId: SHIFT_ID, body: "   " }),
    );
    expect(r.status).toBe("error");
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects when not signed in", async () => {
    currentUserMock.mockResolvedValueOnce(null);
    const { postShiftCommentAction } = await load();
    const r = await postShiftCommentAction(
      { status: "idle" },
      fd({ shiftId: SHIFT_ID, body: "hello" }),
    );
    expect(r.status).toBe("error");
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects a bad shift id", async () => {
    const { postShiftCommentAction } = await load();
    const r = await postShiftCommentAction(
      { status: "idle" },
      fd({ shiftId: "not-a-uuid", body: "hello" }),
    );
    expect(r.status).toBe("error");
    expect(state.inserts).toHaveLength(0);
  });
});

describe("deleteShiftCommentAction", () => {
  it("lets the author delete their own comment", async () => {
    state.rows = [
      {
        id: "c-1",
        shiftId: SHIFT_ID,
        authorUserId: "user-lena",
        body: "mine",
        traceyTenantId: "tenant-A",
      },
    ];
    const { deleteShiftCommentAction } = await load();
    await deleteShiftCommentAction(fd({ id: "c-1", shiftId: SHIFT_ID }));
    expect(state.deletes).toBe(1);
    expect(state.auditCalls[0]?.action).toBe(
      "shiftcraft.shift_comment.deleted",
    );
    expect(state.auditCalls[0]?.details).toMatchObject({ wasAuthor: true });
  });

  it("lets an admin delete anyone's comment", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "admin",
    });
    state.rows = [
      {
        id: "c-1",
        shiftId: SHIFT_ID,
        authorUserId: "user-tomas",
        body: "theirs",
        traceyTenantId: "tenant-A",
      },
    ];
    const { deleteShiftCommentAction } = await load();
    await deleteShiftCommentAction(fd({ id: "c-1", shiftId: SHIFT_ID }));
    expect(state.deletes).toBe(1);
    expect(state.auditCalls[0]?.details).toMatchObject({ wasAuthor: false });
  });

  it("refuses a non-author non-admin", async () => {
    state.rows = [
      {
        id: "c-1",
        shiftId: SHIFT_ID,
        authorUserId: "user-tomas",
        body: "theirs",
        traceyTenantId: "tenant-A",
      },
    ];
    const { deleteShiftCommentAction } = await load();
    await deleteShiftCommentAction(fd({ id: "c-1", shiftId: SHIFT_ID }));
    expect(state.deletes).toBe(0);
    expect(state.auditCalls).toHaveLength(0);
  });

  it("is a no-op when the comment doesn't exist", async () => {
    const { deleteShiftCommentAction } = await load();
    await deleteShiftCommentAction(fd({ id: "c-1", shiftId: SHIFT_ID }));
    expect(state.deletes).toBe(0);
  });

  it("is a no-op on empty id", async () => {
    const { deleteShiftCommentAction } = await load();
    await deleteShiftCommentAction(fd({ id: "", shiftId: SHIFT_ID }));
    expect(state.deletes).toBe(0);
  });
});
