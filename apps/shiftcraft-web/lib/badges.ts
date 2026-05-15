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

// Banner / alert surfaces. Tailwind v4's @theme-inline palette renders
// the typical `bg-X-50 + text-X-900` pair as a muddy low-contrast tint
// (the bg looks darker than expected and the text washes out). The
// reliable fix in this app is a solid coloured fill with white text,
// matching the BADGE_TONE pattern.
//
// Each tone provides:
//   - `solid`: the banner body — full-colour bg + white text + matching border
//   - `accent`: a small chip used inside the banner (icon background etc.)
export const ALERT_TONE = {
  success: {
    solid: "bg-emerald-600 text-white border-emerald-700",
    accent: "bg-emerald-800 text-white",
  },
  warning: {
    solid: "bg-amber-500 text-white border-amber-600",
    accent: "bg-amber-700 text-white",
  },
  danger: {
    solid: "bg-red-600 text-white border-red-700",
    accent: "bg-red-800 text-white",
  },
  info: {
    solid: "bg-blue-600 text-white border-blue-700",
    accent: "bg-blue-800 text-white",
  },
} as const;
