import { describe, it, expect, vi } from "vitest";

vi.mock("@tracey/db", () => ({
  forTenant: () => ({ run: async () => [] }),
  scLocations: {},
  scShifts: {},
  scShiftAssignments: {},
}));

const { overlaps } = await import("~/lib/shift-conflicts");

const at = (iso: string) => new Date(iso);

describe("overlaps", () => {
  it("returns true when one window starts inside the other", () => {
    expect(
      overlaps(
        at("2026-05-17T09:00:00Z"),
        at("2026-05-17T17:00:00Z"),
        at("2026-05-17T12:00:00Z"),
        at("2026-05-17T13:00:00Z"),
      ),
    ).toBe(true);
  });

  it("returns true when one window fully contains the other", () => {
    expect(
      overlaps(
        at("2026-05-17T08:00:00Z"),
        at("2026-05-17T18:00:00Z"),
        at("2026-05-17T10:00:00Z"),
        at("2026-05-17T14:00:00Z"),
      ),
    ).toBe(true);
  });

  it("returns true for a partial overlap at the start", () => {
    expect(
      overlaps(
        at("2026-05-17T09:00:00Z"),
        at("2026-05-17T13:00:00Z"),
        at("2026-05-17T11:00:00Z"),
        at("2026-05-17T15:00:00Z"),
      ),
    ).toBe(true);
  });

  it("returns false for windows that only touch at a single instant", () => {
    // Back-to-back shifts (one ends 17:00, next starts 17:00) shouldn't
    // trip the guard — that's the most common legitimate roster pattern.
    expect(
      overlaps(
        at("2026-05-17T09:00:00Z"),
        at("2026-05-17T17:00:00Z"),
        at("2026-05-17T17:00:00Z"),
        at("2026-05-17T21:00:00Z"),
      ),
    ).toBe(false);
  });

  it("returns false for clearly disjoint windows", () => {
    expect(
      overlaps(
        at("2026-05-17T09:00:00Z"),
        at("2026-05-17T17:00:00Z"),
        at("2026-05-18T09:00:00Z"),
        at("2026-05-18T17:00:00Z"),
      ),
    ).toBe(false);
  });
});
