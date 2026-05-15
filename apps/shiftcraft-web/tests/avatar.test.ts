import { describe, it, expect } from "vitest";
import {
  avatarColourFor,
  initialsFor,
  validateAvatarUrl,
} from "../lib/avatar";

describe("avatarColourFor", () => {
  it("returns a 7-char hex string", () => {
    const c = avatarColourFor("anyone@example.com");
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("is stable for the same email", () => {
    const a = avatarColourFor("lena@example.com");
    const b = avatarColourFor("lena@example.com");
    expect(a).toBe(b);
  });

  it("returns different colours for different emails (mostly)", () => {
    const samples = [
      "a@example.com",
      "b@example.com",
      "c@example.com",
      "d@example.com",
      "e@example.com",
    ].map(avatarColourFor);
    // With 10 buckets and 5 samples we expect at least 3 distinct values.
    expect(new Set(samples).size).toBeGreaterThanOrEqual(3);
  });

  it("handles empty email without crashing", () => {
    expect(avatarColourFor("")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("initialsFor", () => {
  it("picks first letter of first + last name", () => {
    expect(initialsFor("Lena Müller", "lena@example.com")).toBe("LM");
  });

  it("uppercases single-word names", () => {
    expect(initialsFor("priya", "priya@example.com")).toBe("P");
  });

  it("falls back to the email's first letter when name is blank", () => {
    expect(initialsFor("", "tomas@example.com")).toBe("T");
    expect(initialsFor(null, "X@example.com")).toBe("X");
  });

  it("returns ? when nothing usable is present", () => {
    expect(initialsFor(null, "")).toBe("?");
  });

  it("trims whitespace before splitting", () => {
    expect(initialsFor("  Jin   Park  ", "j@example.com")).toBe("JP");
  });
});

describe("validateAvatarUrl", () => {
  it("returns null for blank or null", () => {
    expect(validateAvatarUrl(null)).toBeNull();
    expect(validateAvatarUrl("")).toBeNull();
    expect(validateAvatarUrl("   ")).toBeNull();
  });

  it("accepts https URLs", () => {
    expect(validateAvatarUrl("https://example.com/me.jpg")).toBe(
      "https://example.com/me.jpg",
    );
  });

  it("accepts http URLs", () => {
    expect(validateAvatarUrl("http://localhost:8080/me.png")).toBe(
      "http://localhost:8080/me.png",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(validateAvatarUrl("  https://x.test/y  ")).toBe(
      "https://x.test/y",
    );
  });

  it("rejects a data: URL", () => {
    expect(() => validateAvatarUrl("data:image/png;base64,AAA")).toThrow(
      /http or https/,
    );
  });

  it("rejects a javascript: URL", () => {
    expect(() => validateAvatarUrl("javascript:alert(1)")).toThrow(
      /http or https/,
    );
  });

  it("rejects non-URL garbage", () => {
    expect(() => validateAvatarUrl("not a url")).toThrow(
      /full http\(s\) URL/,
    );
  });

  it("rejects 1001-char URLs", () => {
    const longButValid =
      "https://example.com/" + "a".repeat(1001 - "https://example.com/".length);
    expect(() => validateAvatarUrl(longButValid)).toThrow(/too long/);
  });
});
