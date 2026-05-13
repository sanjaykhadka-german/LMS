"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [readyToConfirm, setReadyToConfirm] = useState(false);
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  const [hashFragment, setHashFragment] = useState<{ access_token: string; refresh_token: string } | null>(null);

  useEffect(() => {
    // Detect token but do NOT verify yet — prevents email scanners consuming it
    const th = searchParams.get("token_hash");
    const type = searchParams.get("type");

    if (th && type === "recovery") {
      setTokenHash(th);
      setReadyToConfirm(true);
      return;
    }

    if (typeof window !== "undefined" && window.location.hash) {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      if (params.get("type") === "recovery") {
        const at = params.get("access_token");
        const rt = params.get("refresh_token");
        if (at && rt) {
          setHashFragment({ access_token: at, refresh_token: rt });
          setReadyToConfirm(true);
          return;
        }
      }
    }

    createClient().auth.getSession().then(({ data: { session } }) => {
      if (session) setVerified(true);
      else setError("No reset token found. Please use the link from your password reset email.");
    });
  }, [searchParams]);

  async function confirmReset() {
    setVerifying(true);
    setError(null);
    const supabase = createClient();

    if (tokenHash) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
      if (error) {
        setError("This reset link has expired or already been used. Please ask your admin to send a new one.");
        setVerifying(false);
        return;
      }
    } else if (hashFragment) {
      const { error } = await supabase.auth.setSession(hashFragment);
      if (error) {
        setError("This reset link has expired or already been used. Please ask your admin to send a new one.");
        setVerifying(false);
        return;
      }
    }

    setReadyToConfirm(false);
    setVerified(true);
    setVerifying(false);
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f7f5" }}>
      <div style={{ width: "100%", maxWidth: "400px", padding: "0 1rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{
            width: "64px", height: "64px",
            background: "#b91c1c", borderRadius: "16px",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            marginBottom: "1rem"
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l19-9-9 19-2-8-8-2z"/>
            </svg>
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: "700", color: "#1c1917", margin: 0 }}>German Butchery</h1>
          <p style={{ color: "#78716c", marginTop: "0.25rem", fontSize: "0.875rem" }}>Production Planning</p>
        </div>

        <div className="card">
          {readyToConfirm && !verified ? (
            <>
              <h2 style={{ fontSize: "1.125rem", fontWeight: "600", color: "#1c1917", marginTop: 0, marginBottom: "0.75rem" }}>
                Reset your password
              </h2>
              <p style={{ color: "#57534e", fontSize: "0.875rem", margin: "0 0 1.5rem" }}>
                Click the button below to continue to the password reset form.
              </p>
              {error && <p style={{ color: "#b91c1c", fontSize: "0.875rem", margin: "0 0 1rem" }}>{error}</p>}
              <button onClick={confirmReset} disabled={verifying} className="btn-primary" style={{ width: "100%" }}>
                {verifying ? "Verifying…" : "Continue to reset password"}
              </button>
            </>
          ) : verifying ? (
            <div style={{ textAlign: "center", padding: "1.5rem 0", color: "#78716c" }}>
              Verifying…
            </div>
          ) : error && !verified ? (
            <>
              <h2 style={{ fontSize: "1.125rem", fontWeight: "600", color: "#1c1917", marginTop: 0, marginBottom: "0.75rem" }}>
                Reset link problem
              </h2>
              <p style={{ color: "#b91c1c", fontSize: "0.875rem", margin: "0 0 1.25rem" }}>{error}</p>
              <a href="/auth/login" style={{ color: "#b91c1c", fontSize: "0.875rem" }}>← Back to login</a>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: "1.125rem", fontWeight: "600", color: "#1c1917", marginTop: 0, marginBottom: "0.375rem" }}>
                Set a new password
              </h2>
              <p style={{ color: "#78716c", fontSize: "0.875rem", margin: "0 0 1.5rem" }}>
                Choose a new password for your account.
              </p>

              <form onSubmit={handleSetPassword} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                  <label className="form-label" htmlFor="password">New password</label>
                  <input
                    id="password"
                    type="password"
                    className="form-input"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="At least 8 characters"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="confirm">Confirm password</label>
                  <input
                    id="confirm"
                    type="password"
                    className="form-input"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    placeholder="Repeat your password"
                  />
                </div>

                {error && (
                  <p style={{ color: "#b91c1c", fontSize: "0.875rem", margin: 0 }}>{error}</p>
                )}

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={loading}
                  style={{ marginTop: "0.25rem" }}
                >
                  {loading ? "Saving…" : "Set new password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f8f7f5" }} />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
