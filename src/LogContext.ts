/**
 * Log **annotation keys** + per-scope annotation helpers for effect-pm log capture.
 *
 * Every captured {@link LogEntry} carries annotations keyed by {@link LogAnnotationKeys}. Values are
 * either a **node log key** (`Resource.Node.key`) or a **resource key** (`Resource.Tag.key`).
 *
 * Full catalog: `docs/LOGS.md` — Annotation keys.
 *
 * @module LogContext
 */

import { Effect } from "effect";

/**
 * Standard **annotation key** names on {@link LogEntry.annotations}.
 *
 * | Property | Annotation key (field name) | Value is |
 * |----------|----------------------------|----------|
 * | `node` | `"node"` | **node log key** (`Resource.Node.key`) |
 * | `processId` | `"processId"` | **resource key** (`Process.Tag.key`) |
 * | `queueId` | `"queueId"` | **resource key** (`QueueResource.Tag.key`) |
 * | `lineage` | `"@nikscripts/effect-pm/lineage"` | JSON array of **lineage segment keys** |
 *
 * Package: `@nikscripts/effect-pm/LogContext` · Source: `src/LogContext.ts` · See `docs/LOGS.md`.
 *
 * @public
 */
export const LogAnnotationKeys = {
  /** Annotation key whose value is the **node log key**. */
  node: "node",
  /** Annotation key whose value is a process **resource key**. */
  processId: "processId",
  /** Annotation key whose value is a queue **resource key**. */
  queueId: "queueId",
  /** Annotation key whose value is JSON **lineage segment keys**. */
  lineage: "@nikscripts/effect-pm/lineage",
} as const;

/**
 * Annotate every log line with a **node log key** value under annotation key {@link LogAnnotationKeys.node}.
 * Applied at the node runtime root (`Logs.persistLayer(nodeLogKey)` in `resource-web/server.ts`).
 *
 * @param node - **Node log key** value (`Resource.Node.key`).
 *
 * @public
 */
export const withNodeLogAnnotations = <A, E, R>(
  node: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.annotateLogs(effect, { [LogAnnotationKeys.node]: node });

/**
 * Annotate logs with a process **resource key** under annotation key {@link LogAnnotationKeys.processId}.
 *
 * @param processId - **Resource key** value (`Process.Tag.key`).
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
 * Annotate logs with a queue **resource key** under annotation key {@link LogAnnotationKeys.queueId}.
 *
 * @param queueId - **Resource key** value (`QueueResource.Tag.key`).
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
