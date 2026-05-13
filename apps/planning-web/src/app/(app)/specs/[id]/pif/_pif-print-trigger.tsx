"use client";

import { useEffect } from "react";

/**
 * Tiny client component that:
 *  - wires up the "Print / Save as PDF" button (looks up button via data attr)
 *  - auto-triggers window.print() if ?print=1 was on the URL
 */
export default function PifPrintTrigger({ autoPrint }: { autoPrint: boolean }) {
  useEffect(() => {
    const btn = document.querySelector<HTMLButtonElement>('button[data-print-trigger="true"]');
    if (btn) btn.onclick = () => window.print();
    if (autoPrint) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [autoPrint]);

  return null;
}
