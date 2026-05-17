import { describe, it, expect } from "vitest";
import {
  checkAvailability,
  dayKeyFor,
  parseAvailabilityForDay,
} from "~/lib/availability-check";

// availability-check is a pure module — no @tracey/db import — so no mock needed.

describe("parseAvailabilityForDay", () => {
  it("treats blank/empty as unknown", () => {
    expect(parseAvailabilityForDay("").kind).toBe("unknown");
    expect(parseAvailabilityForDay(undefined).kind).toBe("unknown");
    expect(parseAvailabilityForDay(null).kind).toBe("unknown");
    expect(parseAvailabilityForDay("   ").kind).toBe("unknown");
  });

  it("recognises common 'unavailable' phrasings", () => {
    expect(parseAvailabilityForDay("not available").kind).toBe("unavailable");
    expect(parseAvailabilityForDay("unavailable").kind).toBe("unavailable");
    expect(parseAvailabilityForDay("OFF").kind).toBe("unavailable");
    expect(parseAvailabilityForDay("no").kind).toBe("unavailable");
    expect(parseAvailabilityForDay("-").kind).toBe("unavailable");
  });

  it("parses 24-hour ranges like '9-17'", () => {
    const p = parseAvailabilityForDay("9-17");
    expect(p.kind).toBe("window");
    if (p.kind === "window") {
      expect(p.window.fromMin).toBe(9 * 60);
      expect(p.window.toMin).toBe(17 * 60);
    }
  });

  it("treats '9-5' as 9am to 5pm (PM heuristic when 'to' < 'from')", () => {
    const p = parseAvailabilityForDay("9-5");
    expect(p.kind).toBe("window");
    if (p.kind === "window") {
      expect(p.window.fromMin).toBe(9 * 60);
      expect(p.window.toMin).toBe(17 * 60);
    }
  });

  it("parses am/pm forms like '9am-5pm'", () => {
    const p = parseAvailabilityForDay("9am-5pm");
    expect(p.kind).toBe("window");
    if (p.kind === "window") {
      expect(p.window.fromMin).toBe(9 * 60);
      expect(p.window.toMin).toBe(17 * 60);
    }
  });

  it("parses HH:MM ranges", () => {
    const p = parseAvailabilityForDay("08:30-16:30");
    expect(p.kind).toBe("window");
    if (p.kind === "window") {
      expect(p.window.fromMin).toBe(8 * 60 + 30);
      expect(p.window.toMin).toBe(16 * 60 + 30);
    }
  });

  it("parses 'after 4pm' as open-ended evening", () => {
    const p = parseAvailabilityForDay("after 4pm");
    expect(p.kind).toBe("window");
    if (p.kind === "window") {
      expect(p.window.fromMin).toBe(16 * 60);
      expect(p.window.toMin).toBe(24 * 60 - 1);
    }
  });

  it("parses 'before noon' style as morning-only", () => {
    const p = parseAvailabilityForDay("before 12");
    expect(p.kind).toBe("window");
    if (p.kind === "window") {
      expect(p.window.fromMin).toBe(0);
      expect(p.window.toMin).toBe(12 * 60);
    }
  });

  it("returns unknown for genuinely free-form text we can't interpret", () => {
    expect(parseAvailabilityForDay("evenings only").kind).toBe("unknown");
    expect(parseAvailabilityForDay("ask me first").kind).toBe("unknown");
    expect(parseAvailabilityForDay("variable").kind).toBe("unknown");
  });
});

describe("checkAvailability", () => {
  // 2026-05-18 is a Monday in local time.
  const monday9 = new Date(2026, 4, 18, 9, 0);
  const monday17 = new Date(2026, 4, 18, 17, 0);
  const monday19 = new Date(2026, 4, 18, 19, 0);

  it("returns match when the shift fits inside the window", () => {
    const v = checkAvailability({ mon: "9-17" }, monday9, monday17);
    expect(v.kind).toBe("match");
  });

  it("returns mismatch when the shift runs past the window", () => {
    const v = checkAvailability({ mon: "9-17" }, monday9, monday19);
    expect(v.kind).toBe("mismatch");
    if (v.kind === "mismatch") {
      expect(v.reason).toContain("Monday");
    }
  });

  it("returns mismatch when the day is marked unavailable", () => {
    const v = checkAvailability(
      { mon: "not available" },
      monday9,
      monday17,
    );
    expect(v.kind).toBe("mismatch");
    if (v.kind === "mismatch") {
      expect(v.reason).toContain("unavailable");
    }
  });

  it("returns unknown when there's no entry for the shift's day", () => {
    expect(checkAvailability({ tue: "9-17" }, monday9, monday17).kind).toBe(
      "unknown",
    );
  });

  it("returns unknown when the availability object is null", () => {
    expect(checkAvailability(null, monday9, monday17).kind).toBe("unknown");
  });

  it("returns unknown for shifts that cross midnight (too risky to judge)", () => {
    const lateStart = new Date(2026, 4, 18, 22, 0);
    const earlyEnd = new Date(2026, 4, 19, 6, 0);
    expect(
      checkAvailability({ mon: "after 6pm" }, lateStart, earlyEnd).kind,
    ).toBe("unknown");
  });
});

describe("dayKeyFor", () => {
  it("maps Date weekday onto the availability JSON keys", () => {
    // 2026-05-17 was a Sunday
    expect(dayKeyFor(new Date(2026, 4, 17))).toBe("sun");
    expect(dayKeyFor(new Date(2026, 4, 18))).toBe("mon");
    expect(dayKeyFor(new Date(2026, 4, 23))).toBe("sat");
  });
});
