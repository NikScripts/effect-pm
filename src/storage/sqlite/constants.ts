/**
 * Shared identifiers for the SQLite `RuntimeStorage` adapter.
 *
 * @remarks
 * Keeping table and migration strings in one place avoids drift between DDL,
 * queries, and documentation. The physical name is namespaced with
 * `effect_pm_` to reduce collision risk when sharing a database file with
 * unrelated application tables.
 *
 * @module storage/sqlite/constants
 * @internal
 */

/** Physical SQLite table backing {@link RuntimeRecord} rows. */
export const RUNTIME_RECORDS_TABLE = "effect_pm_runtime_records" as const;
