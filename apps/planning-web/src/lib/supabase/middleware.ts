import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // ── Subdomain → tenant detection ─────────────────────────────────────────
  // In production: germanbutchery.tracey.app → subdomain = "germanbutchery"
  // In dev: all requests hit localhost, use X-Tracey-Tenant header or default
  const host = request.headers.get("host") ?? "";
  let subdomain = request.cookies.get("tracey-tenant")?.value ?? null;

  if (!subdomain) {
    const parts = host.split(".");
    // e.g. germanbutchery.tracey.app has 3 parts; localhost has 1
    if (parts.length >= 3) {
      subdomain = parts[0];
    } else {
      subdomain = "germanbutchery"; // dev default
    }
    supabaseResponse.cookies.set("tracey-tenant", subdomain, {
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
  }

  // Pass tenant subdomain downstream via request header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tracey-tenant", subdomain);

  supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Re-apply cookies to the new response
  const { data: { user: u2 } } = await supabase.auth.getUser();
  void u2;

  // ── Auth guard ───────────────────────────────────────────────────────────
  const pathname = request.nextUrl.pathname;
  const isAuthPage = pathname.startsWith("/auth/");
  const isPublic = isAuthPage || pathname === "/";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

// ── Resolve tenant_id from subdomain (server-side) ────────────────────────
export async function resolveTenantId(subdomain: string): Promise<string | null> {
  const { createClient } = await import("./admin");
  const admin = createAdminClient();
  const { data } = await admin.from("tenants").select("id").eq("subdomain", subdomain).single();
  return data?.id ?? null;
}

// Lazy import to avoid circular
function createAdminClient() {
  const { createClient: createSupabaseClient } = require("@supabase/supabase-js");
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
