/**
 * fetchAllRows — page through a Supabase select to bypass the project's
 * PostgREST max-rows cap (default 1000) which silently truncates `.limit()`
 * and forces incomplete pickers (Tino, Item Master at 1260 rows hitting
 * the 1000 cap and the stocktake item picker missing rows past row #1000,
 * May 2026).
 *
 * Pattern:
 *   const { data, error } = await fetchAllRows((from, to) =>
 *     supabase.from("items")
 *       .select("id, code, name, ...")
 *       .order("code")
 *       .range(from, to)
 *   );
 *
 * The factory builds one query per page; `range(from, to)` is appended to
 * each request. We loop in pageSize chunks until a short page comes back.
 *
 * For very large catalogues (>100k rows) bump `hardMax` at the call site —
 * the default ceiling is generous enough for any current tenant.
 */

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
  hardMax = 100_000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  let from = 0;
  while (from < hardMax) {
    const to = Math.min(from + pageSize - 1, hardMax - 1);
    const { data, error } = await build(from, to);
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}
