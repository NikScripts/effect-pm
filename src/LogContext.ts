/**
 * Log annotation keys + per-scope annotation helpers for effect-pm log capture.
 *
 * Every captured {@link LogEntry} carries annotations identifying **where** it came from — the
 * **node** it ran on and the **resource** (a queue/process) that emitted it. Durable storage
 * (`Logs.persistLayer` → {@link LogStore}) buckets by **node log key** (`Resource.Node.key`) and
 * preserves resource annotations, so logs are queryable **by node** or **by resource**.
 *
 * @module LogContext
 */

import { Effect } from "effect";

/**
 * Standard log annotation keys effect-pm captures into {@link LogEntry}. `node` is the **node log
 * key** (durable bucket — must equal {@link Resource.Node} `.key`); `processId` / `queueId` are
 * resource {@link Resource.Tag} `.key` values.
 *
 * @public
 */
export const LogAnnotationKeys = {
  node: "node",
  processId: "processId",
  queueId: "queueId",
  lineage: "@nikscripts/effect-pm/lineage",
} as const;

/**
 * Annotate every log line emitted under `effect` with its **node log key** — the durable bucket.
 * Applied once at a node's runtime root (e.g. by `Logs.persistLayer(node)` where `node` is
 * `Resource.Node.key`), so every line carries the same bucket id.
 *
 * @public
 */
export const withNodeLogAnnotations = <A, E, R>(
  node: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.annotateLogs(effect, { [LogAnnotationKeys.node]: node });

/**
 * Annotate logs emitted from a process supervisor fiber with its resource id.
 *
 * @public
 */
export const withProcessLogAnnotations = <A, E, R>(
  processId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.annotateLogs(effect, {
    [LogAnnotationKeys.processId]: processId,
  });

/**
 * Annotate logs emitted from a queue worker fiber with its resource id.
 *
 * @public
 */
export const withQueueLogAnnotations = <A, E, R>(
  queueId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.annotateLogs(effect, {
    [LogAnnotationKeys.queueId]: queueId,
  });

/**
 * Log annotation keys, aliased as `LogContext.keys` for discoverability alongside the
 * per-scope annotation helpers above.
 *
 * @public
 */
export { LogAnnotationKeys as keys };
