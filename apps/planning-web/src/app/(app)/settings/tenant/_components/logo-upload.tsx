"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "tenant-branding";
const MAX_SIZE_MB = 2;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];

interface LogoUploadProps {
  tenantId: string;
  initialLogoUrl: string | null;
  onChanged: (path: string | null) => void;
}

export default function LogoUpload({ tenantId, initialLogoUrl, onChanged }: LogoUploadProps) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [logoPath, setLogoPath] = useState<string | null>(initialLogoUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!logoPath) { setPreviewUrl(null); return; }
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(logoPath, 3600);
      if (active) setPreviewUrl(data?.signedUrl ?? null);
    })();
    return () => { active = false; };
  }, [logoPath, supabase]);

  async function persistLogoUrl(path: string | null): Promise<string | null> {
    const { data, error: dbErr } = await supabase
      .from("tenants")
      .update({ logo_url: path })
      .eq("id", tenantId)
      .select("id");
    if (dbErr) return dbErr.message;
    if (!data || data.length === 0) {
      return "Update returned no rows — likely blocked by row-level security. Run migration 041 to grant UPDATE on tenants.";
    }
    return null;
  }

  async function handleFile(file: File) {
    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError("Logo must be PNG, JPEG, WebP or SVG.");
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`Logo must be under ${MAX_SIZE_MB} MB.`);
      return;
    }

    setBusy(true);
    try {
      // Remove the previous logo (best effort) so we don't accumulate orphans.
      if (logoPath) {
        await supabase.storage.from(BUCKET).remove([logoPath]);
      }

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${tenantId}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`);
        setBusy(false);
        return;
      }
      const dbErr = await persistLogoUrl(path);
      if (dbErr) {
        setError(`Saved file but couldn't update tenant: ${dbErr}`);
        setBusy(false);
        return;
      }
      setLogoPath(path);
      onChanged(path);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!logoPath) return;
    setBusy(true);
    setError(null);
    await supabase.storage.from(BUCKET).remove([logoPath]);
    const dbErr = await persistLogoUrl(null);
    if (dbErr) {
      setError(`Couldn't update tenant: ${dbErr}`);
      setBusy(false);
      return;
    }
    setLogoPath(null);
    onChanged(null);
    setBusy(false);
  }

  return (
    <div>
      <label className="form-label">Logo</label>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <div style={{
          width: 80, height: 80, borderRadius: "0.5rem",
          border: "1px solid #e7e5e4", background: "#fafaf9",
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        }}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          ) : (
            <span style={{ fontSize: "0.75rem", color: "#a8a29e" }}>No logo</span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            style={{ fontSize: "0.8125rem" }}
          >
            {busy ? "Uploading…" : logoPath ? "Replace logo" : "Upload logo"}
          </button>
          {logoPath && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              style={{
                fontSize: "0.75rem", background: "none", border: "none",
                color: "#dc2626", cursor: "pointer", padding: 0, textAlign: "left",
              }}
            >
              Remove
            </button>
          )}
          <div style={{ fontSize: "0.75rem", color: "#a8a29e" }}>
            PNG · JPEG · WebP · SVG — max {MAX_SIZE_MB} MB
          </div>
          <div style={{ fontSize: "0.6875rem", color: "#15803d" }}>
            Logo is saved automatically on upload.
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
      {error && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "#dc2626" }}>
          {error}
        </div>
      )}
    </div>
  );
}
