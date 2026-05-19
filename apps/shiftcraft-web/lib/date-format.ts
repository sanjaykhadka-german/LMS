// Deterministic date / time formatters. Use these in client components
// instead of Date.prototype.toLocale*(undefined, …) — Node and the browser
// disagree on the en-AU default separator ("Thu, 21 May" vs "Thu 21 May"),
// which trips React hydration mismatch warnings.

export const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "Thu 21 May" */
export function fmtShortDate(d: Date): string {
  return `${WEEKDAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
}

/** "21 May" */
export function fmtDayMonth(d: Date): string {
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
}

/** "09:00" (24-hour) */
export function fmtTime24(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "Thu 21 May 09:00" */
export function fmtShortDateTime(d: Date): string {
  return `${fmtShortDate(d)} ${fmtTime24(d)}`;
}
