"use client";

// Browser-side wrapper that mirrors the Supabase storage API shape so swaps
// from `supabase.storage.from(b).upload(...)` etc. are a one-line import +
// rename. Server-side code should import from `@/lib/storage` instead.

type Result<T> = { data: T; error: null } | { data: null; error: { message: string } };

async function readError(r: Response): Promise<{ message: string }> {
  try {
    const j = (await r.json()) as { error?: string };
    return { message: j.error ?? r.statusText };
  } catch {
    return { message: r.statusText };
  }
}

export function traceyStorage() {
  return {
    from(bucket: string) {
      return {
        async upload(
          path: string,
          file: Blob,
          opts?: { contentType?: string; upsert?: boolean },
        ): Promise<Result<{ path: string }>> {
          const fd = new FormData();
          fd.set("bucket", bucket);
          fd.set("path", path);
          if (opts?.upsert) fd.set("upsert", "1");
          if (opts?.contentType) fd.set("contentType", opts.contentType);
          fd.set("file", file);
          const r = await fetch("/api/storage/upload", { method: "POST", body: fd });
          if (!r.ok) return { data: null, error: await readError(r) };
          return { data: { path }, error: null };
        },

        async createSignedUrl(
          path: string,
          expiresInSeconds: number,
        ): Promise<Result<{ signedUrl: string }>> {
          const r = await fetch("/api/storage/signed-url", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ bucket, path, expiresIn: expiresInSeconds }),
          });
          if (!r.ok) return { data: null, error: await readError(r) };
          const { url } = (await r.json()) as { url: string };
          return { data: { signedUrl: url }, error: null };
        },

        async remove(paths: string[]): Promise<Result<{ paths: string[] }>> {
          const r = await fetch("/api/storage/remove", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ bucket, paths }),
          });
          if (!r.ok) return { data: null, error: await readError(r) };
          return { data: { paths }, error: null };
        },
      };
    },
  };
}
