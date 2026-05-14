import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  user: {
    id: "user-1",
    name: "Old Name",
    email: "me@example.com",
    passwordHash:
      // bcrypt hash of "correct-password" with rounds=12; computed in
      // setup() below since bcryptjs is async.
      "" as string,
    passwordChangedAt: new Date("2025-01-01T00:00:00Z"),
  },
  updates: [] as Array<Record<string, unknown>>,
};

const currentUserMock = vi.fn();

vi.mock("@tracey/db", () => ({
  users: {
    id: { __field: "id" },
    name: { __field: "name" },
    email: { __field: "email" },
    passwordHash: { __field: "passwordHash" },
    passwordChangedAt: { __field: "passwordChangedAt" },
  },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              passwordHash: state.user.passwordHash,
            },
          ],
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(patch);
          // Mirror the patch onto the in-memory user so a second action
          // sees the updated state.
          if ("name" in patch) state.user.name = patch.name as string;
          if ("passwordHash" in patch)
            state.user.passwordHash = patch.passwordHash as string;
          if ("passwordChangedAt" in patch)
            state.user.passwordChangedAt = patch.passwordChangedAt as Date;
          return [];
        },
      }),
    }),
  },
}));

vi.mock("~/lib/auth/current", () => ({
  currentUser: () => currentUserMock(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// We don't mock ~/lib/auth/passwords — bcryptjs is fast enough at the
// default rounds and exercising the real hash/verify gives more confidence
// than a stub.

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

async function load() {
  return await import("../app/app/settings/actions");
}

beforeEach(async () => {
  state.updates = [];
  state.user.name = "Old Name";
  state.user.passwordChangedAt = new Date("2025-01-01T00:00:00Z");
  // Hash a known password fresh per test so verify() works against it.
  const { hashPassword } = await import("../lib/auth/passwords");
  state.user.passwordHash = await hashPassword("correct-password");
  currentUserMock.mockResolvedValue({
    id: "user-1",
    email: "me@example.com",
    name: "Old Name",
    image: null,
  });
});

describe("updateProfileAction", () => {
  it("updates the user's name", async () => {
    const { updateProfileAction } = await load();
    const r = await updateProfileAction(
      { status: "idle" },
      fd({ name: "New Name" }),
    );
    expect(r.status).toBe("ok");
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.name).toBe("New Name");
  });

  it("rejects an empty name", async () => {
    const { updateProfileAction } = await load();
    const r = await updateProfileAction(
      { status: "idle" },
      fd({ name: "" }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.fieldErrors?.name).toBeTruthy();
    expect(state.updates).toHaveLength(0);
  });

  it("refuses when no user is signed in", async () => {
    currentUserMock.mockResolvedValueOnce(null);
    const { updateProfileAction } = await load();
    const r = await updateProfileAction(
      { status: "idle" },
      fd({ name: "Whoever" }),
    );
    expect(r.status).toBe("error");
  });
});

describe("changePasswordAction", () => {
  it("changes the password when current is correct and new differs", async () => {
    // Snapshot the original hash BEFORE the action runs — the mocked
    // update() patches state.user.passwordHash in place, so comparing
    // post-call would compare the new hash to itself.
    const originalHash = state.user.passwordHash;
    const { changePasswordAction } = await load();
    const r = await changePasswordAction(
      { status: "idle" },
      fd({
        current: "correct-password",
        next: "brand-new-pw!",
        confirm: "brand-new-pw!",
      }),
    );
    expect(r.status).toBe("ok");
    // Two fields set on update: passwordHash + passwordChangedAt (and
    // updatedAt). Single update call.
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.passwordHash).toBeTruthy();
    expect(state.updates[0]!.passwordHash).not.toBe(originalHash);
    // passwordChangedAt is bumped to a recent Date.
    const bump = state.updates[0]!.passwordChangedAt as Date;
    expect(bump.getTime()).toBeGreaterThan(
      new Date("2025-01-01T00:00:00Z").getTime(),
    );
  });

  it("rejects an incorrect current password", async () => {
    const { changePasswordAction } = await load();
    const r = await changePasswordAction(
      { status: "idle" },
      fd({
        current: "wrong",
        next: "brand-new-pw!",
        confirm: "brand-new-pw!",
      }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.fieldErrors?.current?.[0]).toMatch(/incorrect/i);
    }
    expect(state.updates).toHaveLength(0);
  });

  it("rejects when confirm does not match", async () => {
    const { changePasswordAction } = await load();
    const r = await changePasswordAction(
      { status: "idle" },
      fd({
        current: "correct-password",
        next: "brand-new-pw!",
        confirm: "different",
      }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.fieldErrors?.confirm).toBeTruthy();
    expect(state.updates).toHaveLength(0);
  });

  it("rejects when new password is too short", async () => {
    const { changePasswordAction } = await load();
    const r = await changePasswordAction(
      { status: "idle" },
      fd({
        current: "correct-password",
        next: "short",
        confirm: "short",
      }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.fieldErrors?.next).toBeTruthy();
    expect(state.updates).toHaveLength(0);
  });

  it("rejects when new password matches the current one", async () => {
    const { changePasswordAction } = await load();
    const r = await changePasswordAction(
      { status: "idle" },
      fd({
        current: "correct-password",
        next: "correct-password",
        confirm: "correct-password",
      }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.fieldErrors?.next?.[0]).toMatch(/differ/i);
    }
    expect(state.updates).toHaveLength(0);
  });
});
