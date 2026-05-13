// Single source of truth for cross-app URLs.
//
// In dev, each app runs on its own port (hub 4200, lms 4000, shifts 4100,
// planning 4300) and the defaults below "just work". In production these
// are overridden by env vars so the hub can point at the real subdomains
// (or paths) without code changes:
//
//   NEXT_PUBLIC_HUB_URL=https://tracey.app
//   NEXT_PUBLIC_LMS_URL=https://lms.tracey.app
//   NEXT_PUBLIC_SHIFTCRAFT_URL=https://shifts.tracey.app
//   NEXT_PUBLIC_PLANNING_URL=https://planning.tracey.app
//
// Same module is imported by lms-web and shiftcraft-web so the switcher
// renders consistent links everywhere.

export type AppId = "hub" | "lms" | "shiftcraft" | "planning";

export interface AppDescriptor {
  id: AppId;
  name: string;
  tagline: string;
  url: string;
}

const env = (key: string, fallback: string): string => {
  const raw = process.env[key];
  return raw && raw.length > 0 ? raw : fallback;
};

export const APPS: Record<AppId, AppDescriptor> = {
  hub: {
    id: "hub",
    name: "Hub",
    tagline: "Account, billing, and your apps",
    url: env("NEXT_PUBLIC_HUB_URL", "http://localhost:4200"),
  },
  lms: {
    id: "lms",
    name: "Tracey LMS",
    tagline: "Training and compliance",
    url: env("NEXT_PUBLIC_LMS_URL", "http://localhost:4000"),
  },
  shiftcraft: {
    id: "shiftcraft",
    name: "ShiftCraft",
    tagline: "Employee shift scheduling",
    url: env("NEXT_PUBLIC_SHIFTCRAFT_URL", "http://localhost:4100"),
  },
  planning: {
    id: "planning",
    name: "Tracey Planning",
    tagline: "Production planning and MRP",
    url: env("NEXT_PUBLIC_PLANNING_URL", "http://localhost:4300"),
  },
};

export const SWITCHABLE_APPS: AppDescriptor[] = [APPS.lms, APPS.shiftcraft, APPS.planning];
