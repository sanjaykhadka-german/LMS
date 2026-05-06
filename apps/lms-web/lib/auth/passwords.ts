import "server-only";
import bcrypt from "bcryptjs";

const ROUNDS = 12; // ~250ms on a modern laptop

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
