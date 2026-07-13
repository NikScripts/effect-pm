/**
 * **Logs** — one module for node-wide log capture, relay, and durable query.
 *
 * @remarks
 * ## Node log key (durable bucket)
 *
 * The first argument to {@link persistLayer} and {@link byNode} is the **node log key** — it
 * **must** equal the {@link Resource.Node} `.key` for that OS process (the same string
 * {@link Resource.selfNode} returns). It is stamped as `annotations.node` and stored as
 * `LogStore` `groupId`. Use slash-separated paths (`billing/scores`), not invented placeholders.
 *
 * See `docs/LOGS.md` for the full **key catalog** (key kind, package path, source, example path).
 *
 * ## Surface
 *
 * - **`layer`** — {@link Relay} bus + exactly one merged capture {@link Logger}.
 * - **`stream`** / **`snapshot`** — unfiltered live bus (+ bounded tail).
 * - **`persistLayer`** — batched durable writer (relay subscriber; no second logger).
 * - **`withScope`** — lineage annotation at resource materialize.
 * - **`byNode`** / **`byResource`** — durable reads from {@link LogStore}.
 *
 * Per-resource live + durable export: {@link Resource.logs} / {@link Resource.withLogExport}.
 *
 * @example Node log key from `Resource.Node`
 * ```ts
 * import * as Resource from "@nikscripts/effect-pm/Resource";
 * import * as Logs from "@nikscripts/effect-pm/Logs";
 * import { LogStore } from "@nikscripts/effect-pm/store/Log";
 *
 * class BillingNode extends Resource.Node<BillingNode>("billing/scores") {}
 *
 * const logStack = Logs.persistLayer(BillingNode).pipe(
 *   Layer.provideMerge(Layer.mergeAll(Logs.layer, LogStore.layerMemory)),
 * );
 *
 * yield* Logs.byNode(BillingNode, { limit: 200 });
 * ```
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

/**
 * **Node log key** — durable bucket id for one runtime host. Must equal {@link Resource.Node} `.key`
 * (same string as {@link Resource.selfNode}). Stored as `LogStore` `groupId` and `annotations.node`.
 *
 * @see `docs/LOGS.md` — Key catalog → Node log keys
 *
 * @public
 */
export type NodeLogKey = string;

/**
 * **Resource key** — identity of a queue, process, or tag (`Resource.Tag.key`). Used in lineage,
 * `byResource`, and {@link LogEntry.hasKey}.
 *
 * @see `docs/LOGS.md` — Key catalog → Resource keys
 *
 * @public
 */
export type ResourceLogKey = string;

/** Source carrying a **node log key** (`Resource.Node.key`). @public */
export type NodeLogKeySource = { readonly key: NodeLogKey };

/**
 * Resolve the **node log key** from a {@link Resource.Node} (or any `{ key }` source).
 *
 * @param node - `Resource.Node` class or `{ key: NodeLogKey }`
 * @returns The node log key (`node.key`)
 *
 * @public
 */
export const nodeLogKey = (node: NodeLogKeySource): NodeLogKey => node.key;

const resolveNodeLogKey = (node: NodeLogKey | NodeLogKeySource): NodeLogKey =>
  typeof node === "string" ? node : node.key;

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
 * Batched durable writer for a node bucket.
 *
 * @param node - {@link NodeLogKey} or {@link Resource.Node} (uses `.key`). Must match
 *   {@link byNode} / {@link Resource.selfNode} for the same process.
 *
 * @remarks
 * Compose with {@link layer} and {@link LogStore} **inside** `provideMerge` — see `docs/LOGS.md`.
 *
 * @public
 */
export const persistLayer = (
  node: NodeLogKey | NodeLogKeySource,
): ReturnType<typeof persistFollowerLayer> => persistFollowerLayer(resolveNodeLogKey(node));

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
 * Read durable logs for a **whole node** (every resource on that process).
 *
 * @param node - {@link NodeLogKey} or {@link Resource.Node} `.key` — same value passed to
 *   {@link persistLayer}.
 *
 * @public
 */
export const byNode = (
  node: NodeLogKey | NodeLogKeySource,
  options?: LogReadOptions,
): Effect.Effect<ReadonlyArray<LogEntry>, never, LogStore> =>
  runQuery({
    groupId: resolveNodeLogKey(node),
    limit: options?.limit ?? queryLimitDefault,
    sort: options?.sort ?? "desc",
    ...(options?.from === undefined ? {} : { from: options.from }),
    ...(options?.to === undefined ? {} : { to: options.to }),
  });

/**
 * Read durable logs for a **specific resource** (filter by **resource key** annotations).
 *
 * @param resource.processId - **Resource key** of a `Process.Tag` (`tag.key`, e.g. `wnba/LiveScorePoller`).
 * @param resource.queueId - **Resource key** of a `QueueResource.Tag` (`tag.key`, e.g. `wnba/BoxScoreQueue`).
 *
 * @remarks
 * Prefer {@link Resource.logs} + {@link LogEntry.hasKey} for new code. See `docs/LOGS.md` — Store / query parameters.
 *
 * @public
 */
export const byResource = (
  resource: { readonly processId?: ResourceLogKey; readonly queueId?: ResourceLogKey },
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
