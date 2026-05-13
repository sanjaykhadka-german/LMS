import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  await supabase
    .from("profiles")
    .update({ force_password_change: false })
    .eq("id", user.id);

  return NextResponse.json({ ok: true });
}
