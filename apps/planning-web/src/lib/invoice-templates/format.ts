export function fmtCurrency(value: number | null, currency: string): string {
  const n = value ?? 0;
  return `${currency} ${n.toFixed(2)}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

export function fmtAddress(parts: {
  line1: string | null; line2: string | null;
  city: string | null; state: string | null;
  postcode: string | null; country: string | null;
}): string[] {
  const lines: string[] = [];
  if (parts.line1) lines.push(parts.line1);
  if (parts.line2) lines.push(parts.line2);
  const cityLine = [parts.city, parts.state, parts.postcode].filter(Boolean).join(" ");
  if (cityLine) lines.push(cityLine);
  if (parts.country) lines.push(parts.country);
  return lines;
}

export function fmtQty(units: number | null, kg: number | null): string {
  if (units != null && kg != null) return `${units} (${kg.toFixed(2)} kg)`;
  if (units != null) return `${units}`;
  if (kg != null) return `${kg.toFixed(2)} kg`;
  return "—";
}

const UOM_LABELS: Record<string, { singular: string; plural: string }> = {
  inner:  { singular: "inner",  plural: "inners"  },
  carton: { singular: "carton", plural: "cartons" },
  kg:     { singular: "kg",     plural: "kg"      },
};

export function fmtLot(lot: {
  batch_number: string | null;
  use_by_date: string | null;
  qty_dispatched: number | null;
  dispatch_uom: string | null;
}): string {
  const parts: string[] = [];
  if (lot.batch_number) parts.push(`Batch ${lot.batch_number}`);
  if (lot.use_by_date)  parts.push(`Use by ${fmtDate(lot.use_by_date)}`);
  if (lot.qty_dispatched != null) {
    const uomKey = (lot.dispatch_uom ?? "").toLowerCase();
    const uomLabel = UOM_LABELS[uomKey];
    const qty = lot.qty_dispatched;
    const unit = uomLabel
      ? (qty === 1 ? uomLabel.singular : uomLabel.plural)
      : (lot.dispatch_uom ?? "");
    parts.push(`${qty} ${unit}`.trim());
  }
  return parts.join(" · ");
}
