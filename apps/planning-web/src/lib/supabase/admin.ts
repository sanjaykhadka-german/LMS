import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS. Use only in server-side admin actions.
// Mirrors the env-guard pattern in ./server.ts: if Supabase keys aren't set,
// return a chainable no-op stub so pages don't crash mid-render. See the
// migration plan (Phase 4) for the real fix — every admin-client call site
// gets ported off Supabase onto @tracey/db.

function hasAdminEnv() {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

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

const stubAdminClient = {
  auth: {
    admin: {
      createUser: async () => ({ data: null, error: { message: "Supabase not configured" } }),
      listUsers: async () => ({ data: { users: [] }, error: null }),
      getUserById: async () => ({ data: null, error: { message: "Supabase not configured" } }),
      updateUserById: async () => ({ data: null, error: { message: "Supabase not configured" } }),
      deleteUser: async () => ({ data: null, error: { message: "Supabase not configured" } }),
      generateLink: async () => ({ data: null, error: { message: "Supabase not configured" } }),
    },
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

export function createAdminClient() {
  if (!hasAdminEnv()) {
    return stubAdminClient as unknown as ReturnType<typeof createClient>;
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
