"use client";

import { useEffect } from "react";

/**
 * Tiny client component that wires up the "Print / Save PDF" button on the
 * spec preview page. Server components can't hold inline event handlers, so
 * we attach onclick from the client side via a data attribute selector.
 */
export default function PrintTrigger() {
  useEffect(() => {
    const btn = document.querySelector<HTMLButtonElement>('button[data-spec-print-trigger="true"]');
    if (btn) btn.onclick = () => window.print();
  }, []);

  return null;
}
