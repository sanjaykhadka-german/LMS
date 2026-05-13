/**
 * Server-only i18n helper — no "use client" here.
 * Import this only from Server Components or Route Handlers.
 *
 * Usage in a server layout:
 *   import { loadMessages } from "@/lib/i18n-server";
 *   const { locale, messages } = await loadMessages(profile?.language ?? "en");
 *   // Then pass locale + messages into <I18nProvider>
 */

import type { SupportedLocale } from "./i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Messages = Record<string, any>;

const SUPPORTED: SupportedLocale[] = ["en", "de"];

export async function loadMessages(
  locale: string
): Promise<{ locale: SupportedLocale; messages: Messages }> {
  const safe: SupportedLocale = SUPPORTED.includes(locale as SupportedLocale)
    ? (locale as SupportedLocale)
    : "en";

  try {
    // Dynamic import — Next.js bundles these at build time
    const messages = (
      await import(`../../messages/${safe}.json`)
    ).default as Messages;
    return { locale: safe, messages };
  } catch {
    // Fallback to English if locale file is missing
    const messages = (
      await import(`../../messages/en.json`)
    ).default as Messages;
    return { locale: "en", messages };
  }
}
