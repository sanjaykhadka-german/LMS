"use client";

// Simple pass-through — caching is handled at the hook level via src/lib/cache.ts
export function QueryProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
