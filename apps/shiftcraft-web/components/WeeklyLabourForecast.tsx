import {
  fmtHours,
  fmtMoney,
  type LabourForecast,
} from "~/lib/labour-forecast";

interface Props {
  forecast: LabourForecast;
}

export function WeeklyLabourForecast({ forecast }: Props) {
  const {
    totalCost,
    totalHours,
    shiftCount,
    uncoveredCount,
    missingRateCount,
    byLocation,
  } = forecast;

  if (shiftCount === 0) return null;

  const hasCaveats = uncoveredCount > 0 || missingRateCount > 0;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Projected labour cost</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Based on published shifts this week × each accepted employee's
            hourly rate.
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">
            {fmtMoney(totalCost)}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {fmtHours(totalHours)} across {shiftCount} shift
            {shiftCount === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {byLocation.length > 1 && (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {byLocation.map((loc) => (
            <li
              key={loc.locationId ?? "_none"}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="truncate">
                {loc.locationName ?? "Unassigned"}
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {fmtHours(loc.hours)} ·{" "}
                <span className="font-semibold text-foreground">
                  {fmtMoney(loc.cost)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasCaveats && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          {uncoveredCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 font-medium text-white">
              {uncoveredCount} uncovered shift
              {uncoveredCount === 1 ? "" : "s"}
            </span>
          )}
          {missingRateCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 font-medium text-white">
              {missingRateCount} accepted shift
              {missingRateCount === 1 ? "" : "s"} with no rate set
            </span>
          )}
          <span className="text-muted-foreground">
            — these aren't counted in the total.
          </span>
        </div>
      )}
    </section>
  );
}
