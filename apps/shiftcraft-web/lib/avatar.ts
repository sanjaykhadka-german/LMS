// Avatar-helper utilities.
//
// We don't run an upload pipeline (no blob storage on the free Render
// tier per memory), so avatars are "paste a URL" for now — Gravatar,
// LinkedIn, the user's own host, whatever. When no image is set we
// fall back to coloured initials whose colour is deterministic on the
// person's email so the same human gets the same swatch everywhere.

const AVATAR_COLOURS = [
  // Hand-picked accent-ish hues with white-on-tone contrast that work
  // in both light and dark mode. Saturation kept similar so the row
  // doesn't look noisy when several show in sequence.
  "#7c1f1f", // butcher red
  "#1b2845", // navy
  "#0f766e", // teal
  "#7c2d12", // burnt orange
  "#4338ca", // indigo
  "#9d174d", // berry
  "#166534", // forest
  "#0369a1", // sky
  "#7e22ce", // violet
  "#a16207", // mustard
] as const;

/**
 * Stable colour for a given email. We avoid Math.random / Date so the
 * server and client render the same swatch — Tracey's avatar shows up
 * in the sidebar and on the page, and they must agree.
 *
 * Hash is a tiny FNV-1a variant: enough spread for ~10 buckets without
 * pulling in crypto.
 */
export function avatarColourFor(email: string): string {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < email.length; i++) {
    hash ^= email.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]!;
}

/**
 * 1-2 character initial set from a display name, falling back to the
 * first letter of the email when name is blank. Always returns
 * uppercase so it sits cleanly inside a coloured circle.
 */
export function initialsFor(name: string | null, email: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length > 0) {
    const parts = trimmed.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email[0] ?? "?").toUpperCase();
}

/**
 * Light URL gate for the settings form. Accepts http/https URLs only —
 * we don't want a data: URL (storage abuse) or a javascript: URL
 * (obvious XSS) landing in app.users.image, which is rendered inside an
 * <img src>. Returns the trimmed URL when valid, null when blank.
 * Throws when invalid so the calling action surfaces a field error.
 */
export function validateAvatarUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 1000) {
    throw new Error("Avatar URL is too long (1000 char max).");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Avatar URL must be a full http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Avatar URL must use http or https.");
  }
  return trimmed;
}
