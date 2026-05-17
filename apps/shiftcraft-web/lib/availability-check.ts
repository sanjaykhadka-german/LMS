// Free-text availability parser.
//
// The availability form stores one short string per weekday — by design,
// because rostering staff use phrases ("evenings only", "after 4pm", "no
// weekends") rather than structured pickers. Trying to be clever about
// every phrasing would produce false positives, so this parser is
// conservative: it only emits a window/unavailable verdict when it's
// confident, and falls back to `unknown` otherwise. The schedule UI
// only renders a warning chip on a confident `mismatch` — never on
// `unknown` — so a misparse stays silent rather than spamming admins.
//
// No DB access. Safe to import from client or server.

export type AvailabilityVerdict =
  | { kind: "match" }
  | { kind: "mismatch"; reason: string }
  | { kind: "unknown" };

export interface ParsedWindow {
  fromMin: number; // minutes-since-midnight
  toMin: number;
}

export type ParsedDay =
  | { kind: "window"; window: ParsedWindow }
  | { kind: "unavailable" }
  | { kind: "unknown" };

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type DayKey = (typeof DAY_KEYS)[number];

export function dayKeyFor(d: Date): DayKey {
  return DAY_KEYS[d.getDay()]!;
}

const UNAVAILABLE_RE = /^\s*(not?\s*available|unavail(?:able)?|off|no|none|n\/a|-)\s*$/i;

// Matches a range like "9-5", "9am-5pm", "09:00-17:00", "9 to 5", "9 - 5pm".
// Captures: hh1, mm1?, ampm1?, hh2, mm2?, ampm2?.
const RANGE_RE =
  /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i;

const AFTER_RE = /\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
const BEFORE_RE = /\bbefore\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

function normaliseHour(hh: number, mm: number, ampm: string | undefined): number {
  let h = hh;
  if (ampm) {
    const isPm = /^p/i.test(ampm);
    if (h === 12) h = isPm ? 12 : 0;
    else if (isPm) h += 12;
  }
  return h * 60 + mm;
}

export function parseAvailabilityForDay(rawText: string | undefined | null): ParsedDay {
  const text = (rawText ?? "").trim();
  if (text === "") return { kind: "unknown" };
  if (UNAVAILABLE_RE.test(text)) return { kind: "unavailable" };

  const range = RANGE_RE.exec(text);
  if (range) {
    const [, hh1, mm1, ampm1, hh2, mm2, ampm2] = range;
    const fromMin = normaliseHour(
      parseInt(hh1!, 10),
      mm1 ? parseInt(mm1, 10) : 0,
      ampm1,
    );
    let toMin = normaliseHour(
      parseInt(hh2!, 10),
      mm2 ? parseInt(mm2, 10) : 0,
      ampm2,
    );
    // Heuristic: if no am/pm at all and "to" is numerically less than
    // "from" (e.g. "9-5"), assume the second value is PM — that's the
    // overwhelming free-text convention.
    if (!ampm1 && !ampm2 && toMin <= fromMin) {
      toMin += 12 * 60;
    }
    if (toMin <= fromMin) return { kind: "unknown" };
    return { kind: "window", window: { fromMin, toMin } };
  }

  const after = AFTER_RE.exec(text);
  if (after) {
    const [, hh, mm, ampm] = after;
    const fromMin = normaliseHour(
      parseInt(hh!, 10),
      mm ? parseInt(mm, 10) : 0,
      ampm,
    );
    return { kind: "window", window: { fromMin, toMin: 24 * 60 - 1 } };
  }

  const before = BEFORE_RE.exec(text);
  if (before) {
    const [, hh, mm, ampm] = before;
    const toMin = normaliseHour(
      parseInt(hh!, 10),
      mm ? parseInt(mm, 10) : 0,
      ampm,
    );
    return { kind: "window", window: { fromMin: 0, toMin } };
  }

  return { kind: "unknown" };
}

function localMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Compare a shift window against an employee's availability for that
 * day. Returns "match" only when the shift fits entirely inside the
 * declared window; "mismatch" on unavailable or out-of-window; and
 * "unknown" when we can't tell (no string, unparseable, crosses
 * midnight).
 */
export function checkAvailability(
  availability: Record<string, string> | null | undefined,
  shiftStartsAt: Date,
  shiftEndsAt: Date,
): AvailabilityVerdict {
  if (!availability) return { kind: "unknown" };
  // Don't try to reason about cross-midnight shifts — too easy to get wrong.
  const sameDay =
    shiftStartsAt.getFullYear() === shiftEndsAt.getFullYear() &&
    shiftStartsAt.getMonth() === shiftEndsAt.getMonth() &&
    shiftStartsAt.getDate() === shiftEndsAt.getDate();
  if (!sameDay) return { kind: "unknown" };

  const key = dayKeyFor(shiftStartsAt);
  const parsed = parseAvailabilityForDay(availability[key]);
  if (parsed.kind === "unknown") return { kind: "unknown" };
  if (parsed.kind === "unavailable") {
    return {
      kind: "mismatch",
      reason: `Marked unavailable on ${dayLabel(key)}.`,
    };
  }

  const startMin = localMinutes(shiftStartsAt);
  const endMin = localMinutes(shiftEndsAt);
  if (startMin >= parsed.window.fromMin && endMin <= parsed.window.toMin) {
    return { kind: "match" };
  }
  return {
    kind: "mismatch",
    reason: `Outside declared ${fmtMinutes(parsed.window.fromMin)}–${fmtMinutes(parsed.window.toMin)} on ${dayLabel(key)}.`,
  };
}

function dayLabel(key: DayKey): string {
  switch (key) {
    case "sun":
      return "Sunday";
    case "mon":
      return "Monday";
    case "tue":
      return "Tuesday";
    case "wed":
      return "Wednesday";
    case "thu":
      return "Thursday";
    case "fri":
      return "Friday";
    case "sat":
      return "Saturday";
  }
}

function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
