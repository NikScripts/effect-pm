/**
 * Pure {@link Store.Service} layer helpers — bundle assembly + SQL error mapping.
 *
 * The `Layer.succeed(Storage, …)` layer builders live in `src/Store.ts`, co-located with the
 * `Storage` service tag; this leaf keeps only the tag-free pieces they consume.
 *
 * @module internal/store/sqliteLayer
 * @internal
 */

import { Effect } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { StorageApi } from "./bridge";
import type { StoreBundle } from "./defineStore";
import { StoreScopeNotRegistered, StoreSqliteConnectionError } from "./errors";
import type { NormalizedStoreRegistration } from "./registrationNormalize";

/** @internal */
export const buildBundle = <Regs extends ReadonlyArray<NormalizedStoreRegistration>>(
  registrations: Regs,
  acquire: StorageApi["at"],
): Effect.Effect<StoreBundle<Regs>, StoreScopeNotRegistered> =>
  Effect.gen(function* () {
    const bundle: Record<string, unknown> = {};
    for (const registration of registrations) {
      bundle[registration.accessor] = yield* acquire(
        registration.scopeKey,
        registration.contract ?? registration.spec,
      );
    }
    return bundle as StoreBundle<Regs>;
  });

/** @internal */
const sqliteConnectionError = (cause: SqlError | unknown): StoreSqliteConnectionError =>
  new StoreSqliteConnectionError({ cause });

/** @internal */
export const mapSqliteBuildError = (
  error: SqlError | StoreSqliteConnectionError,
): StoreSqliteConnectionError =>
  error instanceof StoreSqliteConnectionError ? error : sqliteConnectionError(error);
