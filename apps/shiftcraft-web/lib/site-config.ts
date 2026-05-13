// Cross-app launcher data — consumed by AppSwitcher.
// NEXT_PUBLIC_*_URL are inlined at build time by Next, so this module is
// safe to import from both server and client components.

const lmsUrl = process.env.NEXT_PUBLIC_LMS_URL || "http://localhost:4000";
const shiftcraftUrl = process.env.NEXT_PUBLIC_SHIFTCRAFT_URL || "http://localhost:4100";
const hubUrl = process.env.NEXT_PUBLIC_HUB_URL || "http://localhost:4200";

export const APPS = {
  lms: {
    id: "lms",
    name: "LMS",
    tagline: "Training & compliance",
    url: lmsUrl,
  },
  shiftcraft: {
    id: "shiftcraft",
    name: "ShiftCraft",
    tagline: "Scheduling & time off",
    url: shiftcraftUrl,
  },
  hub: {
    id: "hub",
    name: "Hub",
    tagline: "Account & billing",
    url: hubUrl,
  },
} as const;

export const CURRENT_APP_ID = "shiftcraft";
