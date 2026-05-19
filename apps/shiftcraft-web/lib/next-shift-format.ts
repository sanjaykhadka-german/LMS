// Pure formatters for the dashboard countdown card. No DB, no server-only —
// safe to import from client components. The DB helper lives in next-shift.ts.

export type CountdownTone = "upcoming" | "imminent" | "working" | "finished";

export interface CountdownResult {
  tone: CountdownTone;
  label: string;
  /** Header line — short, punchy, never empty. */
  headline: string;
}

export function countdownFor(
  now: Date,
  startsAt: Date,
  endsAt: Date,
): CountdownResult | null {
  const nowMs = now.getTime();
  const startMs = startsAt.getTime();
  const endMs = endsAt.getTime();

  if (nowMs > endMs + 60 * 60 * 1000) return null;

  if (nowMs < startMs) {
    const remaining = startMs - nowMs;
    if (remaining < 30 * 1000) {
      return {
        tone: "imminent",
        headline: "Starting now",
        label: "Time to clock in.",
      };
    }
    return {
      tone: remaining < 60 * 60 * 1000 ? "imminent" : "upcoming",
      headline: "Up next",
      label: `Starts in ${humanise(remaining)}`,
    };
  }

  if (nowMs <= endMs) {
    const remaining = endMs - nowMs;
    return {
      tone: "working",
      headline: "Currently working",
      label: `Ends in ${humanise(remaining)}`,
    };
  }

  const since = nowMs - endMs;
  return {
    tone: "finished",
    headline: "Just finished",
    label: `Wrapped ${humanise(since)} ago`,
  };
}

export function humanise(ms: number): string {
  const abs = Math.max(0, ms);
  const totalSec = Math.floor(abs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (days > 0) {
    return hours > 0
      ? `${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"}`
      : `${days} day${days === 1 ? "" : "s"}`;
  }
  if (hours > 0) {
    return minutes > 0
      ? `${hours}h ${minutes}m`
      : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}
