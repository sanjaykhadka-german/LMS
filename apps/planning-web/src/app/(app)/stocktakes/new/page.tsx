import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BackButton } from "@/components/back-button";
import NewStocktakeForm from "./_form";

export const dynamic = "force-dynamic";

export default async function NewStocktakePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Default week commencing = Monday of the current week (server time).
  const today = new Date();
  // getDay() → 0=Sun … 6=Sat. We want Monday-based: how many days back to Monday.
  const dayIdx = today.getDay();          // Sun=0
  const offsetToMonday = dayIdx === 0 ? 6 : dayIdx - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - offsetToMonday);
  const mondayIso = monday.toISOString().slice(0, 10);

  return (
    <div style={{ maxWidth: "640px" }}>
      <BackButton href="/stocktakes" label="Stocktakes" />
      <div className="page-header">
        <div>
          <h1 className="page-title">New Stocktake</h1>
          <p className="page-subtitle">Pick the scope and the week, then start counting.</p>
        </div>
      </div>
      <NewStocktakeForm defaultWeekCommencing={mondayIso} />
    </div>
  );
}
