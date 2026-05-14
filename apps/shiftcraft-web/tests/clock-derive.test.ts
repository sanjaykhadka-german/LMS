import { describe, it, expect, vi } from "vitest";

// Stub @tracey/db so importing lib/clock doesn't blow up on the missing
// DATABASE_URL — the pure derivation helpers don't actually touch the DB
// but the same module also exports getEventsInRange* which do.
vi.mock("@tracey/db", () => ({
  forTenant: () => ({ run: async () => [] }),
  scClockEvents: {},
}));

const {
  aggregateClockTotals,
  deriveClockState,
  deriveSegments,
  splitSegmentByDay,
} = await import("../lib/clock");

// Tiny helper so test data reads like real timestamps.
function at(iso: string): Date {
  return new Date(iso);
}

function ev(eventType: string, iso: string) {
  return {
    eventType: eventType as "in" | "out" | "break_start" | "break_end",
    occurredAt: at(iso),
  };
}

describe("deriveClockState", () => {
  it("returns clocked_out for an empty stream", () => {
    const s = deriveClockState([]);
    expect(s.status).toBe("clocked_out");
    expect(s.lastEvent).toBeNull();
    expect(s.segmentStartedAt).toBeNull();
  });

  it("clocked in → working with segment start = the in event", () => {
    const events = [ev("in", "2026-05-14T09:00:00Z")] as never;
    const s = deriveClockState(events);
    expect(s.status).toBe("working");
    expect(s.segmentStartedAt?.toISOString()).toBe("2026-05-14T09:00:00.000Z");
  });

  it("walks in → break_start → break_end → out back to clocked_out", () => {
    const events = [
      ev("in", "2026-05-14T09:00:00Z"),
      ev("break_start", "2026-05-14T12:00:00Z"),
      ev("break_end", "2026-05-14T12:30:00Z"),
      ev("out", "2026-05-14T17:00:00Z"),
    ] as never;
    const s = deriveClockState(events);
    expect(s.status).toBe("clocked_out");
    expect(s.segmentStartedAt).toBeNull();
  });

  it("ignores duplicate clock_in (idempotent under bad sequences)", () => {
    const events = [
      ev("in", "2026-05-14T09:00:00Z"),
      ev("in", "2026-05-14T09:01:00Z"),
    ] as never;
    const s = deriveClockState(events);
    expect(s.status).toBe("working");
    // First valid 'in' wins for segmentStartedAt.
    expect(s.segmentStartedAt?.toISOString()).toBe("2026-05-14T09:00:00.000Z");
  });

  it("on_break reflects an open break segment", () => {
    const events = [
      ev("in", "2026-05-14T09:00:00Z"),
      ev("break_start", "2026-05-14T12:00:00Z"),
    ] as never;
    const s = deriveClockState(events);
    expect(s.status).toBe("on_break");
    expect(s.segmentStartedAt?.toISOString()).toBe("2026-05-14T12:00:00.000Z");
  });
});

describe("aggregateClockTotals", () => {
  it("sums a clean shift: 8h work, 30m break", () => {
    const t = aggregateClockTotals([
      ev("in", "2026-05-14T09:00:00Z"),
      ev("break_start", "2026-05-14T12:00:00Z"),
      ev("break_end", "2026-05-14T12:30:00Z"),
      ev("out", "2026-05-14T17:30:00Z"),
    ]);
    expect(t.workMs).toBe(8 * 60 * 60 * 1000);
    expect(t.breakMs).toBe(30 * 60 * 1000);
  });

  it("closes an open work segment at now if still working", () => {
    const events = [ev("in", "2026-05-14T09:00:00Z")];
    const t = aggregateClockTotals(events, at("2026-05-14T11:00:00Z"));
    expect(t.workMs).toBe(2 * 60 * 60 * 1000);
    expect(t.breakMs).toBe(0);
  });

  it("returns zero work without `now` when mid-segment", () => {
    const events = [ev("in", "2026-05-14T09:00:00Z")];
    const t = aggregateClockTotals(events);
    // No close → no contribution. Deliberate: the page passes `now` when it
    // wants live elapsed; aggregation for a finished week passes weekEnd.
    expect(t.workMs).toBe(0);
  });
});

describe("deriveSegments + splitSegmentByDay", () => {
  it("emits one work segment per in/out pair", () => {
    const segs = deriveSegments([
      ev("in", "2026-05-14T09:00:00Z"),
      ev("out", "2026-05-14T17:00:00Z"),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe("work");
  });

  it("splits an overnight segment at midnight (local time)", () => {
    // Construct with the runtime's local TZ so the midnight calc lines up.
    const start = new Date(2026, 4, 14, 22, 0, 0); // 14 May 22:00
    const end = new Date(2026, 4, 15, 6, 0, 0); //   15 May 06:00
    const split = splitSegmentByDay({
      kind: "work",
      startedAt: start,
      endedAt: end,
    });
    expect(split).toHaveLength(2);
    expect(split[0]!.endedAt.getHours()).toBe(0);
    expect(split[0]!.endedAt.getMinutes()).toBe(0);
    expect(split[1]!.startedAt.getTime()).toBe(split[0]!.endedAt.getTime());
    expect(split[1]!.endedAt.getTime()).toBe(end.getTime());
    const total =
      (split[0]!.endedAt.getTime() - split[0]!.startedAt.getTime()) +
      (split[1]!.endedAt.getTime() - split[1]!.startedAt.getTime());
    expect(total).toBe(end.getTime() - start.getTime());
  });

  it("does not split a single-day segment", () => {
    const start = new Date(2026, 4, 14, 9, 0, 0);
    const end = new Date(2026, 4, 14, 17, 0, 0);
    const split = splitSegmentByDay({
      kind: "work",
      startedAt: start,
      endedAt: end,
    });
    expect(split).toHaveLength(1);
  });
});
