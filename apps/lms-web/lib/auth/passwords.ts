import "server-only";
import { pbkdf2Sync, scryptSync, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

const ROUNDS = 12; // ~250ms on a modern laptop

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

// ─── Legacy Flask password verification (Slice 6 + scrypt hotfix) ─────────
//
// werkzeug.security.generate_password_hash produces strings in two shapes
// depending on which version of werkzeug ran:
//
//   pbkdf2:sha256:<iterations>$<salt>$<hex>          — werkzeug ≤ 2.x default
//   scrypt:<N>:<r>:<p>$<salt>$<hex>                  — werkzeug 3.x default
//
// German Butchery's prod DB is 100% scrypt:32768:8:1 (werkzeug 3.x). Tracey's
// credentials provider falls back to checking these against public.users
// when an email isn't yet in app.users; on success we bcrypt the plaintext
// into app.users.password_hash so the next login takes the fast path.
//
// verifyWerkzeugHash is the dispatcher. It returns false for any unknown
// prefix (e.g. plain hex, custom schemes, sha512, malformed) so the
// credentials provider falls through to "invalid email or password".

export function verifyWerkzeugHash(plaintext: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2:sha256:")) return verifyWerkzeugPbkdf2(plaintext, stored);
  if (stored.startsWith("scrypt:")) return verifyWerkzeugScrypt(plaintext, stored);
  return false;
}

// Unified verifier for everything that can land in public.users.password_hash:
// werkzeug-format hashes imported from Flask AND bcrypt hashes written by
// admin-side actions (createEmployeeAction, resetEmployeePasswordAction).
// The legacy bridge calls this so admin-created users can sign in on day one.
export async function verifyLegacyHash(
  plaintext: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
    try {
      return await bcrypt.compare(plaintext, stored);
    } catch {
      return false;
    }
  }
  return verifyWerkzeugHash(plaintext, stored);
}

const PBKDF2_RE = /^pbkdf2:sha256:(\d+)\$([^$]+)\$([0-9a-f]+)$/;
const PBKDF2_KEY_LEN = 32; // werkzeug defaults to 32 bytes (64 hex chars)

export function verifyWerkzeugPbkdf2(plaintext: string, stored: string): boolean {
  const match = PBKDF2_RE.exec(stored ?? "");
  if (!match) return false;
  const iterations = parseInt(match[1]!, 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = match[2]!;
  const expectedHex = match[3]!;
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

const SCRYPT_RE = /^scrypt:(\d+):(\d+):(\d+)\$([^$]+)\$([0-9a-f]+)$/;
const SCRYPT_KEY_LEN = 64; // werkzeug uses dklen=64 (128 hex chars)

export function verifyWerkzeugScrypt(plaintext: string, stored: string): boolean {
  const match = SCRYPT_RE.exec(stored ?? "");
  if (!match) return false;
  const N = parseInt(match[1]!, 10);
  const r = parseInt(match[2]!, 10);
  const p = parseInt(match[3]!, 10);
  if (!Number.isFinite(N) || N <= 0) return false;
  if (!Number.isFinite(r) || r <= 0) return false;
  if (!Number.isFinite(p) || p <= 0) return false;
  // Defence against absurd parameters (someone smuggled in N=2^30 to OOM
  // the box). Cap at werkzeug's largest default plus headroom.
  if (N > 1 << 20 || r > 32 || p > 16) return false;
  const salt = match[4]!;
  const expectedHex = match[5]!;
  if (expectedHex.length !== SCRYPT_KEY_LEN * 2) return false;
  let derived: Buffer;
  try {
    // Node's default maxmem (32 MB) is just under what N=32768, r=8 needs.
    // Pass an explicit cushion so we don't get ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
    const maxmem = 256 * N * r * p;
    derived = scryptSync(plaintext, salt, SCRYPT_KEY_LEN, { N, r, p, maxmem });
  } catch {
    return false;
  }
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}
