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
  RuntimeStorageService,
  UpdateResult,
} from "../../RuntimeStorage";
import { processStoreWriteErrorFromRuntimeStorage } from "./helpers";

/**
 * Per-facet view of the underlying {@link RuntimeStorageService}.
 *
 * @internal
 */
export interface ProcessStoreSpine {
  readonly runId: string;
  readonly create: (
    record: Omit<RuntimeRecord, "runId" | "createdAt">,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly createBatch: (
    records: ReadonlyArray<Omit<RuntimeRecord, "runId" | "createdAt">>,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly read: (
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[]>;
  readonly upsert: (
    record: Omit<RuntimeRecord, "runId" | "createdAt">,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly update: (
    query: RuntimeRecordQuery,
    patch: RuntimeRecordPatch,
  ) => Effect.Effect<UpdateResult>;
  readonly delete: (query: RuntimeRecordQuery) => Effect.Effect<DeleteResult>;
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
