import { describe, it, expect } from "vitest";
import { pbkdf2Sync, scryptSync } from "node:crypto";
import {
  verifyWerkzeugHash,
  verifyWerkzeugPbkdf2,
  verifyWerkzeugScrypt,
} from "../lib/auth/passwords";

// werkzeug.security.generate_password_hash emits one of:
//   pbkdf2:sha256:<iterations>$<salt>$<hex>          (werkzeug ≤ 2.x)
//   scrypt:<N>:<r>:<p>$<salt>$<hex>                  (werkzeug 3.x default)
// We construct equivalent vectors using Node's raw pbkdf2/scrypt so the
// tests exercise every part of the verifier (format parse + parameter
// parse + KDF + constant-time compare) against an independent computation
// of the same digest.

function pbkdf2Vector(plaintext: string, salt: string, iterations: number): string {
  const hex = pbkdf2Sync(plaintext, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2:sha256:${iterations}$${salt}$${hex}`;
}

function scryptVector(plaintext: string, salt: string, N: number, r: number, p: number): string {
  // werkzeug's dklen is 64; matches verifier's expected length.
  const hex = scryptSync(plaintext, salt, 64, { N, r, p, maxmem: 256 * N * r * p })
    .toString("hex");
  return `scrypt:${N}:${r}:${p}$${salt}$${hex}`;
}

const werkzeugHash = pbkdf2Vector; // back-compat alias for existing tests below

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

describe("verifyWerkzeugScrypt", () => {
  // werkzeug 3.x defaults: N=32768, r=8, p=1. Real GB prod hashes use these.
  // Tests use a smaller N=2048 so the suite stays under 200ms; the verifier
  // is parametric on N so the math path is identical.
  const TEST_N = 2048;
  const TEST_R = 8;
  const TEST_P = 1;

  it("returns true for the correct password", () => {
    const stored = scryptVector("hunter2", "saltsaltsaltsalt", TEST_N, TEST_R, TEST_P);
    expect(verifyWerkzeugScrypt("hunter2", stored)).toBe(true);
  });

  it("returns false for the wrong password", () => {
    const stored = scryptVector("hunter2", "saltsaltsaltsalt", TEST_N, TEST_R, TEST_P);
    expect(verifyWerkzeugScrypt("hunter3", stored)).toBe(false);
    expect(verifyWerkzeugScrypt("", stored)).toBe(false);
    expect(verifyWerkzeugScrypt("HUNTER2", stored)).toBe(false);
  });

  it("works at werkzeug 3.x default params (N=32768)", () => {
    // The single full-strength vector — a smoke test that maxmem cushion
    // is sufficient at production parameters. ~80ms on a modern laptop.
    const stored = scryptVector("correct horse battery staple", "abcDEF123!@#", 32768, 8, 1);
    expect(verifyWerkzeugScrypt("correct horse battery staple", stored)).toBe(true);
    expect(verifyWerkzeugScrypt("wrong horse", stored)).toBe(false);
  });

  it("rejects malformed strings without throwing", () => {
    expect(verifyWerkzeugScrypt("anything", "")).toBe(false);
    expect(verifyWerkzeugScrypt("anything", "not a hash")).toBe(false);
    expect(verifyWerkzeugScrypt("anything", "scrypt:32768:8:1$salt$")).toBe(false);
    expect(verifyWerkzeugScrypt("anything", "scrypt:32768:8:1$salt$tooshort")).toBe(false);
    // Wrong digest length (64 hex chars instead of 128).
    expect(verifyWerkzeugScrypt("anything", "scrypt:32768:8:1$salt$" + "0".repeat(64))).toBe(false);
    // Non-numeric N.
    expect(verifyWerkzeugScrypt("anything", "scrypt:abc:8:1$salt$" + "0".repeat(128))).toBe(
      false,
    );
  });

  it("rejects absurd parameters (N too large, r/p too high)", () => {
    expect(verifyWerkzeugScrypt("x", "scrypt:1073741824:8:1$salt$" + "0".repeat(128))).toBe(
      false,
    );
    expect(verifyWerkzeugScrypt("x", "scrypt:32768:64:1$salt$" + "0".repeat(128))).toBe(false);
    expect(verifyWerkzeugScrypt("x", "scrypt:32768:8:32$salt$" + "0".repeat(128))).toBe(false);
    // Zero values.
    expect(verifyWerkzeugScrypt("x", "scrypt:0:8:1$salt$" + "0".repeat(128))).toBe(false);
    expect(verifyWerkzeugScrypt("x", "scrypt:32768:0:1$salt$" + "0".repeat(128))).toBe(false);
  });
});

describe("verifyWerkzeugHash (dispatcher)", () => {
  it("dispatches pbkdf2 and scrypt correctly", () => {
    const pb = pbkdf2Vector("p1", "s1", 1000);
    const sc = scryptVector("p2", "s2", 2048, 8, 1);
    expect(verifyWerkzeugHash("p1", pb)).toBe(true);
    expect(verifyWerkzeugHash("p2", sc)).toBe(true);
    // Cross — pbkdf2 password against scrypt hash and vice versa.
    expect(verifyWerkzeugHash("p2", pb)).toBe(false);
    expect(verifyWerkzeugHash("p1", sc)).toBe(false);
  });

  it("returns false for unknown schemes (bcrypt, sha512, plain)", () => {
    // Tracey's own bcrypt format — must not be mistaken for werkzeug.
    expect(verifyWerkzeugHash("anything", "$2b$12$abcdefghijklmnopqrstuvwxyz")).toBe(false);
    // werkzeug pbkdf2:sha512 — Slice 6 doesn't promise to support this.
    expect(verifyWerkzeugHash("anything", "pbkdf2:sha512:1000$salt$" + "0".repeat(128))).toBe(
      false,
    );
    // No prefix at all.
    expect(verifyWerkzeugHash("anything", "deadbeef")).toBe(false);
  });

  it("safely handles null / undefined / empty stored", () => {
    expect(verifyWerkzeugHash("anything", "")).toBe(false);
    expect(verifyWerkzeugHash("anything", null)).toBe(false);
    expect(verifyWerkzeugHash("anything", undefined)).toBe(false);
  });
});
