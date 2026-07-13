/**
 * **Logs** — one module for node-wide log capture, relay, and durable query.
 *
 * @remarks
 * - **`layer`** — {@link Relay} bus + exactly one merged capture {@link Logger}.
 * - **`stream`** / **`snapshot`** — unfiltered live bus (+ bounded tail).
 * - **`persistLayer`** — batched durable writer (subscribes to relay; no second logger).
 * - **`withScope`** — lineage reducer at resource materialize.
 *
 * Durable history uses {@link LogStore} (`Store.contract` bridge). Per-resource reads use
 * {@link Resource.logs} when export is piped on the tag.
 *
 * @module Logs
 */

import { Effect } from "effect";
import type { LogEntry } from "./LogEntry";
import type { LogQuery, LogSort } from "./internal/manager/logQuery";
import { LogQueryError } from "./internal/manager/logQuery";
import { withLogScope } from "./internal/logs/scope";
import * as relay from "./internal/logs/relay";
import { persistLayer as persistFollowerLayer } from "./internal/logs/storeFollower";
import { LogStore, type LogStoreApi } from "./store/log";

const asStore = (handle: LogStore.Type): LogStoreApi => handle as unknown as LogStoreApi;

/** In-process log bus tag. @public */
export const Relay = relay.LogRelay;

/** @public */
export type LogRelayService = relay.LogRelayService;

/** Node root: relay + one merged capture logger. @public */
export const layer = relay.layer;

/** Unfiltered live bus (snapshot prefix + PubSub). @public */
export const stream = relay.stream;

/** Bounded tail read. @public */
export const snapshot = relay.snapshot;

/** Replay one captured line through the ambient Logger. @public */
export const replay = relay.replayLogEntry;

/** Append `tag.key` to fiber lineage at materialize. @public */
export const withScope = withLogScope;

/**
 * Batched durable writer for a node bucket — requires {@link layer} + {@link LogStore}.
 *
 * @public
 */
export const persistLayer = persistFollowerLayer;

const queryLimitDefault = 200;

/** Options shared by {@link byNode} / {@link byResource}. @public */
export interface LogReadOptions {
  readonly limit?: number;
  readonly sort?: LogSort;
  readonly from?: Date;
  readonly to?: Date;
}

const runQuery = (
  query: LogQuery,
): Effect.Effect<ReadonlyArray<LogEntry>, never, LogStore> =>
  Effect.flatMap(LogStore, (store) => asStore(store).load(query)).pipe(
    Effect.catchIf(
      (error): error is LogQueryError => error instanceof LogQueryError,
      () => Effect.succeed<ReadonlyArray<LogEntry>>([]),
    ),
    Effect.orDie,
  );

/**
 * Read durable logs for a whole node (every resource on it).
 *
 * @public
 */
export const byNode = (
  node: string,
  options?: LogReadOptions,
): Effect.Effect<ReadonlyArray<LogEntry>, never, LogStore> =>
  runQuery({
    groupId: node,
    limit: options?.limit ?? queryLimitDefault,
    sort: options?.sort ?? "desc",
    ...(options?.from === undefined ? {} : { from: options.from }),
    ...(options?.to === undefined ? {} : { to: options.to }),
  });

/**
 * Read durable logs for a specific resource (legacy `processId` / `queueId` filters).
 *
 * @public
 */
export const byResource = (
  resource: { readonly processId?: string; readonly queueId?: string },
  options?: LogReadOptions,
): Effect.Effect<ReadonlyArray<LogEntry>, never, LogStore> =>
  runQuery({
    ...(resource.processId === undefined ? {} : { processId: resource.processId }),
    ...(resource.queueId === undefined ? {} : { queueId: resource.queueId }),
    limit: options?.limit ?? queryLimitDefault,
    sort: options?.sort ?? "desc",
    ...(options?.from === undefined ? {} : { from: options.from }),
    ...(options?.to === undefined ? {} : { to: options.to }),
  });

/** @deprecated Use {@link layer}. @public */
export const relayWithCaptureLoggerLayer = layer;

/** @deprecated Use {@link layer}. @public */
export const logRelayLayer = relay.relayLayer;

/** @deprecated Use {@link Relay}. @public */
export const LogRelay = relay.LogRelay;

/** @deprecated Use {@link replay}. @public */
export const replayLogEntry = relay.replayLogEntry;

/** @deprecated Use {@link layer} internals — prefer {@link layer}. @public */
export const captureLogger = relay.captureLogger;

/** @deprecated Use {@link layer}. @public */
export const captureLoggerLayer = relay.captureLoggerLayer;

/** @deprecated Use {@link relayLayer}. @public */
export const relayOnlyLayer = relay.relayLayer;

/** @deprecated Use {@link relayLayer}. @public */
export const relayLayer = relay.relayLayer;

/** @deprecated Use {@link relayLayer}. @public */
export const logsRelayLayer = relay.relayLayer;
