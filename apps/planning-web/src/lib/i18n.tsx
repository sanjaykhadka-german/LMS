"use client";

/**
 * Lightweight custom i18n — compatible with Next.js 16 App Router.
 *
 * Usage in client components:
 *   const { t } = useTranslation();
 *   t("common.save")  →  "Save"  (or translated equivalent)
 *
 * In server components, import getServerTranslations() from this file
 * and call it with the user's language from their profile.
 */

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SupportedLocale = "en" | "de";

export const SUPPORTED_LOCALES: { code: SupportedLocale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
];

// Deeply-nested JSON translation object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Messages = Record<string, any>;

// ── Context ───────────────────────────────────────────────────────────────────

interface I18nContextValue {
  locale: SupportedLocale;
  messages: Messages;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  messages: {},
  t: (key) => key,
});

// ── Provider ──────────────────────────────────────────────────────────────────

interface I18nProviderProps {
  locale: SupportedLocale;
  messages: Messages;
  children: ReactNode;
}

export function I18nProvider({ locale, messages, children }: I18nProviderProps) {
  function t(key: string, vars?: Record<string, string | number>): string {
    const parts = key.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let val: any = messages;
    for (const part of parts) {
      if (val == null || typeof val !== "object") return key;
      val = val[part];
    }
    if (typeof val !== "string") return key;

    // Simple variable interpolation: {varName}
    if (vars) {
      return val.replace(/\{(\w+)\}/g, (_: string, name: string) =>
        vars[name] != null ? String(vars[name]) : `{${name}}`
      );
    }
    return val;
  }

  return (
    <I18nContext.Provider value={{ locale, messages, t }}>
      {children}
    </I18nContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTranslation() {
  return useContext(I18nContext);
}

// loadMessages() lives in i18n-server.ts (no "use client" there — server only)
