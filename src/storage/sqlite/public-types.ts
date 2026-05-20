/**
 * Public configuration types for the SQLite runtime storage adapter.
 *
 * @module storage/sqlite/public-types
 */

import type { SqliteClientConfig } from "@effect/sql-sqlite-node/SqliteClient";

/**
 * Configuration accepted by {@link makeRuntimeStorage} and
 * {@link layerRuntimeStorage}.
 *
 * @remarks
 * This is the same shape as {@link SqliteClientConfig} from
 * `@effect/sql-sqlite-node`: the adapter opens SQLite through Effect SQL’s
 * `SqliteClient` layer rather than exposing `better-sqlite3` directly.
 *
 * @public
 */
export type SQLiteRuntimeStorageConfig = SqliteClientConfig;
