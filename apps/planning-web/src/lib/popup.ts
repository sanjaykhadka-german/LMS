/**
 * Open an item-detail page in a sized popup window so the user clearly
 * sees a new context has opened (vs the familiar same-tab back flow).
 * Falls back to a plain new-tab if the popup is blocked.
 *
 * Used by both the demand plan editor and the Item Master grid so the UX
 * stays consistent across the app.
 */
export function openItemInPopup(itemId: string): void {
  openInPopup(`/items/${itemId}`, `item_${itemId}`);
}

/** Same UX, but for a production work order's BOM + traceability page. */
export function openOrderInPopup(orderId: string): void {
  openInPopup(`/work-orders/${orderId}`, `work_order_${orderId}`);
}

/** Lower-level helper — opens an arbitrary URL in a sized, centered popup
 *  using the same dimensions as the item popup so the chrome feels consistent.
 *  Falls back to a normal new tab when the browser blocks popups. */
export function openInPopup(url: string, name: string): void {
  if (typeof window === "undefined") return;
  const w = Math.max(900, Math.round(window.screen.availWidth * 0.75));
  const h = Math.max(700, Math.round(window.screen.availHeight * 0.85));
  const left = Math.max(0, Math.round((window.screen.availWidth  - w) / 2));
  const top  = Math.max(0, Math.round((window.screen.availHeight - h) / 2));
  const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`;
  const popup = window.open(url, name, features);
  if (!popup) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
