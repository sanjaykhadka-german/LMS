"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GenerateInvoiceButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true); setError(null);
    const res = await fetch(`/api/orders/${orderId}/generate-invoice`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409 && data.invoiceId) {
        // Already exists — just navigate to it
        router.push(`/invoices/${data.invoiceId}`);
        return;
      }
      setError(data.error ?? "Failed to generate invoice");
      setLoading(false);
      return;
    }
    router.push(`/invoices/${data.invoiceId}`);
  }

  return (
    <div>
      <button className="btn-primary" onClick={generate} disabled={loading}>
        {loading ? "Generating…" : "Generate Invoice"}
      </button>
      {error && <p style={{ color: "#dc2626", fontSize: "0.8125rem", margin: "0.375rem 0 0" }}>{error}</p>}
    </div>
  );
}
