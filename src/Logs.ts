/**
 * **Logs** — one module for node-wide log capture, relay, and durable query.
 *
 * @remarks
 * ## Node log key (durable bucket)
 *
 * The argument to {@link byNode} is the **node log key** — it **must** equal the
 * {@link Node.Tag} `.key` for that OS process (the same string {@link Resource.selfNode}
 * returns). Register `Node.logs` on a {@link Store.Service}; the durable tail stamps
 * `annotations.node`. Use slash-separated paths (`billing/scores`).
 *
 * See `docs/LOGS.md` for the full **key catalog** (key kind, package path, source, example path).
 *
 * ## Surface
 *
 * - **`layer`** — {@link Relay} bus + exactly one merged capture {@link Logger}
 *   (also baked into {@link Store.Service} `layerMemory` / `layer`).
 * - **`stream`** / **`snapshot`** — unfiltered live bus (+ bounded tail).
 * - **Durable tails** — each store registration with an implicit `_logs` shape forks a Stream
 *   follower (`Node.logs`, `Process.store`, …). The shape is Effect-style private (omitted from
 *   public handle types); read via {@link Resource.logs} / {@link byNode} / {@link byResource}.
 * - **`withScope`** — lineage annotation at resource materialize.
 * - **`byNode`** / **`byResource`** — durable reads from registration Storage.
 *
 * Per-resource live + durable export: {@link Resource.logs} / {@link Resource.withLogExport}.
 *
 * @example Node journal via `Store.Service`
 * ```ts
 * import * as Resource from "@nikscripts/effect-pm/Resource";
 * import * as Logs from "@nikscripts/effect-pm/Logs";
 * import * as Process from "@nikscripts/effect-pm/Process";
 * import * as Store from "@nikscripts/effect-pm/Store";
 *
 * class BillingNode extends Node.Tag<BillingNode>("billing/scores") {}
 * class Daily extends Process.Tag<Daily>()("app/Daily") {}
 *
 * class AppStore extends Store.Service<AppStore>("@app/Store")(
 *   BillingNode.logs,
 *   Process.store(Daily),
 * ) {}
 *
 * Effect.provide(program, AppStore.layerMemory)
 * yield* Logs.byNode(BillingNode, { limit: 200 })
 * ```
 *
 * @module Logs
 */

import { Effect } from "effect";
import type { LogEntry } from "./LogEntry";
import type { LogSort } from "./internal/manager/logQuery";
import { queryDurableNode, queryDurableScope } from "./internal/logs/durableRead";
import { withLogScope } from "./internal/logs/scope";
import * as relay from "./internal/logs/relay";
import * as Node from "./Node";

/**
 * **Node log key** — durable bucket id for one runtime host. Must equal {@link Node.Tag} `.key`
 * (same string as {@link Resource.selfNode}). Stored as `annotations.node` on node-journal lines.
 *
 * @see `docs/LOGS.md` — Key catalog → Node log keys
 *
 * @category models
 * @public
 */
export type NodeLogKey = string;

/**
 * **Resource key** — identity of a queue, process, or tag (`Resource.Tag.key`). Used in lineage,
 * `byResource`, and {@link LogEntry.hasKey}.
 *
 * @see `docs/LOGS.md` — Key catalog → Resource keys
 *
 * @category models
 * @public
 */
export type ResourceLogKey = string;

/**
 * Source carrying a **node log key** (`Node.Tag.key`).
 *
 * @category models
 * @public
 */
export type NodeLogKeySource = { readonly key: NodeLogKey };

/**
 * Resolve the **node log key** from a {@link Node.Tag} (or any `{ key }` source).
 *
 * @param node - `Node.Tag` class or `{ key: NodeLogKey }`
 * @returns The node log key (`node.key`)
 *
 * @category utils
 * @public
 */
export const nodeLogKey = (node: NodeLogKeySource): NodeLogKey => node.key;

const resolveNodeLogKey = (node: NodeLogKey | NodeLogKeySource): NodeLogKey =>
  typeof node === "string" ? node : node.key;

/**
 * In-process log bus tag.
 *
 * @category context
 * @public
 */
export const Relay = relay.LogRelay;

/**
 *
 * @category models
 * @public
 */
export type LogRelayService = relay.LogRelayService;

/**
 * Node root: relay + one merged capture logger.
 *
 * @category layers & serving
 * @public
 */
export const layer = relay.layer;

/**
 * Unfiltered live bus (snapshot prefix + PubSub).
 *
 * @category reads
 * @public
 */
export const stream = relay.stream;

/**
 * Bounded tail read.
 *
 * @category reads
 * @public
 */
export const snapshot = relay.snapshot;

/**
 * Replay one captured line through the ambient Logger.
 *
 * @category utils
 * @public
 */
export const replay = relay.replayLogEntry;

/**
 * Append `tag.key` onto the fiber lineage at materialize (nested scopes combine into a path).
 *
 * Idempotent when `tag.key` is already the last segment. Does not auto-inject a node root.
 *
 * @category utils
 * @public
 */
export const withScope = withLogScope;

const queryLimitDefault = 200;

/**
 * Options shared by {@link byNode} / {@link byResource}.
 *
 * @category models
 * @public
 */
export interface LogReadOptions {
  readonly limit?: number;
  readonly sort?: LogSort;
  readonly from?: Date;
  readonly to?: Date;
}

/**
 * Read durable logs for a **whole node** (every resource on that process).
 *
 * Needs `Node.logs` / `Resource.store(Node)` on an app {@link Store.Service} (Soft-override the
 * toolkit layer — see `docs/guides/stores.md`). Soft-default Memory alone is engine observability
 * only — no Logs platform / durable `_logs` tails.
 *
 * @category reads
 * @public
 */
export const byNode = (
  node: NodeLogKey | NodeLogKeySource,
  options?: LogReadOptions,
): Effect.Effect<ReadonlyArray<LogEntry>> =>
  queryDurableNode(resolveNodeLogKey(node), {
    limit: options?.limit ?? queryLimitDefault,
  });

/**
 * Source carrying a **resource key** (`Resource.Tag.key` / store registration key).
 *
 * @category models
 * @public
 */
export type ResourceLogKeySource = { readonly key: ResourceLogKey };

const resolveResourceLogKey = (
  resource: ResourceLogKey | ResourceLogKeySource,
): ResourceLogKey => (typeof resource === "string" ? resource : resource.key);

/**
 * Read durable logs for a **specific resource** by **full key** (same string as
 * {@link Resource.logs}`(tag)` / store registration / lineage segment).
 *
 * Pass a scope tag (`Process.Tag` / `QueueResource.Tag` / …) or its `.key` string.
 * Resource kind is {@link Resource.kindOf} on the tag — not a separate query argument.
 *
 * Requires that resource's store registration (`Process.store` / `QueueResource.store`, …) on the
 * ambient {@link Store.Storage}. Missing registration fails via {@link Store.resolveOrDie}
 * (`StoreScopeNotRegistered`) — empty success is not used as a silent signal for “wrong key.”
 *
 * @remarks
 * Prefer {@link Resource.logs} for new code. See `docs/LOGS.md` — Store / query parameters.
 *
 * @category reads
 * @public
 */
export const byResource = (
  resource: ResourceLogKey | ResourceLogKeySource,
  options?: LogReadOptions,
): Effect.Effect<ReadonlyArray<LogEntry>> =>
  queryDurableScope(resolveResourceLogKey(resource), {
    limit: options?.limit ?? queryLimitDefault,
  });

/**
 * @deprecated Use {@link layer}.
 *
 * @category layers & serving
 * @public
 */
export const relayWithCaptureLoggerLayer = layer;

/**
 * @deprecated Use {@link layer}.
 *
 * @category layers & serving
 * @public
 */
export const logRelayLayer = relay.relayLayer;

/**
 * @deprecated Use {@link Relay}.
 *
 * @category context
 * @public
 */
export const LogRelay = relay.LogRelay;

/**
 * @deprecated Use {@link replay}.
 *
 * @category utils
 * @public
 */
export const replayLogEntry = relay.replayLogEntry;

/**
 * @deprecated Use {@link layer} internals — prefer {@link layer}.
 *
 * @category layers & serving
 * @public
 */
export const captureLogger = relay.captureLogger;

/**
 * @deprecated Use {@link layer}.
 *
 * @category layers & serving
 * @public
 */
export const captureLoggerLayer = relay.captureLoggerLayer;

/**
 * @deprecated Use {@link relayLayer}.
 *
 * @category layers & serving
 * @public
 */
export const relayOnlyLayer = relay.relayLayer;

/**
 * @deprecated Use {@link relayLayer}.
 *
 * @category layers & serving
 * @public
 */
export const relayLayer = relay.relayLayer;

/**
 * @deprecated Use {@link relayLayer}.
 *
 * @category layers & serving
 * @public
 */
export const logsRelayLayer = relay.relayLayer;
