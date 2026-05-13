# Conventions & gotchas

## File handling

**The repo path contains parentheses** (`German Butchery Planning App (1)`). This causes the `Edit` and `Write` tools to occasionally truncate files. Symptoms:
- File ends mid-statement (e.g. `<th onClick={() => cycleS`)
- `wc -l` shows fewer lines than expected
- Trailing null bytes (`\x00`) appearing at end of file

Workarounds:
- For substantial edits (>50 lines or many anchored replacements), use `python3 << 'PYEOF'` heredoc via `mcp__workspace__bash`. Match exact anchor strings, assert, replace, write back.
- After every Edit-tool change to a big file, run `wc -l` and `tail -5` to verify integrity.
- If you find truncation: `git show HEAD:<path> > /tmp/restore && cp /tmp/restore <path>` then re-apply via python.
- Strip null bytes: `python3 -c "p='<path>'; d=open(p,'rb').read(); open(p,'wb').write(d.rstrip(b'\\x00'))"`

## Migration naming

`supabase/migrations/NNN_short_name.sql`. Numbers are sequential, no gaps. Check `ls supabase/migrations/ | sort | tail` for the next number.

When applying via Supabase MCP, the migration name (snake_case) goes in the `name` field and the SQL in `query`. The MCP tracks them server-side; the filename is a parallel record on disk for the codebase to track.

## Git locking

`.git/index.lock` sometimes exists with permissions that bash can't clear. Tino removes it from PowerShell with `Remove-Item .git\index.lock -Force` before pushing. Don't waste time fighting it from inside bash — flag to user, let them handle it.

## TypeScript checks

`npx tsc --noEmit` runs cleanly except for a known background of pre-existing Supabase typing errors (joined-array vs object on `.select()` results). When you change a file, grep tsc output for just your file:

```
npx tsc --noEmit 2>&1 | grep -E "(your-file|related-file)" | head -20
```

If your file isn't in the output, it's clean.

## CSS / typography conventions

- Headings: `.page-title`, `.page-subtitle`, `.page-header`. Don't roll your own.
- Buttons: `.btn-primary`, `.btn-secondary`. Inline `style={...}` for special cases is fine.
- Tables: `.data-table` baseline; the rich one is `<DataTable>` from `@/components/data-table`.
- Modals: `<DraggableModal>` from `@/components/draggable-modal` — drag from header bar, content area scrolls, `onClose` is required.
- Date formatting: `en-AU` locale, "long" / "short" weekday. The user is in Sydney.
- Money: `$X,XXX.XX` with `toLocaleString("en-AU", { minimumFractionDigits: 2 })`.
- Quantities: `kg → 3 decimals`, every other unit → integer. See `fmtQty(value, unit)` patterns in run-sheet print.

## Component layout

Tracey's pages live under `src/app/(app)/<route>/page.tsx` (server component) + an underscore-prefixed sub-folder for client components. Example:

```
src/app/(app)/costings/
  page.tsx                             ← server: fetches + props
  _components/
    costings-table.tsx                 ← client: interactive
```

Server components do all data fetching with `createClient()` from `@/lib/supabase/server` and `getTenantId()` from `@/lib/tenant`. Client components use `createClient()` from `@/lib/supabase/client` (no tenant call needed — RLS handles it).

## Vocabulary system

Tenant-customisable terminology lives in `tenant_labels` (or whatever the current name is — check migrations 14-23). Read with `useTenantLabels()` hook on the client, or `getTenantLabels()` server-side.

When you label a UI control with a noun that could mean different things to different tenants (unit / department / dispatch / etc.), wire it through the vocab system. Hard-coding "unit" loses information; using `labels.unit` lets a cheesemaker render it as "wheel" without changing code.

## "Don't break the floor"

Anything that touches `production_orders` after `published_at IS NOT NULL` is sensitive. The floor's read-only-ish view depends on stable WO records. Server actions that modify published orders should refuse (return error) rather than mutate silently. See `publishDeptOrders` / `unpublishDeptOrders` for the toggle.

## Naming

- The product is called **Tracey** (not "the app", not "Claude's thing"). Internal references in code use `tracey` lowercase.
- The user is **Tino**, CEO of German Butchery.
- The customer is the small-mid food manufacturer who installs Tracey — a "tenant" in the multi-tenant database.

## Decision records

Major architectural or product decisions get a one-page record in `docs/decisions/YYYY-MM-<topic>.md`. Keeps the "why we did it this way" durable across sessions.
