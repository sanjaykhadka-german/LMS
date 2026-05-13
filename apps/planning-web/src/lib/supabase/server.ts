import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// During the planning-web → Tracey-Postgres migration (Phase 4 of
// ~/.claude/plans/i-will-be-running-warm-badger.md), feature pages still
// call Supabase for data they haven't yet been rewritten to fetch via
// @tracey/db. If the workspace .env / apps/planning-web/.env.local has
// no Supabase keys, returning a working stub here lets dev pages render
// with empty data instead of throwing at render time. Real Supabase is
// used whenever the env is set; the stub kicks in only as a fallback.

function hasSupabaseEnv() {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Stub query builder — chainable, awaitable, returns { data: null, error: ... }.
// Every method on it (select, eq, in, order, limit, single, maybeSingle,
// insert, update, delete, upsert, etc.) returns the same thenable, so the
// existing call patterns like
//   await supabase.from("x").select("y").eq("z", v).single()
// still resolve. Callers using `data ?? []` or `data?.foo` stay safe.
function makeStubBuilder(): unknown {
  const result = { data: null, error: { message: "Supabase not configured" } };
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: typeof result) => unknown) => resolve(result);
      }
      if (prop === "catch" || prop === "finally") {
        return () => makeStubBuilder();
      }
      return () => makeStubBuilder();
    },
  };
  return new Proxy({}, handler);
}

const stubClient = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    signInWithPassword: async () => ({
      data: { user: null, session: null },
      error: { message: "Supabase not configured" },
    }),
    signOut: async () => ({ error: null }),
  },
  from: () => makeStubBuilder(),
  rpc: async () => ({ data: null, error: { message: "Supabase not configured" } }),
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: { message: "Supabase not configured" } }),
      download: async () => ({ data: null, error: { message: "Supabase not configured" } }),
      remove: async () => ({ data: null, error: { message: "Supabase not configured" } }),
      list: async () => ({ data: [], error: null }),
      getPublicUrl: () => ({ data: { publicUrl: "" } }),
      createSignedUrl: async () => ({ data: null, error: { message: "Supabase not configured" } }),
    }),
  },
};

export async function createClient() {
  if (!hasSupabaseEnv()) {
    return stubClient as unknown as ReturnType<typeof createServerClient>;
  }
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Ignore — read-only context (e.g. Server Component)
          }
        },
      },
    },
  );
}
