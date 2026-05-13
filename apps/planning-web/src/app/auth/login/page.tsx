"use client";

import { useState, useEffect, useRef } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoSigning, setAutoSigning] = useState(false);
  const autoSubmitRef = useRef(false);

  // Auto-fill from email link (?email=xxx&tmp=yyy) and auto-submit
  useEffect(() => {
    const emailParam = searchParams.get("email");
    const tmpParam = searchParams.get("tmp");

    if (emailParam && tmpParam) {
      // Clear params from URL immediately so they don't sit in browser history
      window.history.replaceState({}, "", "/auth/login");
      setEmail(emailParam);
      setPassword(tmpParam);
      setAutoSigning(true);
      // Auto-submit after a short delay so state is set
      setTimeout(async () => {
        if (autoSubmitRef.current) return;
        autoSubmitRef.current = true;
        const result = await signIn("credentials", {
          email: emailParam,
          password: tmpParam,
          redirect: false,
        });
        if (!result || result.error) {
          setError("Your login link has expired. Please contact your admin for new credentials.");
          setAutoSigning(false);
          return;
        }
        const loginRes = await fetch("/api/record-login", { method: "POST" }).catch(() => null);
        const loginData = await loginRes?.json().catch(() => ({}));
        if (loginData?.force_password_change) {
          router.push("/auth/change-password");
          router.refresh();
          return;
        }
        router.push("/dashboard");
        router.refresh();
      }, 300);
      return;
    }

    // Detect Supabase recovery hash fragments (from dashboard reset email)
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const type = params.get("type");
    if (type === "recovery") {
      router.replace("/auth/reset-password" + window.location.search + hash);
    }
  }, [router, searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });

    if (!result || result.error) {
      setError("Wrong email or password.");
      setLoading(false);
      return;
    }

    const loginRes = await fetch("/api/record-login", { method: "POST" }).catch(() => null);
    if (loginRes?.ok) {
      const loginData = await loginRes.json().catch(() => ({}));
      if (loginData.force_password_change) {
        router.push("/auth/change-password");
        router.refresh();
        return;
      }
    }
    router.push("/dashboard");
    router.refresh();
  }

  // Full-screen auto-sign-in state
  if (autoSigning) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f7f5" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: "64px", height: "64px", background: "#b91c1c", borderRadius: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "1.25rem" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l19-9-9 19-2-8-8-2z"/>
            </svg>
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "700", color: "#1c1917", margin: "0 0 0.5rem" }}>German Butchery</h1>
          {error ? (
            <div style={{ maxWidth: "360px", margin: "1rem auto 0" }}>
              <p style={{ color: "#b91c1c", fontSize: "0.875rem", marginBottom: "1rem" }}>{error}</p>
              <button onClick={() => { setAutoSigning(false); setError(null); }} className="btn-secondary">
                Back to login
              </button>
            </div>
          ) : (
            <p style={{ color: "#78716c", fontSize: "0.875rem" }}>Signing you in…</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f7f5" }}>
      <div style={{ width: "100%", maxWidth: "400px", padding: "0 1rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ width: "64px", height: "64px", background: "#b91c1c", borderRadius: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "1rem" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l19-9-9 19-2-8-8-2z"/>
            </svg>
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "700", color: "#1c1917", margin: 0 }}>German Butchery</h1>
          <p style={{ color: "#78716c", marginTop: "0.25rem", fontSize: "0.875rem" }}>Production Planning</p>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1.125rem", fontWeight: "600", color: "#1c1917", marginTop: 0, marginBottom: "1.5rem" }}>
            Sign in to your account
          </h2>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label className="form-label" htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                className="form-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@germanbutchery.com.au"
              />
            </div>

            <div>
              <label className="form-label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="form-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", justifyContent: "center", padding: "0.625rem" }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.8125rem", color: "#a8a29e" }}>
          German Butchery Pty Ltd · Internal use only
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f8f7f5" }} />}>
      <LoginInner />
    </Suspense>
  );
}
