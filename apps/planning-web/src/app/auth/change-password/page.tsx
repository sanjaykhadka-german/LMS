"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }

    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) { setError(updateErr.message); setLoading(false); return; }

    // Clear the force_password_change flag via API
    await fetch("/api/clear-password-flag", { method: "POST" }).catch(() => {});

    router.push("/dashboard");
    router.refresh();
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
          <h2 style={{ fontSize: "1.125rem", fontWeight: "600", color: "#1c1917", marginTop: 0, marginBottom: "0.375rem" }}>
            Set your password
          </h2>
          <p style={{ color: "#78716c", fontSize: "0.875rem", margin: "0 0 1.5rem" }}>
            Choose a new password to secure your account. You only need to do this once.
          </p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
            {error && <p style={{ color: "#b91c1c", fontSize: "0.875rem", margin: 0 }}>{error}</p>}
            <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: "0.25rem" }}>
              {loading ? "Saving…" : "Set password & continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
