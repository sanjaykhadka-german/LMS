import { describe, it, expect, vi } from "vitest";

vi.mock("@tracey/db", () => ({
  forTenant: () => ({ run: async () => [] }),
  scLocations: {},
  scShifts: {},
  scShiftAssignments: {},
  scEmployees: {},
}));

const { hoursBetween, projectShiftCost, fmtMoney, fmtHours } = await import(
  "~/lib/labour-forecast"
);

describe("hoursBetween", () => {
  it("returns the elapsed hours between two dates", () => {
    const a = new Date("2026-05-17T09:00:00Z");
    const b = new Date("2026-05-17T17:00:00Z");
    expect(hoursBetween(a, b)).toBe(8);
  });

  it("supports fractional hours", () => {
    const a = new Date("2026-05-17T09:00:00Z");
    const b = new Date("2026-05-17T10:30:00Z");
    expect(hoursBetween(a, b)).toBe(1.5);
  });

  it("clamps backwards ranges to zero", () => {
    const a = new Date("2026-05-17T10:00:00Z");
    const b = new Date("2026-05-17T09:00:00Z");
    expect(hoursBetween(a, b)).toBe(0);
  });
});

describe("projectShiftCost", () => {
  const start = new Date("2026-05-17T09:00:00Z");
  const end = new Date("2026-05-17T17:00:00Z");

  it("multiplies hours by rate", () => {
    expect(projectShiftCost(start, end, 30)).toBe(240);
  });

  it("returns zero when the rate is null (rate not set)", () => {
    expect(projectShiftCost(start, end, null)).toBe(0);
  });

  it("returns zero for zero-length shifts", () => {
    expect(projectShiftCost(start, start, 30)).toBe(0);
  });
});

describe("fmtMoney", () => {
  it("renders whole dollars in AUD with no decimals", () => {
    // Intl produces "A$240" on most ICU builds; allow either symbol form.
    const out = fmtMoney(240);
    expect(out).toMatch(/\$240/);
  });
});

describe("fmtHours", () => {
  it("uses minutes for sub-hour values", () => {
    expect(fmtHours(0.5)).toBe("30m");
  });

  it("uses one decimal for single-digit hours", () => {
    expect(fmtHours(7.5)).toBe("7.5h");
  });

  it("rounds to whole hours past 10", () => {
    expect(fmtHours(42)).toBe("42h");
  });
});
