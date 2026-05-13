import { createClient } from "@/lib/supabase/server";
import PackLevelsManager from "./_components/pack-levels-manager";
import { TENANT_FULL_FETCH } from "@/lib/limits";

export default async function PackLevelsPage() {
  const supabase = await createClient();

  const { data: levels } = await supabase
    .from("tenant_pack_level_defs")
    .select("*")
    .order("sort_order")
    .order("code");

  // Usage count: how many items reference each level code in their
  // pack_levels JSON. Surface this on the row so admins can see at a
  // glance whether a level is safe to deactivate / delete.
  const { data: items } = await supabase
    .from("items")
    .select("pack_levels")
    .not("pack_levels", "is", null)
    .limit(TENANT_FULL_FETCH);

  const usage: Record<string, number> = {};
  type LevelEntry = { code?: string };
  for (const it of items ?? []) {
    const pl = (it as { pack_levels: unknown }).pack_levels;
    if (!Array.isArray(pl)) continue;
    for (const lvl of pl as LevelEntry[]) {
      const code = (lvl?.code ?? "").toString().trim();
      if (!code) continue;
      usage[code] = (usage[code] ?? 0) + 1;
    }
  }

  return <PackLevelsManager initialLevels={levels ?? []} usage={usage} />;
}
