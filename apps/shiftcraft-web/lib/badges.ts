// Centralised badge fills.
//
// Tailwind v4's @theme-inline tokens make the `bg-X-100 text-X-800` pairs
// render as low-contrast tints in this app's palette (cool-neutral
// background + violet primary). We standardise on solid mid-tone fills
// with white text so badges read clearly in both light and dark mode
// without per-call-site polish.
//
// Tone is the semantic intent, not the literal colour, so future palette
// shifts can land in one place.

export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "violet";

export const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-slate-500 text-white",
  info: "bg-blue-600 text-white",
  success: "bg-emerald-600 text-white",
  warning: "bg-amber-500 text-white",
  danger: "bg-red-600 text-white",
  violet: "bg-violet-600 text-white",
};

/** Apply this to inline-block pill spans for the standard pill look. */
export const BADGE_CHIP =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider";

// Banner / alert surfaces (whole-section tints, not pill chips). Same
// motivation as BADGE_TONE — light bg + light text under v4 reads as
// washed-out. Strong border + bold text fixes contrast without losing
// the soft-tint look.
export const ALERT_TONE = {
  success:
    "border-emerald-500/60 bg-emerald-50 text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-950/50 dark:text-emerald-100",
  warning:
    "border-amber-500/60 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/50 dark:text-amber-100",
  danger:
    "border-red-500/60 bg-red-50 text-red-900 dark:border-red-500/50 dark:bg-red-950/50 dark:text-red-100",
  info: "border-blue-500/60 bg-blue-50 text-blue-900 dark:border-blue-500/50 dark:bg-blue-950/50 dark:text-blue-100",
} as const;
