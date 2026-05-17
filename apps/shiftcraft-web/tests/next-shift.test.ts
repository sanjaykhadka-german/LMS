import { describe, it, expect, vi } from "vitest";

// Stub @tracey/db so importing lib/next-shift doesn't blow up on the
// missing DATABASE_URL — only the pure formatters are exercised here.
vi.mock("@tracey/db", () => ({
  forTenant: () => ({ run: async () => [] }),
  scLocations: {},
  scShifts: {},
  scShiftAssignments: {},
}));

const { countdownFor, humanise } = await import("~/lib/next-shift");

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("humanise", () => {
  it("formats sub-minute durations in seconds", () => {
    expect(humanise(0)).toBe("0s");
    expect(humanise(15 * SECOND)).toBe("15s");
    expect(humanise(59 * SECOND)).toBe("59s");
  });

  it("formats sub-hour durations in minutes", () => {
    expect(humanise(MINUTE)).toBe("1m");
    expect(humanise(45 * MINUTE)).toBe("45m");
  });

  it("formats sub-day durations as Hh Mm", () => {
    expect(humanise(HOUR)).toBe("1h");
    expect(humanise(2 * HOUR + 30 * MINUTE)).toBe("2h 30m");
    expect(humanise(23 * HOUR + 59 * MINUTE)).toBe("23h 59m");
  });

  it("formats multi-day durations with day + hour pluralisation", () => {
    expect(humanise(DAY)).toBe("1 day");
    expect(humanise(DAY + HOUR)).toBe("1 day 1 hour");
    expect(humanise(2 * DAY + 4 * HOUR)).toBe("2 days 4 hours");
    expect(humanise(5 * DAY)).toBe("5 days");
  });

  it("clamps negative durations to zero", () => {
    expect(humanise(-5000)).toBe("0s");
  });
});

describe("countdownFor", () => {
  // Anchor on a fixed instant so tests don't drift with real time.
  const now = new Date("2026-05-17T12:00:00Z");

  it("returns null once the shift finished more than an hour ago", () => {
    const startsAt = new Date(now.getTime() - 4 * HOUR);
    const endsAt = new Date(now.getTime() - 65 * MINUTE);
    expect(countdownFor(now, startsAt, endsAt)).toBeNull();
  });

  it("flags 'finished' when the shift ended within the last hour", () => {
    const startsAt = new Date(now.getTime() - 4 * HOUR);
    const endsAt = new Date(now.getTime() - 10 * MINUTE);
    const r = countdownFor(now, startsAt, endsAt);
    expect(r).not.toBeNull();
    expect(r!.tone).toBe("finished");
    expect(r!.headline).toBe("Just finished");
    expect(r!.label).toBe("Wrapped 10m ago");
  });

  it("flags 'working' when currently inside the shift window", () => {
    const startsAt = new Date(now.getTime() - 30 * MINUTE);
    const endsAt = new Date(now.getTime() + 90 * MINUTE);
    const r = countdownFor(now, startsAt, endsAt);
    expect(r).not.toBeNull();
    expect(r!.tone).toBe("working");
    expect(r!.headline).toBe("Currently working");
    expect(r!.label).toBe("Ends in 1h 30m");
  });

  it("flags 'imminent' once less than one hour remains until start", () => {
    const startsAt = new Date(now.getTime() + 30 * MINUTE);
    const endsAt = new Date(startsAt.getTime() + 8 * HOUR);
    const r = countdownFor(now, startsAt, endsAt);
    expect(r).not.toBeNull();
    expect(r!.tone).toBe("imminent");
    expect(r!.headline).toBe("Up next");
    expect(r!.label).toBe("Starts in 30m");
  });

  it("collapses to 'Starting now' when start is within the next 30 seconds", () => {
    const startsAt = new Date(now.getTime() + 10 * SECOND);
    const endsAt = new Date(startsAt.getTime() + 8 * HOUR);
    const r = countdownFor(now, startsAt, endsAt);
    expect(r).not.toBeNull();
    expect(r!.tone).toBe("imminent");
    expect(r!.headline).toBe("Starting now");
    expect(r!.label).toBe("Time to clock in.");
  });

  it("uses 'upcoming' tone for shifts more than an hour away", () => {
    const startsAt = new Date(now.getTime() + 2 * DAY + 4 * HOUR);
    const endsAt = new Date(startsAt.getTime() + 8 * HOUR);
    const r = countdownFor(now, startsAt, endsAt);
    expect(r).not.toBeNull();
    expect(r!.tone).toBe("upcoming");
    expect(r!.headline).toBe("Up next");
    expect(r!.label).toBe("Starts in 2 days 4 hours");
  });
});
