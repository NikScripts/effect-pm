/**
 * Dual-write persistence for process execution terminal events — new Store contract + legacy facet.
 *
 * @module internal/processExecutionPersist
 * @internal
 */

import { Effect, Option } from "effect";
import { ProcessStore } from "../ProcessStore";
import {
  ProcessExecutionStore,
  type ProcessExecutionFinishInput,
} from "../store/processExecution";
import type { ProcessExecutionRecorder } from "./processStoreTap";

/** Arguments for a finished process run before facet input shaping. @internal */
export type ProcessExecutionFinishArgs = {
  readonly scheduleKey: string | null;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly error?: unknown;
  readonly isStartupRun: boolean;
};

const facetWrite =
  (processId: string, label: "completed" | "failed") =>
  (effect: Effect.Effect<void, unknown>): Effect.Effect<void> =>
    effect.pipe(
      ProcessStore.catchErrorAndLog({
        message: `ProcessExecutionStore write failed for ${label} run`,
        level: "warning",
        annotations: { processId },
      }),
    );

const whenRecorder = (
  recorder: ProcessExecutionRecorder | undefined,
  write: (recorder: ProcessExecutionRecorder) => Effect.Effect<void>,
): Effect.Effect<void> =>
  recorder === undefined ? Effect.void : write(recorder).pipe(Effect.asVoid);

/**
 * Terminal execution persistence — store contract (when recorder present) + legacy facet (best-effort).
 *
 * @internal
 */
export const makeProcessExecutionPersist = (options: {
  readonly processId: string;
  readonly finishInput: (args: ProcessExecutionFinishArgs) => ProcessExecutionFinishInput;
  readonly recorder?: ProcessExecutionRecorder;
}) => {
  const writeFacetCompleted = facetWrite(options.processId, "completed");
  const writeFacetFailed = facetWrite(options.processId, "failed");

  const recordCompleted = (args: ProcessExecutionFinishArgs): Effect.Effect<void> =>
    whenRecorder(options.recorder, (recorder) =>
      recorder.recordCompleted({
        scheduleKey: args.scheduleKey,
        startedAt: args.startedAt,
        completedAt: args.completedAt,
        isStartupRun: args.isStartupRun,
      }),
    ).pipe(
      Effect.flatMap(() =>
        writeFacetCompleted(ProcessExecutionStore.recordCompleted(options.finishInput(args))),
      ),
    );

  const recordFailed = (args: ProcessExecutionFinishArgs): Effect.Effect<void> =>
    whenRecorder(options.recorder, (recorder) =>
      recorder.recordFailed({
        scheduleKey: args.scheduleKey,
        startedAt: args.startedAt,
        completedAt: args.completedAt,
        isStartupRun: args.isStartupRun,
        error: args.error,
      }),
    ).pipe(
      Effect.flatMap(() =>
        writeFacetFailed(ProcessExecutionStore.recordFailed(options.finishInput(args))),
      ),
    );

  const hasPriorExecutions = (): Effect.Effect<boolean> =>
    options.recorder !== undefined
      ? options.recorder.hasPriorExecutions()
      : Effect.serviceOption(ProcessExecutionStore).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: (store) =>
                store.hasPriorExecutions(options.processId).pipe(
                  Effect.catch((error: unknown) =>
                    Effect.logWarning("Process storage read failed while checking startup run").pipe(
                      Effect.annotateLogs("processId", options.processId),
                      Effect.annotateLogs("error", String(error)),
                      Effect.as(false),
                    ),
                  ),
                ),
            }),
          ),
        );

  return { recordCompleted, recordFailed, hasPriorExecutions };
};
