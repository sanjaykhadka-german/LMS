// Auth.js Credentials authorize() for planning-web.
//
// Slice 0a transition strategy: Supabase Auth remains the source of truth for
// the password. On every sign-in we call supabase.auth.signInWithPassword,
// which (via the SSR cookie adapter) sets the Supabase session cookie on the
// response. That cookie keeps the existing RLS-by-cookie data fetches working
// for the rest of the app while feature modules are migrated in later slices.
//
// In parallel, we ensure an `app.users` row exists for this email so future
// slices have a stable Tracey user identity to FK against. The bcrypt hash is
// stored opportunistically — we switch to bcrypt-as-source-of-truth in a
// later slice once every user has gone through this flow at least once.

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, users } from "@tracey/db";
import { createClient } from "@/lib/supabase/server";
import { hashPassword } from "./passwords";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export interface AuthorizedUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  passwordChangedAt: number;
}

export async function authorizeCredentials(raw: unknown): Promise<AuthorizedUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  // Supabase is the password oracle in Slice 0a. signInWithPassword sets the
  // Supabase session cookie via the SSR cookie adapter, so legacy queries that
  // still go through the Supabase client continue to see an authenticated
  // session after this returns.
  const supabase = await createClient();
  const { data: sb, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !sb?.user) return null;

  // Ensure an app.users row exists. Email is the unique key; the Tracey user.id
  // is independent of Supabase's auth.users.id and is decided here at first
  // sign-in. The eventual data-migration slice (Slice 9) will reconcile both
  // identifiers per tenant.
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      name: existing.name ?? null,
      email: existing.email,
      image: existing.image ?? null,
      passwordChangedAt: existing.passwordChangedAt.getTime(),
    };
  }

  const now = new Date();
  const bcryptHash = await hashPassword(password);
  const supabaseName =
    (sb.user.user_metadata && typeof sb.user.user_metadata === "object"
      ? ((sb.user.user_metadata as Record<string, unknown>).full_name as string | undefined) ??
        ((sb.user.user_metadata as Record<string, unknown>).name as string | undefined)
      : undefined) ?? null;

  const [inserted] = await db
    .insert(users)
    .values({
      email,
      name: supabaseName,
      passwordHash: bcryptHash,
      emailVerified: sb.user.email_confirmed_at ? new Date(sb.user.email_confirmed_at) : now,
      passwordChangedAt: now,
    })
    .returning();

  if (!inserted) return null;

  return {
    id: inserted.id,
    name: inserted.name ?? null,
    email: inserted.email,
    image: inserted.image ?? null,
    passwordChangedAt: inserted.passwordChangedAt.getTime(),
  };
}
