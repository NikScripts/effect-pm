/**
 * Log annotation keys and scoped context for process-manager group children.
 *
 * @module LogContext
 */

import { Context, Effect, Layer } from "effect";

/**
 * Standard log annotation keys for effect-pm (captured into {@link LogEntry}).
 *
 * @public
 */
export const LogAnnotationKeys = {
  groupId: "groupId",
  processId: "processId",
  queueId: "queueId",
} as const;

/**
 * Group id carried in context for log capture relay persistence.
 *
 * @public
 */
export class ProcessGroupLogContext extends Context.Service<
  ProcessGroupLogContext,
  { readonly groupId: string }
>()("@nikscripts/effect-pm/LogContext/ProcessGroupLogContext") {}

/**
 * Scoped {@link Effect.annotateLogsScoped} for every fiber under a group runtime.
 *
 * @public
 */
export const layerProcessGroupLogContext = (
  groupId: string,
): Layer.Layer<ProcessGroupLogContext> =>
  Layer.effect(
    ProcessGroupLogContext,
    Effect.gen(function* () {
      yield* Effect.annotateLogsScoped({
        [LogAnnotationKeys.groupId]: groupId,
      });
      return { groupId };
    }),
  );

/**
 * Annotate logs emitted from a process supervisor fiber.
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
 * Annotate logs emitted from a queue worker fiber.
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
 * Log annotation keys and scoped context for process-manager children.
 *
 * @public
 */
export const LogContext = {
  ProcessGroupLogContext,
  keys: LogAnnotationKeys,
  layer: layerProcessGroupLogContext,
  withProcessLogAnnotations,
  withQueueLogAnnotations,
} as const;
