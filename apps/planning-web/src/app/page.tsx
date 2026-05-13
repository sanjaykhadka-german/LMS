import Link from "next/link";

// Public landing page for planning-web. Intentionally stays OUTSIDE the
// (app) route group so it doesn't hit the auth-gated AppLayout (and the
// Supabase profile/department lookups that layout makes). Visitors who
// want into the app click through to /auth/login, which redirects to
// /dashboard on successful sign-in (per auth.config.ts authorized callback).

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.5rem",
        background: "#f8f7f5",
      }}
    >
      <div style={{ width: "100%", maxWidth: "560px", textAlign: "center" }}>
        <div
          style={{
            width: "72px",
            height: "72px",
            background: "var(--color-brand)",
            borderRadius: "18px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "1.5rem",
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 11l19-9-9 19-2-8-8-2z" />
          </svg>
        </div>

        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 700,
            color: "#1c1917",
            margin: "0 0 0.5rem",
            letterSpacing: "-0.02em",
          }}
        >
          Tracey — Production Planning
        </h1>
        <p
          style={{
            color: "#78716c",
            fontSize: "1rem",
            margin: "0 0 2rem",
            lineHeight: 1.55,
          }}
        >
          MRP, BOMs, costings, and traceability for small-to-mid food manufacturers.
        </p>

        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/auth/login"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.75rem 1.5rem",
              background: "var(--color-brand)",
              color: "white",
              borderRadius: "0.5rem",
              fontWeight: 600,
              fontSize: "0.9375rem",
              textDecoration: "none",
              transition: "background 0.15s",
            }}
          >
            Sign in
          </Link>
          <Link
            href="/dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.75rem 1.5rem",
              background: "white",
              color: "#1c1917",
              border: "1px solid #d6d3d1",
              borderRadius: "0.5rem",
              fontWeight: 600,
              fontSize: "0.9375rem",
              textDecoration: "none",
              transition: "background 0.15s",
            }}
          >
            Open dashboard
          </Link>
        </div>

        <div
          style={{
            marginTop: "3rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "1rem",
            textAlign: "left",
          }}
        >
          <FeatureCard
            title="Plan"
            body="Weekly demand plans cascade into batch-sized production orders."
          />
          <FeatureCard
            title="Cost"
            body="Live BOM cost cascade with supplier and FX support."
          />
          <FeatureCard
            title="Trace"
            body="Lot numbers link raw material receipts to finished-good dispatch."
          />
        </div>

        <p
          style={{
            marginTop: "3rem",
            fontSize: "0.8125rem",
            color: "#a8a29e",
          }}
        >
          German Butchery Pty Ltd · part of the Tracey suite
        </p>
      </div>
    </main>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e7e5e4",
        borderRadius: "0.625rem",
        padding: "1rem",
      }}
    >
      <h2
        style={{
          fontSize: "0.875rem",
          fontWeight: 700,
          color: "var(--color-brand)",
          margin: "0 0 0.375rem",
          letterSpacing: "0.02em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontSize: "0.8125rem",
          color: "#57534e",
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {body}
      </p>
    </div>
  );
}
