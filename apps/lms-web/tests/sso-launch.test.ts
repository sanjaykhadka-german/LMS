import { describe, it, expect, vi, beforeAll } from "vitest";
import { jwtVerify } from "jose";

// The launch route imports requireUser/requireTenant from ~/lib/auth/current,
// which transitively pulls in Auth.js + Drizzle + Postgres. Stub the helper
// module so the test exercises just the JWT-minting + HTML-form rendering.
vi.mock("~/lib/auth/current", () => ({
  requireUser: vi.fn(async () => ({
    id: "11111111-1111-1111-1111-111111111111",
    email: "Owner@Example.Com",
    name: "Owner Person",
    image: null,
  })),
  requireTenant: vi.fn(async () => ({
    tenant: {
      id: "00000000-0000-0000-0000-000000000001",
      slug: "german-butchery",
      name: "German Butchery PTY LTD",
      status: "trialing",
      plan: "free",
    },
    role: "owner",
  })),
}));

const SECRET = "test-sso-secret-do-not-use-in-prod";

beforeAll(() => {
  process.env.LMS_SSO_SECRET = SECRET;
  process.env.FLASK_BASE_URL = "http://flask.test";
});

async function loadRoute() {
  return await import("../app/api/sso/launch/route");
}

describe("GET /api/sso/launch", () => {
  it("returns an HTML form posting to Flask /sso/callback", async () => {
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    const body = await res.text();
    expect(body).toContain('action="http://flask.test/sso/callback"');
    expect(body).toContain('method="POST"');
    expect(body).toContain('name="token"');
  });

  it("mints a JWT with correct issuer, audience, sub, email, tenant claims", async () => {
    const { GET } = await loadRoute();
    const res = await GET();
    const body = await res.text();
    const match = body.match(/name="token" value="([^"]+)"/);
    expect(match, "form must include a token input").not.toBeNull();
    const token = match?.[1];
    expect(token).toBeTruthy();
    if (!token) throw new Error("unreachable");

    const { payload, protectedHeader } = await jwtVerify(
      token,
      new TextEncoder().encode(SECRET),
      { issuer: "tracey", audience: "flask-lms" },
    );
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.sub).toBe("11111111-1111-1111-1111-111111111111");
    expect(payload.email).toBe("owner@example.com"); // lowercased
    expect(payload.name).toBe("Owner Person");
    expect(payload.tenant_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(payload.tenant_slug).toBe("german-butchery");
    expect(payload.tenant_status).toBe("trialing");
    expect(payload.role).toBe("owner");
    expect(typeof payload.jti).toBe("string");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    // 60-second expiry window.
    expect((payload.exp as number) - (payload.iat as number)).toBe(60);
  });

  it("returns 500 when LMS_SSO_SECRET is missing", async () => {
    const original = process.env.LMS_SSO_SECRET;
    delete process.env.LMS_SSO_SECRET;
    try {
      vi.resetModules();
      const { GET } = await loadRoute();
      const res = await GET();
      expect(res.status).toBe(500);
    } finally {
      process.env.LMS_SSO_SECRET = original;
      vi.resetModules();
    }
  });
});
