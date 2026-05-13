// ESLint flat-config for planning-web. Aligned with apps/lms-web/eslint.config.mjs
// (direct flat-config import from eslint-config-next/core-web-vitals) after
// Next.js 16 removed `next lint`. The previous FlatCompat shim hit a
// circular-config crash under pnpm workspace dep resolution — direct import
// is the supported Next 16 pattern.

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...nextCoreWebVitals,
  {
    ignores: [
      ".next/**",
      ".turbo/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      "out/**",
      "next-env.d.ts",
      "supabase/migrations/**",
    ],
  },
  // Project-wide rule tuning — match lms-web's pattern for noisy React 19 /
  // eslint-plugin-react-hooks v7 rules that misfire on legitimate patterns
  // (online/offline sync, IndexedDB poll, cache prime).
  {
    rules: {
      // v7 new strict rule: bans `Date.now()` / `Math.random()` in render.
      // Disabled to match lms-web's posture.
      "react-hooks/purity": "off",
      // v7 new strict rule: bans setState directly inside useEffect bodies.
      // Planning has legitimate cases — online/offline listeners, IndexedDB
      // cache prime, sync polling. Demoted to warn so it shows but doesn't
      // gate CI; revisit per-call-site later.
      "react-hooks/set-state-in-effect": "warn",
      // Apostrophes in plain JSX text trigger this rule. Modern React
      // handles them fine; the &apos; suggestion is noise.
      "react/no-unescaped-entities": "off",
      // Switching from <img> to next/image is good practice but not
      // load-bearing — demote from error to warning.
      "@next/next/no-img-element": "warn",
    },
  },
];

export default config;
