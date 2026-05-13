/**
 * Week-math helpers shared between server components (e.g. /dept/[dept]/page.tsx)
 * and client components (e.g. WeekPicker). Kept in a separate file with no
 * "use client" / "use server" directive so it's safe to import from either
 * runtime. Importing helpers from a "use client" module into a server
 * component crashes the Server Components render in Next 16, hence this split.
 */

/** Returns the Monday-of-week ISO date string (YYYY-MM-DD) for a given Date. */
export function mondayOf(d: Date): string {
  // JS getDay: 0=Sun..6=Sat. Convert to 0=Mon..6=Sun.
  const dow = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - dow);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

/** Same but for a YYYY-MM-DD string input. Used to normalise the ?week= param. */
export function mondayOfIso(iso: string): string {
  return mondayOf(new Date(iso + "T00:00:00"));
}

/** Add N days to a YYYY-MM-DD date and return ISO YYYY-MM-DD. */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
