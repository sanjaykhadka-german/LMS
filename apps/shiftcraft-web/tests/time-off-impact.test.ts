import { describe, it, expect, vi } from "vitest";

vi.mock("@tracey/db", () => ({
  forTenant: () => ({ run: async () => [] }),
  scLocations: {},
  scShifts: {},
  scShiftAssignments: {},
}));

const { startOfDay, endOfDayExclusive } = await import("~/lib/time-off-impact");

describe("startOfDay", () => {
  it("returns midnight on the given ISO date", () => {
    const d = startOfDay("2026-05-17");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May is index 4
    expect(d.getDate()).toBe(17);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe("endOfDayExclusive", () => {
  it("returns midnight of the day AFTER the given ISO date", () => {
    const d = endOfDayExclusive("2026-05-17");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(18);
    expect(d.getHours()).toBe(0);
  });

  it("rolls over month boundaries", () => {
    const d = endOfDayExclusive("2026-05-31");
    expect(d.getMonth()).toBe(5); // June
    expect(d.getDate()).toBe(1);
  });

  it("rolls over year boundaries", () => {
    const d = endOfDayExclusive("2026-12-31");
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0); // January
    expect(d.getDate()).toBe(1);
  });

  it("the (start, endExclusive) window covers exactly the calendar range", () => {
    // Single-day request → 1 day = 24h window
    const oneDay =
      endOfDayExclusive("2026-05-17").getTime() -
      startOfDay("2026-05-17").getTime();
    expect(oneDay).toBe(24 * 60 * 60 * 1000);

    // Three-day request → 3 days
    const threeDays =
      endOfDayExclusive("2026-05-19").getTime() -
      startOfDay("2026-05-17").getTime();
    expect(threeDays).toBe(3 * 24 * 60 * 60 * 1000);
  });
});
