import Link from "next/link";
import { and, eq, gt } from "drizzle-orm";
import { db, users, verificationTokens } from "@tracey/db";

interface SearchParams {
  token?: string;
  email?: string;
  sent?: string;
}

async function consumeToken(email: string, token: string): Promise<"ok" | "expired" | "invalid"> {
  const now = new Date();
  const [vt] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(eq(verificationTokens.identifier, email), eq(verificationTokens.token, token)),
    )
    .limit(1);
  if (!vt) return "invalid";
  if (vt.expires < now) {
    await db
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, email),
          eq(verificationTokens.token, token),
        ),
      );
    return "expired";
  }

  await db.update(users).set({ emailVerified: now }).where(eq(users.email, email));
  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, email),
        eq(verificationTokens.token, token),
      ),
    );
  return "ok";
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { token, email, sent } = await searchParams;

  // Mode 1: arrived from sign-up — nothing to verify yet, just tell them to check inbox.
  if (sent && email && !token) {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          We sent a verification link to <strong>{email}</strong>. Click it to finish
          setting up your account.
        </p>
        <p className="mt-4 text-xs text-[color:var(--muted-foreground)]">
          Didn't get it? Check spam, or{" "}
          <Link href={`/sign-up?email=${encodeURIComponent(email)}`} className="underline">
            try again
          </Link>
          .
        </p>
      </Centered>
    );
  }

  // Mode 2: clicked link — verify the token.
  if (token && email) {
    const result = await consumeToken(email, token);
    if (result === "ok") {
      return (
        <Centered>
          <h1 className="text-2xl font-semibold tracking-tight">Email verified</h1>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            Your email <strong>{email}</strong> is confirmed. You can now sign in.
          </p>
          <Link
            href={`/sign-in?email=${encodeURIComponent(email)}`}
            className="mt-6 inline-flex items-center justify-center rounded-md bg-[color:var(--primary)] px-4 py-2 text-sm font-medium text-[color:var(--primary-foreground)] shadow"
          >
            Sign in
          </Link>
        </Centered>
      );
    }
    if (result === "expired") {
      return (
        <Centered>
          <h1 className="text-2xl font-semibold tracking-tight">Link expired</h1>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            This verification link has expired. Sign up again to get a fresh one.
          </p>
          <Link
            href={`/sign-up?email=${encodeURIComponent(email)}`}
            className="mt-6 inline-flex items-center justify-center rounded-md border border-[color:var(--border)] px-4 py-2 text-sm font-medium shadow-sm"
          >
            Resend verification
          </Link>
        </Centered>
      );
    }
    return (
      <Centered>
        <h1 className="text-2xl font-semibold tracking-tight">Invalid link</h1>
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          We couldn't verify this link. It may have already been used.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 inline-flex items-center justify-center rounded-md border border-[color:var(--border)] px-4 py-2 text-sm font-medium shadow-sm"
        >
          Go to sign in
        </Link>
      </Centered>
    );
  }

  return (
    <Centered>
      <h1 className="text-2xl font-semibold tracking-tight">Verify your email</h1>
      <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
        Open the verification link we sent to your inbox.
      </p>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">{children}</div>
    </div>
  );
}
// Suppress "unused import" lint — we only use `gt` if we extend with cleanup logic.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _gt = gt;
