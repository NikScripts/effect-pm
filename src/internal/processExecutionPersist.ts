/**
 * Store-only persistence for process execution terminal events via the built-in contract.
 *
 * @module internal/processExecutionPersist
 * @internal
 */

import { Effect } from "effect";
import type { ProcessExecutionRecorder } from "./processStoreTap";

/** Arguments for a finished process run. @internal */
export type ProcessExecutionFinishArgs = {
  readonly scheduleKey: string | null;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly error?: unknown;
  readonly isStartupRun: boolean;
};

const whenRecorder = (
  recorder: ProcessExecutionRecorder | undefined,
  write: (recorder: ProcessExecutionRecorder) => Effect.Effect<void>,
): Effect.Effect<void> =>
  recorder === undefined ? Effect.void : write(recorder).pipe(Effect.asVoid);

/**
 * Terminal execution persistence — built-in store contract only (layer path).
 *
 * @internal
 */
export const makeProcessExecutionPersist = (options: {
  readonly recorder?: ProcessExecutionRecorder;
}) => ({
  recordCompleted: (args: ProcessExecutionFinishArgs): Effect.Effect<void> =>
    whenRecorder(options.recorder, (recorder) =>
      recorder.recordCompleted({
        scheduleKey: args.scheduleKey,
        startedAt: args.startedAt,
        completedAt: args.completedAt,
        isStartupRun: args.isStartupRun,
      }),
    ),

  recordFailed: (args: ProcessExecutionFinishArgs): Effect.Effect<void> =>
    whenRecorder(options.recorder, (recorder) =>
      recorder.recordFailed({
        scheduleKey: args.scheduleKey,
        startedAt: args.startedAt,
        completedAt: args.completedAt,
        isStartupRun: args.isStartupRun,
        error: args.error,
      }),
    ),

  hasPriorExecutions: (): Effect.Effect<boolean> =>
    options.recorder !== undefined
      ? options.recorder.hasPriorExecutions()
      : Effect.succeed(false),
});
