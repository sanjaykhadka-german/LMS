import Link from "next/link";

interface ReadOnlyBannerProps {
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "soon";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ReadOnlyBanner({
  status,
  trialEndsAt,
  currentPeriodEnd,
}: ReadOnlyBannerProps) {
  let message: string;
  if (status === "trialing") {
    message = `Your trial ended on ${fmtDate(trialEndsAt)}. The workspace is read-only — subscribe to make changes.`;
  } else if (status === "past_due") {
    // 7d grace window from current_period_end (matches accessLevelFor()).
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const periodEndMs = currentPeriodEnd ? new Date(currentPeriodEnd).getTime() : null;
    const blocksAtIso =
      periodEndMs && !Number.isNaN(periodEndMs)
        ? new Date(periodEndMs + SEVEN_DAYS_MS).toISOString()
        : null;
    message = `Last payment failed. The workspace is read-only until ${fmtDate(blocksAtIso)} — please update your payment method.`;
  } else {
    message = "The workspace is read-only.";
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 text-amber-900">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
        <span>{message}</span>
        <Link
          href="/app/billing"
          className="rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-amber-50 hover:bg-amber-800"
        >
          Manage billing
        </Link>
      </div>
    </div>
  );
}
