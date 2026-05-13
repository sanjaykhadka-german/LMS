/**
 * Centralised query-row caps used across the app.
 *
 * Most "fetch all rows in this tenant" queries (items list, suppliers list,
 * the tree on item detail, picker dropdowns, etc.) used to be hardcoded to
 * `.limit(5000)`. That breaks for tenants with large catalogues. We changed
 * to a single big constant so we can move it in one place when the next
 * ceiling comes — and so it's obvious where the cap actually applies.
 *
 * 100,000 is high enough that no realistic butchery / food-manufacturing
 * tenant should hit it for items, customers, suppliers, locations, or
 * barcodes for many years.
 *
 * NOTE: this is a STOPGAP. The proper long-term answer for very large
 * tenants is server-side searching / pagination on every dropdown and
 * picker, plus virtualised list rendering. Until that's in, prefer this
 * constant over re-introducing magic numbers.
 */
export const TENANT_FULL_FETCH = 100_000;
