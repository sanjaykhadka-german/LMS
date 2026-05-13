/**
 * App-wide formatting + parsing standards.
 *
 * Single source of truth — change a precision here and every consumer
 * updates. Apply these everywhere instead of ad-hoc .toFixed() / parseFloat().
 *
 * Conventions (per Tino, May 2026):
 *   - Weights:     3 decimals, gram precision (1.234 kg)
 *   - Percentages: 2 decimals (54.50%)
 *   - Units / each: integer only
 *   - Decimal entry: ".2" parses as 0.2 (not NaN)
 */

const WEIGHT_UNITS = new Set(["kg", "g", "lb", "oz", "t"]);
const COUNT_UNITS  = new Set(["ea", "each", "pcs", "pc", "unit", "units", "ct", "count"]);

/** 3 decimal places, locale-aware thousands separator. Returns "—" if null/NaN. */
export function formatKg(value: number | null | undefined): string {
  if (value == null || isNaN(value as number)) return "—";
  return (value as number).toLocaleString("en-AU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** Grams formatted as INTEGER with thousand separators (per Tino, May 2026:
 *  gram values never need decimals — the precision lives at the kg/3dp layer).
 *  Use this for any column or label that ends in `_g`. */
export function formatGrams(value: number | null | undefined): string {
  if (value == null || isNaN(value as number)) return "—";
  return Math.round(value as number).toLocaleString("en-AU");
}

/** Generic number with the right precision for the given unit.
 *  Weights get 3dp, counts/each get integer, anything else gets 3dp by default. */
export function formatQty(value: number | null | undefined, unit?: string | null): string {
  if (value == null || isNaN(value as number)) return "—";
  const u = (unit ?? "").toLowerCase();
  if (COUNT_UNITS.has(u)) return Math.round(value as number).toLocaleString("en-AU");
  // Default to 3dp (covers kg/g/lb plus unknowns — gram precision is safe)
  return (value as number).toLocaleString("en-AU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** Qty + unit suffix, e.g. "1.234 kg" or "12 ea". */
export function formatQtyWithUnit(value: number | null | undefined, unit?: string | null): string {
  if (value == null || isNaN(value as number)) return "—";
  return `${formatQty(value, unit)}${unit ? ` ${unit}` : ""}`;
}

/** Percent with 2dp + sign. Pass `0.545` to get "54.50%" — call with the
 *  ratio (0..1) OR pass the already-multiplied value with `alreadyPct=true`. */
export function formatPercent(value: number | null | undefined, alreadyPct = false): string {
  if (value == null || isNaN(value as number)) return "—";
  const pct = alreadyPct ? (value as number) : (value as number) * 100;
  return `${pct.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/** Integer count, e.g. "12". Returns "—" if null/NaN. */
export function formatUnits(value: number | null | undefined): string {
  if (value == null || isNaN(value as number)) return "—";
  return Math.round(value as number).toLocaleString("en-AU");
}

/**
 * Lenient decimal parser used everywhere.
 *
 *   parseDecimal(".2")   →  0.2   (vs parseFloat which gives 0.2 — but on some browsers/inputs strips leading dot)
 *   parseDecimal("1,234.5") → 1234.5  (strip thousands separator)
 *   parseDecimal("")     →  null
 *   parseDecimal("abc")  →  null
 *   parseDecimal(null)   →  null
 */
export function parseDecimal(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let s = input.trim();
  if (!s) return null;
  // Strip thousands separators (commas) — Australian/UK convention
  s = s.replace(/,/g, "");
  // Promote leading dot ".2" → "0.2"
  if (s.startsWith(".")) s = "0" + s;
  // Allow leading minus dot, e.g. "-.5" → "-0.5"
  if (s.startsWith("-.")) s = "-0" + s.slice(1);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Like parseDecimal but rounds to integer for unit/each fields. */
export function parseUnits(input: string | number | null | undefined): number | null {
  const n = parseDecimal(input);
  return n == null ? null : Math.round(n);
}
