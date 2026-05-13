# Tracey — German Butchery Planning & MRP

You're working on **Tracey**, a multi-industry food-manufacturing ERP/MRP being built by Tino (CEO at German Butchery) with Claude. The app is in production with German Butchery as the design partner; once it's robust it will be sold to other small-to-mid food manufacturers (butchers, cheesemakers, coffee roasters, cosmetics, etc.).

**Stack**: Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Auth + Storage + RLS) · Vercel.

**Codebase**: This repo (`german-butchery-planning-app/`). The B2B customer portal lives in a separate `german-butchery-portal/` Supabase project.

---

## How to orient yourself in a new session

Before doing any work, read these in order — total ~5 minutes:

1. **`docs/master-plan.md`** — strategic direction, what we're building and why.
2. **`docs/active-threads.md`** — what's in flight, what's blocked, what's next.
3. **`docs/conventions.md`** — code rules, file-handling gotchas, migration patterns.
4. **`docs/decisions/`** — read the last 2-3 dated entries for recent architecture choices.
5. **`git log --oneline -20`** — the last 20 commits give you the conversational arc.

When the user asks a question that touches a topic with a doc in `docs/`, **read that doc before responding** — it'll have nuance you'd otherwise miss.

When you finish a meaningful chunk of work:
- Update `docs/active-threads.md` (tick off, add new items).
- If you made an architectural choice, write a one-page ADR to `docs/decisions/YYYY-MM-<topic>.md`.
- Keep `docs/<area>-roadmap.md` current for any area you touched (e.g. `costings-roadmap.md`).

---

## Critical file-handling conventions

The path to this repo contains parentheses (`German Butchery Planning App (1)`). The `Edit` and `Write` tools sometimes truncate files when the path contains parens. **You will hit this.** Workarounds:

- For substantial edits (>50 lines), prefer `python3 << 'PYEOF'` heredoc via `mcp__workspace__bash` with explicit anchor strings, not the `Edit` tool.
- After any large edit, run `wc -l` and `tail -5` to verify the file isn't truncated.
- If you find a file ending mid-statement, restore from git: `git show HEAD:path > /tmp/restore && cp /tmp/restore path`, then re-apply via python.
- Some files also acquire trailing null bytes — strip with `python3 -c "d=open(p,'rb').read(); open(p,'wb').write(d.rstrip(b'\\x00'))"`.

The `bash` git operations sometimes can't remove `.git/index.lock` due to permissions. The user clears it from Windows side with `Remove-Item .git\index.lock -Force` before pushing. Don't waste time fighting the lock from inside bash.

---

## Database migrations

- Numbered sequentially: `supabase/migrations/NNN_short_name.sql`.
- Latest applied: check `git log supabase/migrations/ -- | head -20` or `ls supabase/migrations/ | sort | tail`.
- Apply via the Supabase MCP `apply_migration` tool with `project_id = rumrailjksnybblvrjnx` (project "tracey").
- Two projects exist: **tracey** (main app, `rumrailjksnybblvrjnx`) and **german-butchery-portal** (customer portal, `twckebwkqmywrvwuspcn`). Almost always you want the first.

### Key DB objects

- `items`, `bom_headers`, `bom_lines` — the recipe master.
- `production_orders` — WOs with batch_size, n_of_batches, run_sequence, machine_id, status.
- `demand_plans` — weekly plans; `mrp_results` is the cascade output.
- `v_item_cost_health` — RM cost per item (preferred supplier → cheapest → highest cascade).
- `v_item_landed_cost_v1` — recursive RM cost cascade for FG/WIP (skips non-kg packaging, see costings-roadmap.md).
- `test_product_cascade(item_id, qty, uom)` — RPC: full cascade with shopping list + costs for one item.
- `explode_mrp` — the planning cascade.
- `mrp_overrides` — per-item-per-dept manual qty overrides.

---

## The product mental model

Tino's vocabulary (which the user-facing app respects via tenant vocab settings):

- **Item types**: raw_material, packaging, consumable, wip (block stage), wipf (filled stage), wipp (packed stage), finished_good.
- **Departments**: Production (recipe block), Filling (stuffing into casings/skins), Cooking, Packing, Labelling.
- **Random-weight vs fixed-weight FG**: random is sold by kg (Ham logs), fixed is sold by piece (3-pack pasteurised Bratwurst).

Every BOM line should be readable as natural English: "**N × item per M [scope]**" where scope is kg / unit / inner / outer / pallet. The (N, M) pair is captured separately from the math (`qty_per_batch` = N/M; `consume_per_qty` = M). See `docs/bom-data-model.md` for the full design.

---

## Active areas (May 2026)

- **Costings** (Phase 1 shipped, /costings): live RM cascade per item.
- **BOM data overhaul** (in flight): the natural-language entry pattern, see `docs/bom-data-model.md`.
- **Planning**: stable, running with Tracey as design partner.
- **Run order**: stable.

See `docs/active-threads.md` for the current list with status.
