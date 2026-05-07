import { describe, it, expect } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import { verifyWerkzeugPbkdf2 } from "../lib/auth/passwords";

// werkzeug's generate_password_hash with the default sha256 method emits:
//   pbkdf2:sha256:<iterations>$<salt>$<hex_digest>
// We construct equivalent vectors here using Node's raw pbkdf2 so the test
// exercises every part of the verifier (format parse + iter parse + salt
// pass-through + sha256 hashing + constant-time compare) against an
// independent computation of the same digest.

function werkzeugHash(plaintext: string, salt: string, iterations: number): string {
  const hex = pbkdf2Sync(plaintext, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2:sha256:${iterations}$${salt}$${hex}`;
}

describe("verifyWerkzeugPbkdf2", () => {
  it("returns true for the correct password", () => {
    const stored = werkzeugHash("hunter2", "saltsaltsaltsalt", 1000);
    expect(verifyWerkzeugPbkdf2("hunter2", stored)).toBe(true);
  });

  it("returns false for the wrong password", () => {
    const stored = werkzeugHash("hunter2", "saltsaltsaltsalt", 1000);
    expect(verifyWerkzeugPbkdf2("hunter3", stored)).toBe(false);
    expect(verifyWerkzeugPbkdf2("", stored)).toBe(false);
    expect(verifyWerkzeugPbkdf2("HUNTER2", stored)).toBe(false);
  });

  it("works across werkzeug iteration counts (legacy + modern defaults)", () => {
    for (const iter of [1, 1000, 150_000, 260_000, 600_000]) {
      const stored = werkzeugHash("correct horse battery staple", "abcDEF123!@#", iter);
      expect(verifyWerkzeugPbkdf2("correct horse battery staple", stored)).toBe(true);
      expect(verifyWerkzeugPbkdf2("wrong horse", stored)).toBe(false);
    }
  });

  it("rejects malformed strings without throwing", () => {
    expect(verifyWerkzeugPbkdf2("anything", "")).toBe(false);
    expect(verifyWerkzeugPbkdf2("anything", "not a hash")).toBe(false);
    expect(verifyWerkzeugPbkdf2("anything", "pbkdf2:sha256:1000$salt$")).toBe(false);
    expect(verifyWerkzeugPbkdf2("anything", "pbkdf2:sha256:1000$salt$tooshort")).toBe(false);
    // Non-numeric iterations.
    expect(verifyWerkzeugPbkdf2("anything", "pbkdf2:sha256:abc$salt$" + "0".repeat(64))).toBe(
      false,
    );
    // Extra delimiter inside the salt — werkzeug uses the literal $ so a
    // salt with $ in it would be malformed for both Flask and us. Our regex
    // expects exactly one $ between salt and digest.
    expect(
      verifyWerkzeugPbkdf2("anything", "pbkdf2:sha256:1000$sa$lt$" + "0".repeat(64)),
    ).toBe(false);
  });

  it("rejects different hash algorithms", () => {
    // werkzeug also supports sha1 / sha512 via "pbkdf2:<method>:..." but Tracey
    // only supports sha256 because that's what Flask LMS shipped with.
    const sha1Form = `pbkdf2:sha1:1000$saltsaltsaltsalt$${pbkdf2Sync(
      "hunter2",
      "saltsaltsaltsalt",
      1000,
      32,
      "sha1",
    ).toString("hex")}`;
    expect(verifyWerkzeugPbkdf2("hunter2", sha1Form)).toBe(false);
  });

  it("rejects negative or zero iteration counts", () => {
    expect(
      verifyWerkzeugPbkdf2("anything", "pbkdf2:sha256:0$saltsaltsaltsalt$" + "0".repeat(64)),
    ).toBe(false);
  });
});
