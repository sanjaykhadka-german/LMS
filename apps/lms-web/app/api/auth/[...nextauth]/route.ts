// Auth.js API handler. Exposes /api/auth/* endpoints (signin, signout,
// callback, csrf, session, providers, etc.) used by the client and the
// server-side helpers exported from `auth.ts`.
import { handlers } from "~/auth";

export const { GET, POST } = handlers;
