"use client";

/**
 * Week picker — pinned to the top of any "show me one week" view.
 *
 * Renders:   [← Prev]  [📅 Mon 27 Apr – Sun 03 May 2026]  [Today]  [Next →]
 *
 * The selected week is reflected in the URL via ?week=YYYY-MM-DD (always the
 * Monday of that week) so a) deep-links work, b) refreshing keeps the view,
 * c) the server component can read it directly from searchParams.
 *
 * Pure UI — the actual filtering happens server-side. We only nudge the URL
 * via router.push and let RSC re-render with the new week.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { mondayOf, mondayOfIso, addDays } from "@/lib/week-utils";

/** Format "Mon 27/04 – Sun 03/05/2026" for the centre label. */
function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00");
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  const yr = end.getFullYear();
  return `${fmt(start)} – ${fmt(end)} ${yr}`;
}

export default function WeekPicker({ weekStart }: { weekStart: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  function nav(toIso: string) {
    const next = new URLSearchParams(params.toString());
    next.set("week", toIso);
    router.push(`${pathname}?${next.toString()}`);
  }
  const today = mondayOf(new Date());
  const isThisWeek = weekStart === today;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
      background: "#fff", padding: "0.5rem 0.75rem", borderRadius: "0.5rem",
      border: "1px solid #e7e5e4", marginBottom: "1rem",
    }}>
      <button
        type="button"
        onClick={() => nav(addDays(weekStart, -7))}
        className="btn-secondary"
        style={{ fontSize: "0.8125rem", padding: "0.3rem 0.625rem" }}
        title="Previous week"
      >← Prev</button>

      <div style={{ flex: 1, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.625rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1c1917" }}>
          📅 {formatWeekRange(weekStart)}
        </span>
        {isThisWeek && (
          <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "0.1rem 0.5rem", background: "#dcfce7", color: "#166534", borderRadius: "9999px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            This week
          </span>
        )}
        {/* Native date picker — operator can jump to any week. We snap the
            chosen date to Monday so the URL stays normalised. */}
        <input
          type="date"
          value={weekStart}
          onChange={e => e.target.value && nav(mondayOfIso(e.target.value))}
          className="form-input"
          style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem", width: "auto" }}
          title="Jump to any week (date snaps to Monday)"
        />
      </div>

      {!isThisWeek && (
        <button
          type="button"
          onClick={() => nav(today)}
          className="btn-secondary"
          style={{ fontSize: "0.8125rem", padding: "0.3rem 0.625rem" }}
          title="Jump to current week"
        >Today</button>
      )}
      <button
        type="button"
        onClick={() => nav(addDays(weekStart, 7))}
        className="btn-secondary"
        style={{ fontSize: "0.8125rem", padding: "0.3rem 0.625rem" }}
        title="Next week"
      >Next →</button>
    </div>
  );
}
