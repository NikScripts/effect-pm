/**
 * Per-facet handle into the underlying {@link RuntimeStorageService}.
 *
 * @remarks
 * Storage facets compose against this thin handle instead of holding a
 * direct reference to {@link RuntimeStorage}. The factory
 * {@link makeProcessStoreSpine} stamps the package-level `runId` plus
 * `createdAt = occurredAt` onto every write and maps storage's
 * {@link RuntimeStorageError} channel into the public
 * {@link ProcessStoreWriteError} channel.
 *
 * @module internal/store/spine
 * @internal
 */

import { Effect } from "effect";
import type {
  RuntimeRecordPatch,
  RuntimeRecordQuery,
} from "../../Query";
import type { ProcessStoreWriteError } from "../../ProcessStoreEvent";
import type {
  DeleteResult,
  RuntimeRecord,
  RuntimeStorageOperationalError,
  RuntimeStorageService,
  UpdateResult,
} from "../../RuntimeStorage";
import { processStoreWriteErrorFromRuntimeStorage } from "./helpers";

/**
 * Per-facet view of the underlying {@link RuntimeStorageService}.
 *
 * @remarks
 * The spine is the **only** surface a facet body uses — it never sees
 * the raw {@link RuntimeStorage} tag. The factory injects `runId` and
 * `createdAt` on writes and lifts adapter errors into the public
 * {@link ProcessStoreWriteError} channel so facets can stay focused on
 * encoding / decoding their domain rows.
 *
 * @internal
 */
export interface ProcessStoreSpine {
  /** Stable per-layer run id stamped onto every write. */
  readonly runId: string;
  /** Insert one record. Storage assigns `runId` + `createdAt`. */
  readonly create: (
    record: Omit<RuntimeRecord, "runId" | "createdAt">,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  /** Insert many records (sequential under the hood; surfaces the first failure). */
  readonly createBatch: (
    records: ReadonlyArray<Omit<RuntimeRecord, "runId" | "createdAt">>,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  /** Run a `RuntimeRecordQuery`. Facets translate domain queries to predicates. */
  readonly read: (
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[], RuntimeStorageOperationalError>;
  /** Insert-or-replace one record. Storage assigns `runId` + `createdAt`. */
  readonly upsert: (
    record: Omit<RuntimeRecord, "runId" | "createdAt">,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  /** Patch matching rows. */
  readonly update: (
    query: RuntimeRecordQuery,
    patch: RuntimeRecordPatch,
  ) => Effect.Effect<UpdateResult, RuntimeStorageOperationalError>;
  /** Delete matching rows (skips readonly rows unless the predicate explicitly opts in). */
  readonly delete: (query: RuntimeRecordQuery) => Effect.Effect<DeleteResult, RuntimeStorageOperationalError>;
}

/** @internal */
export const makeProcessStoreSpine = (
  storage: RuntimeStorageService,
  runId: string,
): ProcessStoreSpine => {
  const stamp = (
    record: Omit<RuntimeRecord, "runId" | "createdAt">,
  ): RuntimeRecord => ({ ...record, runId, createdAt: record.occurredAt });
  const create = (record: Omit<RuntimeRecord, "runId" | "createdAt">) =>
    storage
      .create(stamp(record))
      .pipe(Effect.mapError(processStoreWriteErrorFromRuntimeStorage));
  const createBatch = (
    records: ReadonlyArray<Omit<RuntimeRecord, "runId" | "createdAt">>,
  ) => Effect.forEach(records, create, { discard: true });
  const upsert = (record: Omit<RuntimeRecord, "runId" | "createdAt">) =>
    storage
      .upsert(stamp(record))
      .pipe(Effect.mapError(processStoreWriteErrorFromRuntimeStorage));
  return {
    runId,
    create,
    createBatch,
    read: (query) => storage.read(query),
    upsert,
    update: (query, patch) => storage.update(query, patch),
    delete: (query) => storage.delete(query),
  };
};
