import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, users } from "@tracey/db";
import { verifyPassword } from "./passwords";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
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

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user || !user.passwordHash) return null;
  if (!user.emailVerified) throw new Error("EmailNotVerified");
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;

  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email,
    image: user.image ?? null,
    passwordChangedAt: user.passwordChangedAt.getTime(),
  };
}
