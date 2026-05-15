import { describe, it, expect } from "vitest";
import {
  buildCalendar,
  signFeedToken,
  verifyFeedToken,
  type ShiftEvent,
} from "../lib/ics";

describe("signFeedToken / verifyFeedToken", () => {
  it("round-trips for the same (tenant, user) pair", () => {
    const token = signFeedToken("tenant-A", "user-1");
    expect(verifyFeedToken("tenant-A", "user-1", token)).toBe(true);
  });

  it("rejects a token for a different user", () => {
    const token = signFeedToken("tenant-A", "user-1");
    expect(verifyFeedToken("tenant-A", "user-2", token)).toBe(false);
  });

  it("rejects a token for a different tenant", () => {
    const token = signFeedToken("tenant-A", "user-1");
    expect(verifyFeedToken("tenant-B", "user-1", token)).toBe(false);
  });

  it("rejects garbage tokens of any length", () => {
    expect(verifyFeedToken("tenant-A", "user-1", "")).toBe(false);
    expect(verifyFeedToken("tenant-A", "user-1", "not-a-real-token")).toBe(
      false,
    );
    expect(
      verifyFeedToken(
        "tenant-A",
        "user-1",
        "x".repeat(signFeedToken("tenant-A", "user-1").length),
      ),
    ).toBe(false);
  });

  it("is URL-safe (base64url, no = padding)", () => {
    const token = signFeedToken("tenant-A", "user-1");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("=");
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
  });
});

describe("buildCalendar", () => {
  function ev(overrides: Partial<ShiftEvent> = {}): ShiftEvent {
    return {
      id: "shift-1",
      startsAt: new Date("2026-05-15T09:00:00Z"),
      endsAt: new Date("2026-05-15T17:00:00Z"),
      role: "Butcher",
      locationName: "Brunswick Store",
      notes: null,
      ...overrides,
    };
  }

  it("emits a well-formed VCALENDAR envelope", () => {
    const out = buildCalendar({ calendarName: "Test", events: [] });
    expect(out).toContain("BEGIN:VCALENDAR");
    expect(out).toContain("VERSION:2.0");
    expect(out).toContain("PRODID:-//ShiftCraft//Tracey//EN");
    expect(out).toContain("END:VCALENDAR");
    // CRLF line endings (RFC 5545).
    expect(out).toMatch(/\r\n/);
  });

  it("emits one VEVENT block per shift with role + location in SUMMARY", () => {
    const out = buildCalendar({
      calendarName: "Test",
      events: [ev()],
    });
    expect(out).toContain("BEGIN:VEVENT");
    expect(out).toContain("END:VEVENT");
    expect(out).toContain("UID:shift-1@shiftcraft.local");
    expect(out).toContain("DTSTART:20260515T090000Z");
    expect(out).toContain("DTEND:20260515T170000Z");
    expect(out).toContain("SUMMARY:Butcher @ Brunswick Store");
    expect(out).toContain("LOCATION:Brunswick Store");
  });

  it("escapes commas, semicolons, newlines, and backslashes in text fields", () => {
    const out = buildCalendar({
      calendarName: "Test, with comma",
      events: [
        ev({
          role: "Knife; sharpening",
          locationName: "Site\nA",
          notes: "back\\slash",
        }),
      ],
    });
    expect(out).toContain("X-WR-CALNAME:Test\\, with comma");
    expect(out).toContain("Knife\\; sharpening");
    expect(out).toContain("Site\\nA");
    expect(out).toContain("back\\\\slash");
  });

  it("folds lines longer than 75 octets per RFC 5545", () => {
    const long = "a".repeat(150);
    const out = buildCalendar({
      calendarName: "Test",
      events: [ev({ role: long })],
    });
    const summaryLine = out
      .split(/\r\n(?! )/) // split on logical lines (unfold first)
      .find((l) => l.replace(/\r\n /g, "").startsWith("SUMMARY:"));
    expect(summaryLine).toBeDefined();
    // The physical-line representation must contain the CRLF + space
    // continuation marker because the joined logical line is > 75 chars.
    expect(out).toMatch(/\r\n /);
  });

  it("omits LOCATION and DESCRIPTION when both are null", () => {
    const out = buildCalendar({
      calendarName: "Test",
      events: [ev({ locationName: null, notes: null })],
    });
    expect(out).not.toContain("LOCATION:");
    expect(out).not.toContain("DESCRIPTION:");
    expect(out).toContain("SUMMARY:Butcher");
  });
});
