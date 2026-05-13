"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import Link from "next/link";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";
import ImageImportZone, { type ExtractedOrder } from "./image-import-zone";

type CustomerOption = {
  id: string; code: string; name: string;
  price_group_id: string | null; currency: string | null;
};

type ItemOption = {
  id: string; code: string; name: string;
  item_type: string; unit: string;
  weight_mode: string | null;
  target_weight_g: number | null;
  units_per_inner: number | null;
  inner_per_outer: number | null;
  sell_price_per_inner: number | null;
  sell_price_per_kg: number | null;
};

type UOM = "inner" | "carton" | "kg";

type OrderLine = {
  _key: string;
  item_id: string;
  item?: ItemOption;
  order_uom: UOM | "";
  qty_ordered: string;
  unit_price: string;
  notes: string;
};

function makeKey() { return Math.random().toString(36).slice(2); }
function newLine(): OrderLine {
  return { _key: makeKey(), item_id: "", order_uom: "", qty_ordered: "", unit_price: "", notes: "" };
}

/** Which UOM options are available for this item */
function uomOptions(item: ItemOption | undefined): { value: UOM; label: string }[] {
  if (!item) return [
    { value: "inner", label: "Inners" },
    { value: "carton", label: "Cartons" },
    { value: "kg", label: "kg" },
  ];
  if (item.weight_mode === "fixed") return [
    { value: "inner", label: item.inner_per_outer ? `Inners (${item.inner_per_outer}/ctn)` : "Inners" },
    { value: "carton", label: "Cartons" },
  ];
  if (item.weight_mode === "random") return [
    { value: "carton", label: "Cartons" },
    { value: "kg", label: "kg" },
  ];
  return [
    { value: "inner", label: "Inners" },
    { value: "carton", label: "Cartons" },
    { value: "kg", label: "kg" },
  ];
}

function defaultUom(item: ItemOption): UOM {
  if (item.weight_mode === "fixed") return "inner";
  if (item.weight_mode === "random") return "kg";
  return "inner";
}

/** Auto-fill unit price when item/UOM selected. $/inner for fixed, $/kg for random. */
function autoPrice(item: ItemOption, uom: UOM): string {
  if (item.weight_mode === "fixed") {
    if (uom === "inner" && item.sell_price_per_inner != null)
      return String(item.sell_price_per_inner);
    if (uom === "carton" && item.sell_price_per_inner != null && item.inner_per_outer)
      return (item.sell_price_per_inner * item.inner_per_outer).toFixed(2);
  }
  // Random weight: always $/kg regardless of order UOM
  if (item.weight_mode === "random" && item.sell_price_per_kg != null)
    return String(item.sell_price_per_kg);
  return "";
}

/** Unit price label */
function priceLabel(item: ItemOption | undefined, uom: UOM | ""): string {
  if (!item || !uom) return "Unit Price";
  if (item.weight_mode === "random") return "$/kg";
  if (uom === "inner") return "$/inner";
  if (uom === "carton") return "$/carton";
  return "Unit Price";
}

/** Calculate line total + whether it's estimated */
function calcTotal(line: OrderLine): { value: number | null; estimated: boolean } {
  const qty = parseFloat(line.qty_ordered);
  const price = parseFloat(line.unit_price);
  const item = line.item;
  if (!qty || !price || !item) return { value: null, estimated: false };

  if (item.weight_mode === "fixed") {
    return { value: qty * price, estimated: false };
  }

  if (item.weight_mode === "random") {
    if (line.order_uom === "kg") {
      return { value: qty * price, estimated: false };
    }
    if (line.order_uom === "carton") {
      const innerPerCarton = item.inner_per_outer ?? 1;
      const unitsPerInner = item.units_per_inner ?? 1;
      const avgWeightG = item.target_weight_g ?? 0;
      if (avgWeightG > 0) {
        const kgPerCarton = (innerPerCarton * unitsPerInner * avgWeightG) / 1000;
        return { value: qty * kgPerCarton * price, estimated: true };
      }
      return { value: null, estimated: true };
    }
  }

  return { value: qty * price, estimated: false };
}

/** Breakdown text shown beneath the line */
function lineBreakdown(line: OrderLine): string | null {
  const qty = parseFloat(line.qty_ordered);
  const item = line.item;
  if (!qty || !item || !line.order_uom) return null;

  if (item.weight_mode === "fixed") {
    if (line.order_uom === "inner") {
      const parts: string[] = [];
      if (item.inner_per_outer) parts.push(`${Math.round(qty / item.inner_per_outer * 100) / 100} ctns`);
      if (item.units_per_inner && item.target_weight_g) {
        const kg = (qty * item.units_per_inner * item.target_weight_g) / 1000;
        parts.push(`${kg.toFixed(3)} kg net`);
      }
      return parts.length ? parts.join(" · ") : null;
    }
    if (line.order_uom === "carton") {
      const parts: string[] = [];
      if (item.inner_per_outer) {
        const inners = qty * item.inner_per_outer;
        parts.push(`${inners} inners`);
        if (item.units_per_inner && item.target_weight_g) {
          const kg = (inners * item.units_per_inner * item.target_weight_g) / 1000;
          parts.push(`${kg.toFixed(3)} kg net`);
        }
      }
      return parts.length ? parts.join(" · ") : null;
    }
  }

  if (item.weight_mode === "random") {
    if (line.order_uom === "carton") {
      const innerPerCarton = item.inner_per_outer ?? 1;
      const unitsPerInner = item.units_per_inner ?? 1;
      const avgWeightG = item.target_weight_g ?? 0;
      if (avgWeightG > 0) {
        const kgPerCarton = (innerPerCarton * unitsPerInner * avgWeightG) / 1000;
        const estKg = (qty * kgPerCarton).toFixed(3);
        return `~${estKg} kg est. · invoiced on actual dispatched weight`;
      }
      return "Invoiced on actual dispatched weight";
    }
    if (line.order_uom === "kg") {
      return "Invoiced on actual dispatched weight";
    }
  }

  return null;
}

export default function OrderFormClient({
  mode,
  customers,
  allItems,
  defaultCustomerId,
  initial,
}: {
  mode: "create" | "edit";
  customers: CustomerOption[];
  allItems: ItemOption[];
  defaultCustomerId?: string;
  initial?: {
    id: string;
    order_number: string;
    customer_id: string;
    customer_po_number: string | null;
    required_date: string | null;
    delivery_date: string | null;
    notes: string | null;
    status: string;
    currency: string;
    lines: OrderLine[];
  };
}) {
  const router = useRouter();
  const supabase = createClient();
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? defaultCustomerId ?? "");
  const [customerPo, setCustomerPo] = useState(initial?.customer_po_number ?? "");
  const [requiredDate, setRequiredDate] = useState(initial?.required_date ?? "");
  const [deliveryDate, setDeliveryDate] = useState(initial?.delivery_date ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<OrderLine[]>(initial?.lines ?? []);
  const [saving, setSaving] = useState(false);
  const [showAllItems, setShowAllItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Line entry modal ──
  const [modalOpen, setModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null); // null = new line
  const [modalLine, setModalLine] = useState<OrderLine>(newLine());
  const [modalSearch, setModalSearch] = useState("");
  const [modalDropdown, setModalDropdown] = useState(false);
  const modalQtyRef = useRef<HTMLInputElement | null>(null);
  const modalItemRef = useRef<HTMLInputElement | null>(null);

  function openNewLine() {
    const l = newLine();
    setModalLine(l);
    setModalSearch("");
    setEditingKey(null);
    setModalOpen(true);
    setTimeout(() => modalItemRef.current?.focus(), 50);
  }

  function openEditLine(line: OrderLine) {
    setModalLine({ ...line });
    setModalSearch(line.item ? `${line.item.code} — ${line.item.name}` : "");
    setEditingKey(line._key);
    setModalOpen(true);
    setTimeout(() => modalItemRef.current?.focus(), 50);
  }

  function closeModal() {
    setModalOpen(false);
    setModalDropdown(false);
  }

  function selectModalItem(item: ItemOption) {
    const uom = defaultUom(item);
    const price = autoPrice(item, uom);
    setModalLine(l => ({ ...l, item_id: item.id, item, order_uom: uom, unit_price: price }));
    setModalSearch(`${item.code} — ${item.name}`);
    setModalDropdown(false);
    setTimeout(() => modalQtyRef.current?.focus(), 30);
  }

  function handleModalUomChange(uom: UOM) {
    setModalLine(l => {
      const price = l.item ? autoPrice(l.item, uom) : "";
      return { ...l, order_uom: uom, unit_price: price };
    });
  }

  function confirmModalLine() {
    if (!modalLine.item_id) return;
    if (editingKey) {
      setLines(ls => ls.map(l => l._key === editingKey ? { ...modalLine, _key: editingKey } : l));
    } else {
      setLines(ls => [...ls, modalLine]);
    }
    closeModal();
  }

  // Item search per line (used by AI import to set display labels)
  const [lineSearch, setLineSearch] = useState<Record<string, string>>({});
  const [lineDropdown, setLineDropdown] = useState<Record<string, boolean>>({});

  const selectedCustomer = customers.find(c => c.id === customerId);

  // Order number is auto-assigned by the database (sequential: #1001, #1002...)
  const orderNumber = initial?.order_number ?? "";

  function removeLine(key: string) {
    setLines(ls => ls.filter(l => l._key !== key));
  }

  /** Called when the AI image zone extracts an order. Pre-fills form fields. */
  function handleExtracted(data: ExtractedOrder) {
    // Pre-fill required date
    if (data.required_date) setRequiredDate(data.required_date);

    // Pre-fill notes
    if (data.notes) setNotes(prev => prev ? `${prev}\n${data.notes}` : data.notes!);

    // Try to match customer from hint
    if (data.customer_hint) {
      const hint = data.customer_hint.toLowerCase();
      const match = customers.find(c =>
        c.name.toLowerCase().includes(hint) ||
        c.code.toLowerCase().includes(hint) ||
        hint.includes(c.name.toLowerCase())
      );
      if (match) setCustomerId(match.id);
    }

    // Match extracted lines to item master
    if (data.lines.length > 0) {
      const newLines: OrderLine[] = data.lines.map(extracted => {
        const hint = extracted.item_hint.toLowerCase();
        const matched = allItems.find(item =>
          item.name.toLowerCase().includes(hint) ||
          item.code.toLowerCase().includes(hint) ||
          hint.includes(item.name.toLowerCase())
        );

        const key = makeKey();

        if (matched) {
          const uomRaw = extracted.uom ?? defaultUom(matched);
          const uom = (["inner", "carton", "kg"].includes(uomRaw) ? uomRaw : defaultUom(matched)) as UOM;
          const price = extracted.unit_price != null
            ? String(extracted.unit_price)
            : autoPrice(matched, uom);
          // Update search label so it shows in the input
          setLineSearch(s => ({ ...s, [key]: `${matched.code} — ${matched.name}` }));
          return {
            _key: key,
            item_id: matched.id,
            item: matched,
            order_uom: uom,
            qty_ordered: extracted.qty != null ? String(extracted.qty) : "",
            unit_price: price,
            notes: extracted.notes ?? "",
          };
        }

        // No match — leave item blank but fill what we have, set search text to hint so user can see what was extracted
        setLineSearch(s => ({ ...s, [key]: extracted.item_hint }));
        const uom = (extracted.uom && ["inner", "carton", "kg"].includes(extracted.uom) ? extracted.uom : "") as UOM | "";
        return {
          _key: key,
          item_id: "",
          order_uom: uom,
          qty_ordered: extracted.qty != null ? String(extracted.qty) : "",
          unit_price: extracted.unit_price != null ? String(extracted.unit_price) : "",
          notes: extracted.notes ?? "",
        };
      });

      setLines(newLines);
    }
  }

  async function handleSave() {
    if (!customerId) { setError("Please select a customer."); return; }
    const validLines = lines.filter(l => l.item_id && l.qty_ordered);
    if (validLines.length === 0) { setError("Add at least one line item with a quantity."); return; }

    setSaving(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
    const tenantId = profile!.tenant_id;

    const orderPayload = {
      tenant_id: tenantId,
      customer_id: customerId,
      order_number: orderNumber,
      customer_po_number: customerPo || null,
      required_date: requiredDate || null,
      delivery_date: deliveryDate || null,
      currency: selectedCustomer?.currency ?? "AUD",
      notes: notes || null,
    };

    let orderId: string;

    if (mode === "create") {
      const { data, error: err } = await supabase.from("customer_orders").insert(orderPayload).select("id").single();
      if (err) { setError(err.message); setSaving(false); return; }
      orderId = data.id;
    } else {
      const { error: err } = await supabase.from("customer_orders").update(orderPayload).eq("id", initial!.id);
      if (err) { setError(err.message); setSaving(false); return; }
      orderId = initial!.id;
      await supabase.from("customer_order_lines").delete().eq("customer_order_id", orderId);
    }

    const linesPayload = validLines.map((l, idx) => {
      const qty = parseFloat(l.qty_ordered) || 0;
      const item = l.item;
      let qty_inners: number | null = null;
      let qty_kg_estimated: number | null = null;

      if (item && l.order_uom) {
        if (l.order_uom === "inner") {
          qty_inners = qty;
        } else if (l.order_uom === "carton") {
          qty_inners = item.inner_per_outer ? qty * item.inner_per_outer : null;
          if (item.weight_mode === "random" && qty_inners && item.units_per_inner && item.target_weight_g) {
            qty_kg_estimated = (qty_inners * item.units_per_inner * item.target_weight_g) / 1000;
          }
        } else if (l.order_uom === "kg") {
          qty_kg_estimated = qty;
        }
      }

      const unitPrice = l.unit_price ? parseFloat(l.unit_price) : null;

      return {
        tenant_id: tenantId,
        customer_order_id: orderId,
        item_id: l.item_id,
        line_number: idx + 1,
        order_uom: l.order_uom || null,
        qty_ordered: qty || null,
        qty_inners,
        qty_kg_estimated,
        unit_price: unitPrice,
        notes: l.notes || null,
      };
    });

    const { error: linesErr } = await supabase.from("customer_order_lines").insert(linesPayload);
    if (linesErr) { setError(linesErr.message); setSaving(false); return; }

    router.push(`/orders/${orderId}`);
  }

  // Order subtotal
  const orderTotal = lines.reduce((sum, l) => {
    const { value } = calcTotal(l);
    return sum + (value ?? 0);
  }, 0);
  const hasEstimates = lines.some(l => calcTotal(l).estimated);

  // Modal item dropdown (pre-computed to avoid IIFE in JSX)
  const modalQ = modalSearch.toLowerCase();
  const modalFilteredItems = modalDropdown ? allItems.filter(it => {
    if (!showAllItems && it.item_type !== "finished_good") return false;
    if (!modalQ) return true;
    return it.code.toLowerCase().includes(modalQ) || it.name.toLowerCase().includes(modalQ);
  }).slice(0, 30) : [];

  // Modal line total preview (pre-computed)
  const { value: modalTotal, estimated: modalEstimated } = calcTotal(modalLine);
  const modalBreakdown = lineBreakdown(modalLine);

  return (
    <div style={{ maxWidth: "1000px" }}>
      <BackButton href="/orders" label="Orders" />
      <div className="page-header">
        <div>
          <h1 className="page-title">{mode === "create" ? "New Customer Order" : `Edit Order #${initial?.order_number}`}</h1>
          <p className="page-subtitle">
            {mode === "create" ? "Create a new customer order" : "Edit order details and lines"}
          </p>
        </div>
      </div>

      {/* ── AI Image Import (create mode only) ── */}
      {mode === "create" && (
        <ImageImportZone onExtracted={handleExtracted} />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

        {/* ── Order Header ── */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Order Details</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Customer *</label>
              <select className="form-select" value={customerId} onChange={e => setCustomerId(e.target.value)} required>
                <option value="">— Select customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Customer PO Number</label>
              <input className="form-input" value={customerPo} onChange={e => setCustomerPo(e.target.value)}
                placeholder="Customer's purchase order ref" style={{ fontFamily: "monospace" }} />
            </div>
            <div>
              <label className="form-label">Required Date</label>
              <input className="form-input" value={requiredDate} onChange={e => setRequiredDate(e.target.value)} type="date" />
            </div>
            <div>
              <label className="form-label">Dispatch Date</label>
              <input className="form-input" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} type="date" />
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <label className="form-label">Notes</label>
            <textarea className="form-input" value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} style={{ resize: "vertical" }} placeholder="Internal notes for this order" />
          </div>
        </div>

        {/* ── Order Lines ── */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>
              Order Lines {lines.length > 0 && <span style={{ color: "#78716c", fontWeight: 400 }}>({lines.length})</span>}
            </h2>
            <button type="button" onClick={openNewLine} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
              + Add Line
            </button>
          </div>

          {lines.length === 0 ? (
            <div style={{ padding: "2rem 1.25rem", textAlign: "center", color: "#a8a29e", fontSize: "0.875rem" }}>
              No lines yet — click <strong>+ Add Line</strong> to get started.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: "2rem" }}>#</th>
                  <th>Item</th>
                  <th>UOM</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Line Total</th>
                  <th style={{ width: "5rem" }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const item = line.item;
                  const { value: total, estimated } = calcTotal(line);
                  const breakdown = lineBreakdown(line);
                  return (
                    <React.Fragment key={line._key}>
                      <tr style={{ cursor: "pointer" }} onClick={() => openEditLine(line)}>
                        <td style={{ color: "#a8a29e", fontSize: "0.8125rem" }}>{idx + 1}</td>
                        <td>
                          <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                            {item ? <><span style={{ fontFamily: "monospace", color: "#78716c" }}>{item.code}</span> — {item.name}</> : <span style={{ color: "#a8a29e" }}>—</span>}
                          </div>
                          {line.notes && <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.125rem" }}>{line.notes}</div>}
                        </td>
                        <td style={{ fontSize: "0.8125rem" }}>{line.order_uom || "—"}</td>
                        <td style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{line.qty_ordered || "—"}</td>
                        <td style={{ fontSize: "0.8125rem" }}>
                          {line.unit_price ? `$${parseFloat(line.unit_price).toFixed(2)}` : "—"}
                          {item?.weight_mode === "random" && <span style={{ fontSize: "0.6875rem", color: "#b45309" }}>/kg</span>}
                        </td>
                        <td style={{ fontSize: "0.875rem", fontWeight: 600, color: total != null ? (estimated ? "#b45309" : "#1c1917") : "#a8a29e" }}>
                          {total != null ? `${estimated ? "~" : ""}$${total.toFixed(2)}` : "—"}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display: "flex", gap: "0.25rem" }}>
                            <button type="button" onClick={() => openEditLine(line)}
                              style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", border: "1px solid #e7e5e4", borderRadius: "0.375rem", background: "#fff", cursor: "pointer", color: "#44403c" }}>
                              Edit
                            </button>
                            <button type="button" onClick={() => removeLine(line._key)}
                              style={{ padding: "0.25rem 0.375rem", fontSize: "0.75rem", border: "1px solid #fca5a5", borderRadius: "0.375rem", background: "#fff", color: "#dc2626", cursor: "pointer" }}>
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                      {breakdown && (
                        <tr style={{ background: "#fafaf9" }}>
                          <td></td>
                          <td colSpan={5} style={{ fontSize: "0.75rem", color: item?.weight_mode === "random" ? "#b45309" : "#78716c", paddingTop: "0.25rem", paddingBottom: "0.5rem" }}>
                            {item?.weight_mode === "random" ? "⚖️ " : "📦 "}{breakdown}
                          </td>
                          <td></td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Order total */}
          {lines.some(l => calcTotal(l).value != null) && (
            <div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid #e7e5e4", display: "flex", justifyContent: "flex-end", gap: "0.5rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.875rem", color: "#78716c" }}>
                {hasEstimates ? "Estimated order total:" : "Order total:"}
              </span>
              <span style={{ fontSize: "1.125rem", fontWeight: 700, color: hasEstimates ? "#b45309" : "#1c1917" }}>
                {hasEstimates ? "~" : ""}${orderTotal.toFixed(2)}
              </span>
              {hasEstimates && (
                <span style={{ fontSize: "0.6875rem", color: "#78716c" }}>
                  (random weight lines invoiced on actual kg)
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Line Entry Modal ── */}
        {modalOpen && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
            // No backdrop close — Save / Cancel / × inside the modal close it.
            >
            <div style={{ background: "#fff", borderRadius: "0.75rem", width: "100%", maxWidth: "520px", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" }}>
              {/* Modal header */}
              <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
                  {editingKey ? "Edit Line" : "Add Order Line"}
                </h3>
                <button type="button" onClick={closeModal} style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: "#78716c", lineHeight: 1 }}>×</button>
              </div>

              {/* Modal body */}
              <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

                {/* Item search */}
                <div style={{ position: "relative" }}>
                  <label className="form-label">Item *</label>
                  <input
                    ref={modalItemRef}
                    className="form-input"
                    value={modalSearch}
                    onChange={e => { setModalSearch(e.target.value); setModalDropdown(true); }}
                    onFocus={() => setModalDropdown(true)}
                    onBlur={() => setTimeout(() => setModalDropdown(false), 150)}
                    placeholder="Search by code or name…"
                    autoComplete="off"
                  />
                  {modalDropdown && modalFilteredItems.length > 0 && (
                    <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 10, background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.375rem", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: "220px", overflowY: "auto" }}>
                      {modalFilteredItems.map(it => (
                        <button key={it.id} type="button" onMouseDown={() => selectModalItem(it)}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "0.4375rem 0.75rem", border: "none", background: "none", cursor: "pointer", borderBottom: "1px solid #f5f5f4", fontSize: "0.8125rem" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
                          onMouseLeave={e => (e.currentTarget.style.background = "none")}
                        >
                          <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{it.code}</span>
                          <span style={{ color: "#44403c", marginLeft: "0.5rem" }}>{it.name}</span>
                          <span className={`badge ${ITEM_TYPE_COLORS[it.item_type as ItemType]}`} style={{ fontSize: "0.5625rem", marginLeft: "0.375rem", verticalAlign: "middle" }}>
                            {ITEM_TYPE_LABELS[it.item_type as ItemType]}
                          </span>
                          {it.weight_mode === "random" && <span style={{ fontSize: "0.625rem", color: "#b45309", marginLeft: "0.25rem" }}>random wt</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "#78716c", cursor: "pointer", marginTop: "-0.5rem" }}>
                  <input type="checkbox" checked={showAllItems} onChange={e => setShowAllItems(e.target.checked)} />
                  Show WIP &amp; raw materials
                </label>

                {/* UOM + Qty row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label className="form-label">Order UOM</label>
                    <select className="form-select" value={modalLine.order_uom} onChange={e => handleModalUomChange(e.target.value as UOM)} disabled={!modalLine.item}>
                      {!modalLine.item && <option value="">—</option>}
                      {uomOptions(modalLine.item).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Qty *</label>
                    <input
                      ref={modalQtyRef}
                      className="form-input"
                      value={modalLine.qty_ordered}
                      onChange={e => setModalLine(l => ({ ...l, qty_ordered: e.target.value }))}
                      type="number" min="0"
                      step={modalLine.order_uom === "kg" ? "0.001" : "1"}
                      placeholder="0"
                      disabled={!modalLine.item}
                      onKeyDown={e => { if (e.key === "Enter") confirmModalLine(); }}
                    />
                  </div>
                </div>

                {/* Unit price */}
                <div>
                  <label className="form-label">{priceLabel(modalLine.item, modalLine.order_uom)}</label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "#78716c", fontSize: "0.875rem", pointerEvents: "none" }}>$</span>
                    <input
                      className="form-input"
                      style={{ paddingLeft: "1.25rem" }}
                      value={modalLine.unit_price}
                      onChange={e => setModalLine(l => ({ ...l, unit_price: e.target.value }))}
                      type="number" min="0" step="0.01" placeholder="0.00"
                      disabled={!modalLine.item}
                      onKeyDown={e => { if (e.key === "Enter") confirmModalLine(); }}
                    />
                  </div>
                  {modalLine.item?.weight_mode === "random" && (
                    <p style={{ fontSize: "0.75rem", color: "#b45309", margin: "0.25rem 0 0" }}>Price per kg — invoiced on actual dispatched weight</p>
                  )}
                </div>

                {/* Breakdown preview */}
                {modalBreakdown && (
                  <div style={{ fontSize: "0.8125rem", color: modalLine.item?.weight_mode === "random" ? "#b45309" : "#78716c", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem", padding: "0.5rem 0.75rem" }}>
                    {modalLine.item?.weight_mode === "random" ? "⚖️ " : "📦 "}{modalBreakdown}
                  </div>
                )}

                {/* Line total preview */}
                {modalTotal != null && (
                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: modalEstimated ? "#b45309" : "#1c1917", textAlign: "right" }}>
                    Line total: {modalEstimated ? "~" : ""}${modalTotal.toFixed(2)}{modalEstimated ? " est." : ""}
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="form-label">Line Notes</label>
                  <input
                    className="form-input"
                    value={modalLine.notes}
                    onChange={e => setModalLine(l => ({ ...l, notes: e.target.value }))}
                    placeholder="Optional notes for this line"
                    onKeyDown={e => { if (e.key === "Enter") confirmModalLine(); }}
                  />
                </div>
              </div>

              {/* Modal footer */}
              <div style={{ padding: "0.875rem 1.25rem", borderTop: "1px solid #e7e5e4", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button type="button" onClick={closeModal} className="btn-secondary">Cancel</button>
                <button type="button" onClick={confirmModalLine} className="btn-primary" disabled={!modalLine.item_id || !modalLine.qty_ordered}>
                  {editingKey ? "Update Line" : "Add to Order"}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create Order" : "Save Changes"}
          </button>
          <Link href="/orders" className="btn-secondary">Cancel</Link>
        </div>

      </div>
    </div>
  );
}
