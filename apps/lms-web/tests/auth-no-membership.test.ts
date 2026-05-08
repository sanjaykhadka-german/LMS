// Regression test for the "new Tracey signup can't sign in" bug.
//
// Before the fix, authorizeCredentials() returned null for any user that
// didn't have an app.members row — even if their bcrypt password and
// emailVerified were both fine. New signups (which create app.users +
// password but no membership until /onboarding) were permanently locked
// out.
//
// This test seeds a synthetic user with bcrypt + emailVerified set, NO
// membership, and asserts authorizeCredentials() returns the user.
// Plus a sanity case where the bcrypt hash doesn't match → still null.
//
// Hits the LIVE local-dev DB. Skipped automatically if DATABASE_URL
// points somewhere that isn't a real Postgres.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, users } from "@tracey/db";
import { authorizeCredentials } from "../lib/auth/credentials-authorize";

const isLiveDb =
  !!process.env.DATABASE_URL && !/test:test@/.test(process.env.DATABASE_URL);

const PROBE_EMAIL = "auth-fix-no-membership@example.test";
const PROBE_PASSWORD = "phase-7-fix-pass-1";

describe.skipIf(!isLiveDb)("authorizeCredentials — membership not required", () => {
  let userId: string;

  beforeAll(async () => {
    // Wipe any stale state from prior runs (idempotent).
    await db.delete(users).where(eq(users.email, PROBE_EMAIL));

    const passwordHash = await bcrypt.hash(PROBE_PASSWORD, 10);
    const [row] = await db
      .insert(users)
      .values({
        email: PROBE_EMAIL,
        name: "Auth Fix Probe",
        passwordHash,
        emailVerified: new Date(), // verified — but no membership row
      })
      .returning({ id: users.id });
    if (!row) throw new Error("seed: failed to insert app.users row");
    userId = row.id;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.email, PROBE_EMAIL));
  });

  it("returns the user when bcrypt + emailVerified pass, even without a membership", async () => {
    const result = await authorizeCredentials({
      email: PROBE_EMAIL,
      password: PROBE_PASSWORD,
    });
    expect(result, "authorizeCredentials returned null for a valid no-membership user").not.toBeNull();
    expect(result?.id).toBe(userId);
    expect(result?.email).toBe(PROBE_EMAIL);
    expect(result?.name).toBe("Auth Fix Probe");
  });

  it("returns null when the password is wrong (bcrypt mismatch, no Flask fallback)", async () => {
    const result = await authorizeCredentials({
      email: PROBE_EMAIL,
      password: "definitely-not-the-right-password",
    });
    expect(
      result,
      "authorizeCredentials should not let a wrong password through, even without membership",
    ).toBeNull();
  });

  it("throws EmailNotVerified for an unverified user", async () => {
    const unverifiedEmail = "auth-fix-unverified@example.test";
    await db.delete(users).where(eq(users.email, unverifiedEmail));
    await db.insert(users).values({
      email: unverifiedEmail,
      name: "Unverified Probe",
      passwordHash: await bcrypt.hash(PROBE_PASSWORD, 10),
      // No emailVerified.
    });

    await expect(
      authorizeCredentials({ email: unverifiedEmail, password: PROBE_PASSWORD }),
    ).rejects.toThrow("EmailNotVerified");

    await db.delete(users).where(eq(users.email, unverifiedEmail));
  });

  it("returns null for a totally unknown email (no Tracey row, no Flask row)", async () => {
    const result = await authorizeCredentials({
      email: "nobody-here-anywhere@example.test",
      password: "whatever",
    });
    expect(result).toBeNull();
  });
});
