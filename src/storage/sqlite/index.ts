/**
 * SQLite-backed {@link RuntimeStorageService} for normalized runtime records.
 *
 * @packageDocumentation
 *
 * ## Import path
 *
 * ```ts
 * import { SQLiteRuntimeStorage } from "@nikscripts/effect-pm/storage/sqlite";
 * ```
 *
 * ## Semantics contract
 *
 * This adapter intentionally matches {@link RuntimeStorage.memory}:
 *
 * - Default read ordering is **`occurredAt` descending** when `orderBy` is omitted.
 * - All {@link RuntimeRecordQuery} predicates behave the same as the in-memory
 *   reference implementation.
 * - `create` fails with {@link RuntimeStorageDuplicateRecordError} on duplicate `id`.
 * - `upsert` fails with {@link RuntimeStorageReadonlyRecordError} when the stored
 *   row is marked readonly.
 * - `update` / `delete` follow the same readonly counting and skip rules documented
 *   in `docs/RUNTIME-STORAGE-ADAPTER-GUIDE.md`.
 *
 * The implementation achieves parity by loading the full table and delegating
 * to {@link selectRuntimeRecords} and {@link applyRuntimeRecordPatch} from
 * `RuntimeStorage.ts`. That is simple, testable, and correct for moderate
 * volumes; very large tables will want a SQL-native strategy in a future adapter
 * revision while keeping this module as the semantic reference.
 *
 * ## Effect SQL
 *
 * Persistence goes through `effect/unstable/sql`’s {@link SqlClient} via
 * `@effect/sql-sqlite-node` (a scoped `SqliteClient` per configuration). Logical
 * storage errors keep their tagged types; other SQL failures are treated as
 * defects on read/update/delete paths (`Effect.orDie`) so the public port stays
 * aligned with the in-memory reference’s `never` error channel on those methods.
 *
 * ## Lifecycle
 *
 * - {@link SQLiteRuntimeStorage.make} installs the schema and returns the port
 *   while the caller’s {@link Scope.Scope} stays open (provide it with
 *   {@link Effect.scoped} or a `Layer` that manages scope).
 * - {@link SQLiteRuntimeStorage.layer} merges `SqliteClient.layer` with a
 *   {@link RuntimeStorage} service that performs the same schema bootstrap.
 * - {@link SQLiteRuntimeStorage.fromSqlClient} targets a {@link SqlClient} you
 *   already have in context (shared pool, tests, or custom layers).
 *
 * @module storage/sqlite
 */

import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Context, Effect, Layer, Scope } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { ProcessStore } from "../../ProcessStore";
import type { ProcessStoreGroupLog } from "../../ProcessStoreGroupLog";
import type { ProcessStoreQueueResource } from "../../ProcessStoreQueueResource";
import { RuntimeStorage } from "../../RuntimeStorage";
import type {
  DeleteResult,
  RuntimeRecord,
  RuntimeStorageService,
  UpdateResult,
} from "../../RuntimeStorage";
import { installRuntimeRecordsSchema } from "./ddl";
import type { SQLiteRuntimeStorageConfig } from "./public-types";
import { makeSqliteRuntimeStorageService } from "./service";

export type { SqliteClientConfig } from "@effect/sql-sqlite-node/SqliteClient";
export type { SQLiteRuntimeStorageConfig } from "./public-types";
export type { DeleteResult, RuntimeRecord, RuntimeStorageService, UpdateResult };

/**
 * Open a database file (or `:memory:`), install the schema, and return the
 * storage port for the lifetime of the outer {@link Scope.Scope}.
 *
 * @remarks
 * Schema installation can fail with {@link SqlError} (for example invalid
 * permissions on the database file). Synchronous failures from the native driver
 * during construction follow the `SqliteClient` upstream semantics.
 */
export const makeRuntimeStorage = (
  config: SQLiteRuntimeStorageConfig,
): Effect.Effect<RuntimeStorageService, SqlError, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const context = yield* Layer.buildWithScope(SqliteClient.layer(config), scope);
    const sql = Context.get(context, SqlClient);
    yield* installRuntimeRecordsSchema(sql);
    return makeSqliteRuntimeStorageService(sql);
  });

/**
 * `Layer` that provides {@link RuntimeStorage} backed by SQLite, using the same
 * scoped `SqliteClient` lifecycle as {@link SqliteClient.layer}.
 */
export const layerRuntimeStorage = (
  config: SQLiteRuntimeStorageConfig,
): Layer.Layer<RuntimeStorage, SqlError, Scope.Scope> =>
  Layer.effect(
    RuntimeStorage,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const context = yield* Layer.buildWithScope(SqliteClient.layer(config), scope);
      const sql = Context.get(context, SqlClient);
      yield* installRuntimeRecordsSchema(sql);
      return makeSqliteRuntimeStorageService(sql);
    }),
  );

/**
 * Install the runtime-records schema on an existing {@link SqlClient} and return
 * the storage port.
 */
export const fromSqlClient = (
  sql: SqlClient,
): Effect.Effect<RuntimeStorageService, SqlError> =>
  Effect.gen(function* () {
    yield* installRuntimeRecordsSchema(sql);
    return makeSqliteRuntimeStorageService(sql);
  });

/**
 * Facade namespace mirroring other storage entry points (`FileProcessStore`, …).
 *
 * @public
 */
/**
 * `ProcessStore` backed by SQLite {@link RuntimeStorage}.
 *
 * @remarks
 * Import from `@nikscripts/effect-pm/storage/sqlite` when you need durable local storage.
 * Keeps `@effect/sql-sqlite-node` off the core `ProcessStore` entry.
 *
 * @public
 */
export const layerProcessStore = (
  config: SQLiteRuntimeStorageConfig,
): Layer.Layer<
  ProcessStore | ProcessStoreGroupLog | ProcessStoreQueueResource,
  never,
  Scope.Scope
> =>
  Layer.provide(ProcessStore.layerRuntimeStorage, layerRuntimeStorage(config)).pipe(Layer.orDie);

export const SQLiteRuntimeStorage = {
  make: makeRuntimeStorage,
  layer: layerRuntimeStorage,
  layerProcessStore,
  fromSqlClient,
} as const;
