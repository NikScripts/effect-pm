/**
 * Buffered execution persistence for the process supervisor — writes to the built-in
 * {@link Process} store contract via a declared {@link StoreScopeBridgeTag} dependency.
 *
 * @module internal/processStoreTap
 * @internal
 */

import {
  Cause,
  Effect,
  Option,
  Queue,
  Scope,
  SubscriptionRef,
} from "effect";
import { errorOf } from "./processTagSchemas";
import { StoreScopeBridgeTag } from "./store/bridge";
import {
  builtInProcessStoreContract,
  type ProcessStoreEventRow,
} from "./store/processStoreSpec";
import type { StoreScopeTag } from "./store/registration";

const bufferCapacity = 256;

/** Supervisor-facing execution persistence (buffered off the run hot path). @internal */
export interface ProcessExecutionRecorder {
  readonly recordCompleted: (input: {
    readonly scheduleKey: string | null;
    readonly startedAt: number;
    readonly completedAt: number;
    readonly isStartupRun: boolean;
  }) => Effect.Effect<void>;
  readonly recordFailed: (input: {
    readonly scheduleKey: string | null;
    readonly startedAt: number;
    readonly completedAt: number;
    readonly isStartupRun: boolean;
    readonly error: unknown;
  }) => Effect.Effect<void>;
  readonly hasPriorExecutions: () => Effect.Effect<boolean>;
}

const offerLossy = <A>(queue: Queue.Queue<A>, value: A): Effect.Effect<void> =>
  Queue.offer(queue, value).pipe(Effect.asVoid);

const readOptionalResult = (
  resultRef: SubscriptionRef.SubscriptionRef<Option.Option<unknown>> | undefined,
): Effect.Effect<Option.Option<unknown>> =>
  resultRef === undefined
    ? Effect.succeed(Option.none())
    : SubscriptionRef.get(resultRef);

const buildCompletedEvent = (
  processId: string,
  input: Parameters<ProcessExecutionRecorder["recordCompleted"]>[0],
  result: unknown | undefined,
): ProcessStoreEventRow => ({
  _tag: "RunCompleted",
  processId,
  scheduleKey: input.scheduleKey,
  startedAt: input.startedAt,
  completedAt: input.completedAt,
  durationMs: input.completedAt - input.startedAt,
  isStartupRun: input.isStartupRun,
  ...(result !== undefined ? { result } : {}),
});

const buildFailedEvent = (
  processId: string,
  encodedError: unknown,
  input: Parameters<ProcessExecutionRecorder["recordFailed"]>[0],
): ProcessStoreEventRow => ({
  _tag: "RunFailed",
  processId,
  scheduleKey: input.scheduleKey,
  startedAt: input.startedAt,
  completedAt: input.completedAt,
  durationMs: input.completedAt - input.startedAt,
  isStartupRun: input.isStartupRun,
  error: encodedError,
});

/**
 * Resolve the built-in process store once and return a buffered recorder.
 * Requires {@link StoreScopeBridgeTag} as a declared dependency (never `serviceOption`).
 *
 * @internal
 */
export const makeProcessExecutionRecorder = (options: {
  readonly scopeKey: string;
  readonly tag: StoreScopeTag;
  readonly resultRef?: SubscriptionRef.SubscriptionRef<Option.Option<unknown>>;
}): Effect.Effect<ProcessExecutionRecorder, never, StoreScopeBridgeTag | Scope.Scope> =>
  Effect.gen(function* () {
    const bridge = yield* StoreScopeBridgeTag;
    const contract = builtInProcessStoreContract(options.tag);
    const store = yield* bridge.at(options.scopeKey, contract).pipe(Effect.orDie);
    const scope = yield* Effect.scope;
    const errorSchema = errorOf(options.tag);
    const queue = yield* Queue.bounded<ProcessStoreEventRow>(bufferCapacity);

    const drain = Effect.forever(
      Queue.take(queue).pipe(
        Effect.flatMap((event) =>
          store.record(event).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Process store write failed").pipe(
                Effect.annotateLogs("processId", options.scopeKey),
                Effect.annotateLogs("cause", Cause.pretty(cause)),
              ),
            ),
          ),
        ),
      ),
    );

    yield* Effect.forkIn(drain, scope);

    return {
      recordCompleted: (input) =>
        readOptionalResult(options.resultRef).pipe(
          Effect.flatMap((result) =>
            offerLossy(
              queue,
              buildCompletedEvent(
                options.scopeKey,
                input,
                Option.getOrUndefined(result),
              ),
            ),
          ),
        ),
      recordFailed: (input) =>
        offerLossy(
          queue,
          buildFailedEvent(
            options.scopeKey,
            errorSchema === undefined ? String(input.error) : input.error,
            input,
          ),
        ),
      hasPriorExecutions: () => store.hasPriorExecutions(),
    };
  });
