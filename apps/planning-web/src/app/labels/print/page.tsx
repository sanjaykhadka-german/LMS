import { Suspense } from "react";
import LabelPrintClient from "./_client";

export const dynamic = "force-dynamic";

export default function LabelPrintPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem", fontFamily: "sans-serif" }}>Loading label…</div>}>
      <LabelPrintClient />
    </Suspense>
  );
}
