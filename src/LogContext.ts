/**
 * Log annotation keys + per-scope annotation helpers for effect-pm log capture.
 *
 * Every captured {@link LogEntry} carries annotations identifying **where** it came from — the
 * **node** it ran on and the **resource** (a queue/process) that emitted it. Durable storage
 * (`NodeLogs.persistLayer` → {@link LogStore}) buckets by node and preserves the resource
 * annotations, so logs are queryable **by node** or **by resource**.
 *
 * @module LogContext
 */

import { Effect } from "effect";

/**
 * Standard log annotation keys effect-pm captures into {@link LogEntry}. `node` identifies the node
 * (the durable log bucket); `processId` / `queueId` identify the resource that emitted the line.
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
 * Annotate every log line emitted under `effect` with its **node** — the durable log bucket. Applied
 * once at a node's runtime root (e.g. by `NodeLogs.persistLayer(node)`), so every line, from any
 * resource or bare `Effect.log*`, carries the node.
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
