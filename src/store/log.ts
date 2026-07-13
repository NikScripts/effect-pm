/**
 * **Structured log storage facet** — durable sink for the Logs pipeline.
 *
 * `groupId` on {@link LogStoreApi.record} / `load` is the **node log key** (`Resource.Node.key`),
 * not an RPC `groupId` or invented placeholder. See `docs/LOGS.md`.
 *
 * @module store/Log
 */

import { Effect, Option } from "effect";
import type { LogLevel } from "effect/LogLevel";
import type { LogEntry } from "../LogEntry";
import type { LogQuery } from "../internal/manager/logQuery";
import { LogQueryError } from "../internal/manager/logQuery";
import { StoreWriteError } from "../internal/store/errors";
import {
  builtInLogStoreContract,
  type LogStoreHandle,
} from "../internal/store/logStoreSpec";
import * as Store from "../Store";

const LOG_STORE_ID = "@nikscripts/effect-pm/store/log/LogStore";
const LOG_SCOPE = LOG_STORE_ID;

const logContract = builtInLogStoreContract();

/** @public */
export interface LogEntryRecordedEvent {
  readonly type: "log.entry";
  readonly entityType: "log";
  readonly log: {
    readonly entryId: string;
    readonly entry: {
      readonly date: string;
      readonly level: LogLevel;
      readonly message: string;
      readonly cause?: string;
      readonly annotations: Readonly<Record<string, string>>;
      readonly spans: ReadonlyArray<string>;
    };
  };
}

/** @public */
export const isLogEntryRecorded = (
  event: { readonly type: string; readonly entityType: string },
): event is LogEntryRecordedEvent =>
  event.type === "log.entry" && event.entityType === "log";

/**
 * Service shape for {@link LogStore}.
 *
 * @public
 */
export interface LogStoreApi {
  readonly record: (
    groupId: string,
    entryId: string,
    entry: LogEntry,
  ) => Effect.Effect<void, StoreWriteError>;
  readonly recordBatch: (
    groupId: string,
    rows: ReadonlyArray<{ readonly entryId: string; readonly entry: LogEntry }>,
  ) => Effect.Effect<void, StoreWriteError>;
  readonly load: (
    query: LogQuery,
  ) => Effect.Effect<ReadonlyArray<LogEntry>, LogQueryError>;
  readonly query: (
    logQuery: LogQuery,
  ) => Effect.Effect<void, LogQueryError>;
}

const asApi = (handle: LogStoreHandle): LogStoreApi => handle as unknown as LogStoreApi;

/**
 * Context tag for {@link LogStoreApi}.
 *
 * @public
 */
export class LogStore extends Store.Service<LogStore>(LOG_STORE_ID)(
  Store.register(LOG_SCOPE, logContract),
) {
  /** Optional static emit when the store layer is absent. @public */
  static record: (
    groupId: string,
    entryId: string,
    entry: LogEntry,
  ) => Effect.Effect<void, StoreWriteError>;

  /** Optional static emit when the store layer is absent. @public */
  static recordBatch: (
    groupId: string,
    rows: ReadonlyArray<{ readonly entryId: string; readonly entry: LogEntry }>,
  ) => Effect.Effect<void, StoreWriteError>;
}

const optionalEmit =
  <Args extends ReadonlyArray<unknown>>(
    invoke: (store: LogStoreApi, ...args: Args) => Effect.Effect<void, StoreWriteError>,
  ) =>
  (...args: Args): Effect.Effect<void, StoreWriteError> =>
    Effect.serviceOption(LogStore).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (store) => invoke(asApi(store), ...args),
        }),
      ),
    );

LogStore.record = optionalEmit((store, groupId, entryId, entry) =>
  store.record(groupId, entryId, entry),
);
LogStore.recordBatch = optionalEmit((store, groupId, rows) => store.recordBatch(groupId, rows));

/** @public */
export const catchErrorAndLog =
  (options: { readonly message: string; readonly annotations?: Readonly<Record<string, string>> }) =>
  <A, E, R>(
    effect: Effect.Effect<A, E | StoreWriteError, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.catchIf(
      effect,
      (error): error is StoreWriteError => error instanceof StoreWriteError,
      () =>
        Effect.logWarning(options.message, options.annotations ?? {}).pipe(
          Effect.as(void 0 as A),
        ),
    );

/** @public */
export const layerMemory = LogStore.layerMemory;

/** @public */
export const layer = LogStore.layer;

/**
 * @deprecated Use {@link layerMemory} or {@link layer}.
 * @public
 */
export const layerRuntimeStorage = LogStore.layerMemory;

/** @public */
export declare namespace LogStore {
  export type Type = LogStoreApi;
  export type EmitType = Pick<LogStoreApi, "record" | "recordBatch">;
}
