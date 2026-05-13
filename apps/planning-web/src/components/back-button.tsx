"use client";

import { useRouter } from "next/navigation";

interface BackButtonProps {
  /** If provided, navigate to this URL instead of history.back() */
  href?: string;
  /** Label shown after the arrow. Defaults to "Back". */
  label?: string;
  /**
   * Optional sessionStorage key. If set and a value exists, the button
   * navigates to that stored URL instead — used to restore list filters
   * when returning from a detail page. Falls back to `href` (or
   * history.back) if missing.
   */
  rememberKey?: string;
}

export function BackButton({ href, label = "Back", rememberKey }: BackButtonProps) {
  const router = useRouter();

  function go() {
    if (rememberKey) {
      try {
        const saved = sessionStorage.getItem(rememberKey);
        if (saved) { router.push(saved); return; }
      } catch { /* ignore */ }
    }
    if (href) router.push(href);
    else router.back();
  }

  return (
    <button
      onClick={go}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        background: "none",
        border: "none",
        padding: "0.5rem 0.75rem 0.5rem 0.375rem",
        borderRadius: "0.5rem",
        fontSize: "0.9375rem",
        fontWeight: "500",
        color: "#78716c",
        cursor: "pointer",
        transition: "color 0.15s, background 0.15s",
        lineHeight: 1,
        marginBottom: "0.25rem",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.color = "#1c1917";
        (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f4";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.color = "#78716c";
        (e.currentTarget as HTMLButtonElement).style.background = "none";
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
      {label}
    </button>
  );
}
