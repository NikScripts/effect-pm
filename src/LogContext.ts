/**
 * Log annotation keys + per-scope annotation helpers for effect-pm log capture.
 *
 * Every captured {@link LogEntry} carries annotations identifying **where** it came from — the
 * **host** it ran on and the **resource** (a queue/process) that emitted it. Durable storage
 * (`HostLogs.persistLayer` → {@link LogStore}) buckets by host and preserves the resource
 * annotations, so logs are queryable **by host** or **by resource**.
 *
 * @module LogContext
 */

import { Effect } from "effect";

/**
 * Standard log annotation keys effect-pm captures into {@link LogEntry}. `host` identifies the host
 * (the durable log bucket); `processId` / `queueId` identify the resource that emitted the line.
 *
 * @public
 */
export const LogAnnotationKeys = {
  host: "host",
  processId: "processId",
  queueId: "queueId",
} as const;

/**
 * Annotate every log line emitted under `effect` with its **host** — the durable log bucket. Applied
 * once at a host's runtime root (e.g. by `HostLogs.persistLayer(host)`), so every line, from any
 * resource or bare `Effect.log*`, carries the host.
 *
 * @public
 */
export const withHostLogAnnotations = <A, E, R>(
  host: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.annotateLogs(effect, { [LogAnnotationKeys.host]: host });

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
 * Log annotation keys + per-scope helpers.
 *
 * @public
 */
export const LogContext = {
  keys: LogAnnotationKeys,
  withHostLogAnnotations,
  withProcessLogAnnotations,
  withQueueLogAnnotations,
} as const;
