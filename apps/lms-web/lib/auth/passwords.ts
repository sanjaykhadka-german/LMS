import "server-only";
import { pbkdf2Sync, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

const ROUNDS = 12; // ~250ms on a modern laptop

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

// ─── Legacy Flask password verification (Slice 6) ─────────────────────────
//
// werkzeug.security.generate_password_hash produces strings shaped like
//   pbkdf2:sha256:<iterations>$<salt>$<hex_digest>
// e.g. "pbkdf2:sha256:600000$Mj3a2Mf3$<64 hex chars>".
//
// Until every legacy Flask user has logged into Tracey at least once, the
// credentials provider falls back to checking these hashes against
// public.users.password_hash. Once a successful verify happens we bcrypt
// the plaintext into app.users.password_hash, so the next login takes the
// fast path and never touches this code.
//
// Only sha256 is supported — that's what werkzeug has defaulted to for
// every version Flask LMS ever shipped on. Any other prefix returns false.

const PBKDF2_RE = /^pbkdf2:sha256:(\d+)\$([^$]+)\$([0-9a-f]+)$/;
const PBKDF2_KEY_LEN = 32; // werkzeug defaults to 32 bytes (64 hex chars)

export function verifyWerkzeugPbkdf2(plaintext: string, stored: string): boolean {
  const match = PBKDF2_RE.exec(stored ?? "");
  if (!match) return false;
  const iterations = parseInt(match[1]!, 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = match[2]!;
  const expectedHex = match[3]!;
  // werkzeug stores the digest in hex of length 64 (32 bytes); reject
  // anything that doesn't conform so a malformed string can't bypass.
  if (expectedHex.length !== PBKDF2_KEY_LEN * 2) return false;
  let derived: Buffer;
  try {
    derived = pbkdf2Sync(plaintext, salt, iterations, PBKDF2_KEY_LEN, "sha256");
  } catch {
    return false;
  }
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}
