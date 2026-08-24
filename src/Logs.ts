/**
 * **Logs** — one module for node-wide log capture, relay, and durable query.
 *
 * @remarks
 * ## Node log key (durable bucket)
 *
 * The argument to {@link byNode} is the **node log key** — it **must** equal the
 * {@link Node.Service} `.key` for that OS process (the same string {@link Hyperlink.selfNode}
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
 *   follower (`Node.logs`, `Daemon.store`, …). The shape is Effect-style private (omitted from
 *   public handle types); read via {@link Hyperlink.logs} / {@link byNode} / {@link byHyperlink}.
 * - **`withScope`** — lineage annotation at resource materialize.
 * - **`byNode`** / **`byHyperlink`** — durable reads from registration Storage.
 *
 * Per-HyperService live + durable export: {@link Hyperlink.logs} / {@link Hyperlink.withLogExport}.
 *
 * @example Node journal via `Store.Service`
 * ```ts
 * import * as Hyperlink from "hyperlink-ts/Hyperlink";
 * import * as Logs from "hyperlink-ts/Logs";
 * import * as Daemon from "hyperlink-ts/Daemon";
 * import * as Store from "hyperlink-ts/Store";
 *
 * class BillingNode extends Node.Service<BillingNode>()("billing/scores") {}
 * class Daily extends Daemon.Service<Daily>()("app/Daily") {}
 *
 * class AppStore extends Store.Service<AppStore>("@app/Store")(
 *   BillingNode.logs,
 *   Daemon.store(Daily),
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

/**
 * **Node log key** — durable bucket id for one runtime host. Must equal {@link Node.Service} `.key`
 * (same string as {@link Hyperlink.selfNode}). Stored as `annotations.node` on node-journal lines.
 *
 * @see `docs/LOGS.md` — Key catalog → Node log keys
 *
 * @category models
 * @public
 */
export type NodeLogKey = string;

/**
 * **Hyperlink key** — identity of a queue, daemon, or tag (`Hyperlink.Service.key`). Used in lineage,
 * `byHyperlink`, and {@link LogEntry.hasKey}.
 *
 * @see `docs/LOGS.md` — Key catalog → Hyperlink keys
 *
 * @category models
 * @public
 */
export type HyperlinkLogKey = string;

/**
 * Source carrying a **node log key** (`Node.Service.key`).
 *
 * @category models
 * @public
 */
export type NodeLogKeySource = { readonly key: NodeLogKey };

/**
 * Resolve the **node log key** from a {@link Node.Service} (or any `{ key }` source).
 *
 * @param node - `Node.Service` class or `{ key: NodeLogKey }`
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
 * Options shared by {@link byNode} / {@link byHyperlink}.
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
 * Read durable logs for a **whole node** (every HyperService on that node).
 *
 * Needs `Node.logs` / `Hyperlink.store(Node)` on an app {@link Store.Service} (Soft-override the
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
 * Source carrying a **HyperService key** (`Hyperlink.Service.key` / store registration key).
 *
 * @category models
 * @public
 */
export type HyperlinkLogKeySource = { readonly key: HyperlinkLogKey };

const resolveHyperlinkLogKey = (
  serviceKey: HyperlinkLogKey | HyperlinkLogKeySource,
): HyperlinkLogKey =>
  typeof serviceKey === "string" ? serviceKey : serviceKey.key;

/**
 * Read durable logs for a **specific HyperService** by **full key** (same string as
 * {@link Hyperlink.logs}`(tag)` / store registration / lineage segment).
 *
 * Pass a scope tag (`Daemon.Service` / `WorkPool.Service` / …) or its `.key` string.
 * Hyperlink kind is {@link Hyperlink.kindOf} on the tag — not a separate query argument.
 *
 * Requires that HyperService's store registration (`Daemon.store` / `WorkPool.store`, …) on the
 * ambient {@link Store.Storage}. Missing registration fails via {@link Store.resolveOrDie}
 * (`StoreScopeNotRegistered`) — empty success is not used as a silent signal for “wrong key.”
 *
 * @remarks
 * Prefer {@link Hyperlink.logs} for new code. See `docs/LOGS.md` — Store / query parameters.
 *
 * @category reads
 * @public
 */
export const byHyperlink = (
  serviceKey: HyperlinkLogKey | HyperlinkLogKeySource,
  options?: LogReadOptions,
): Effect.Effect<ReadonlyArray<LogEntry>> =>
  queryDurableScope(resolveHyperlinkLogKey(serviceKey), {
    limit: options?.limit ?? queryLimitDefault,
  });
