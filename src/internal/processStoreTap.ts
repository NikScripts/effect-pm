/**
 * Buffered engine writes to the built-in {@link Process} {@link Store} contract
 * (`builtInProcessStoreContract`) via {@link Store.resolveOrDie}.
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
import * as Store from "../Store";
import { errorOf } from "./processTagSchemas";
import {
  builtInProcessStoreContract,
  type ProcessStoreEventRow,
} from "./store/processStoreSpec";
import type { StoreScopeTag } from "./store/registration";

const bufferCapacity = 256;

/** Buffered writes to the built-in {@link Process} store contract (supervisor hot path). @internal */
export interface ProcessStoreTap {
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
  readonly recordInterrupted: (input: {
    readonly scheduleKey: string | null;
    readonly startedAt: number;
    readonly completedAt: number;
    readonly isStartupRun: boolean;
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
  input: Parameters<ProcessStoreTap["recordCompleted"]>[0],
  success: unknown | undefined,
): ProcessStoreEventRow => ({
  _tag: "RunCompleted",
  processId,
  scheduleKey: input.scheduleKey,
  startedAt: input.startedAt,
  completedAt: input.completedAt,
  durationMs: input.completedAt - input.startedAt,
  isStartupRun: input.isStartupRun,
  ...(success !== undefined ? { success } : {}),
});

const buildFailedEvent = (
  processId: string,
  encodedError: unknown,
  input: Parameters<ProcessStoreTap["recordFailed"]>[0],
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

const buildInterruptedEvent = (
  processId: string,
  input: Parameters<ProcessStoreTap["recordInterrupted"]>[0],
): ProcessStoreEventRow => ({
  _tag: "RunInterrupted",
  processId,
  scheduleKey: input.scheduleKey,
  startedAt: input.startedAt,
  completedAt: input.completedAt,
  durationMs: input.completedAt - input.startedAt,
  isStartupRun: input.isStartupRun,
});

/**
 * Resolve the built-in process store once and return a buffered store tap.
 * Requires {@link Store.Storage} as a declared dependency (never `serviceOption`).
 *
 * @internal
 */
export const makeProcessStoreTap = (options: {
  readonly scopeKey: string;
  readonly tag: StoreScopeTag;
  readonly resultRef?: SubscriptionRef.SubscriptionRef<Option.Option<unknown>>;
}): Effect.Effect<ProcessStoreTap, never, Store.Storage | Scope.Scope> =>
  Effect.gen(function* () {
    const contract = builtInProcessStoreContract(options.tag);
    const store = yield* Store.resolveOrDie(options.scopeKey, contract);
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
          Effect.flatMap((successOption) =>
            offerLossy(
              queue,
              buildCompletedEvent(
                options.scopeKey,
                input,
                Option.getOrUndefined(successOption),
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
      recordInterrupted: (input) =>
        offerLossy(queue, buildInterruptedEvent(options.scopeKey, input)),
      hasPriorExecutions: () => store.hasPriorExecutions(),
    };
  });

/** Arguments for a terminal process run store write. @internal */
export type ProcessStoreFinishArgs = {
  readonly scheduleKey: string | null;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly error?: unknown;
  readonly isStartupRun: boolean;
};

const whenStoreTap = (
  storeTap: ProcessStoreTap | undefined,
  write: (tap: ProcessStoreTap) => Effect.Effect<void>,
): Effect.Effect<void> =>
  storeTap === undefined ? Effect.void : write(storeTap).pipe(Effect.asVoid);

/**
 * Optional store-tap delegates for the supervisor — no-op when {@link layer} did not wire a tap.
 *
 * @internal
 */
export const makeProcessStorePersist = (options: {
  readonly storeTap?: ProcessStoreTap;
}) => ({
  recordCompleted: (args: ProcessStoreFinishArgs): Effect.Effect<void> =>
    whenStoreTap(options.storeTap, (tap) =>
      tap.recordCompleted({
        scheduleKey: args.scheduleKey,
        startedAt: args.startedAt,
        completedAt: args.completedAt,
        isStartupRun: args.isStartupRun,
      }),
    ),

  recordFailed: (args: ProcessStoreFinishArgs): Effect.Effect<void> =>
    whenStoreTap(options.storeTap, (tap) =>
      tap.recordFailed({
        scheduleKey: args.scheduleKey,
        startedAt: args.startedAt,
        completedAt: args.completedAt,
        isStartupRun: args.isStartupRun,
        error: args.error,
      }),
    ),

  recordInterrupted: (args: ProcessStoreFinishArgs): Effect.Effect<void> =>
    whenStoreTap(options.storeTap, (tap) =>
      tap.recordInterrupted({
        scheduleKey: args.scheduleKey,
        startedAt: args.startedAt,
        completedAt: args.completedAt,
        isStartupRun: args.isStartupRun,
      }),
    ),

  hasPriorExecutions: (): Effect.Effect<boolean> =>
    options.storeTap !== undefined
      ? options.storeTap.hasPriorExecutions()
      : Effect.succeed(false),
});
