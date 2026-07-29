/**
 * Per-HyperService handoff runners (Locked #33) — invoked from {@link Node.shutdown}
 * after node drain and before Lookup leave.
 *
 * @internal
 */
import { Duration, Effect, Exit, Schedule } from "effect";

/** Opt-in cutover strategy stamped by {@link Hyperlink.withHandoff}. @public */
export type HandoffStrategy = "drain-only" | "workPool-release";

/** WorkPool kind ids (plain + priority). @internal */
export const isWorkPoolKind = (kind: string | undefined): boolean =>
  kind !== undefined &&
  (kind === "hyperlink-ts/WorkPool" ||
    kind === "hyperlink-ts/WorkPool/priority" ||
    kind.startsWith("hyperlink-ts/WorkPool/"));

type WorkPoolHandle = {
  readonly shutdown?: Effect.Effect<void>;
  readonly release?: (input: {
    readonly options?: unknown;
  }) => Effect.Effect<unknown>;
  readonly releaseEncoded?: (input: {
    readonly options?: unknown;
  }) => Effect.Effect<unknown>;
  readonly status?: {
    readonly get: Effect.Effect<{ readonly phase: string }>;
  };
};

const awaitQueueOff = (handle: WorkPoolHandle): Effect.Effect<void> => {
  if (handle.status === undefined) return Effect.void;
  return Effect.repeat(handle.status.get, {
    until: (snap) => snap.phase === "off",
    schedule: Schedule.spaced(Duration.millis(50)),
  }).pipe(
    Effect.timeout(Duration.seconds(30)),
    Effect.ignore,
    Effect.asVoid,
  );
};

const runRelease = (
  release: (input: { readonly options?: unknown }) => Effect.Effect<unknown>,
): Effect.Effect<boolean> =>
  Effect.map(Effect.exit(release({ options: {} })), Exit.isSuccess);

/**
 * Build the Effect run for one served HyperService's handoff strategy.
 * Non-WorkPool kinds log and no-op (opt-in migrate is WorkPool-shaped in v1).
 *
 * @internal
 */
export const makeHandoffRun = (
  strategy: HandoffStrategy,
  kind: string | undefined,
  wireImpl: unknown,
): Effect.Effect<void> => {
  if (!isWorkPoolKind(kind)) {
    return Effect.logWarning("handoff skipped: not a WorkPool kind").pipe(
      Effect.annotateLogs({
        "handoff.strategy": strategy,
        "handoff.kind": kind ?? "none",
      }),
      Effect.asVoid,
    );
  }
  const handle = wireImpl as WorkPoolHandle;
  if (strategy === "drain-only") {
    return Effect.gen(function* () {
      if (handle.shutdown === undefined) {
        yield* Effect.logWarning("handoff drain-only: impl has no shutdown");
        return;
      }
      yield* handle.shutdown;
      yield* awaitQueueOff(handle);
    }).pipe(
      Effect.annotateLogs({ "handoff.strategy": "drain-only" }),
      Effect.withLogSpan("handoff.drain-only"),
    );
  }
  return Effect.gen(function* () {
    // Local half of transfer: export pending off the source queue (peer enqueue = #34).
    if (handle.releaseEncoded !== undefined) {
      const ok = yield* runRelease(handle.releaseEncoded);
      if (!ok && handle.release !== undefined) {
        yield* runRelease(handle.release);
      }
    } else if (handle.release !== undefined) {
      yield* runRelease(handle.release);
    } else {
      yield* Effect.logWarning("handoff workPool-release: no release on impl");
    }
    if (handle.shutdown !== undefined) {
      yield* handle.shutdown;
      yield* awaitQueueOff(handle);
    }
  }).pipe(
    Effect.annotateLogs({ "handoff.strategy": "workPool-release" }),
    Effect.withLogSpan("handoff.workPool-release"),
  );
};
