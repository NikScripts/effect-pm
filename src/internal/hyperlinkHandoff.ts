/**
 * Per-HyperService handoff runners (Locked #33/#34) — invoked from {@link Node.shutdown}
 * after node drain and before Lookup leave.
 *
 * @internal
 */
import { Duration, Effect, Exit, Match, Predicate, Schedule } from "effect";

/**
 * Opt-in cutover strategy stamped by {@link Hyperlink.withHandoff}.
 * Public alias: {@link Hyperlink.HandoffStrategy}.
 *
 * @internal
 */
export type HyperlinkHandoffStrategy = "drainOnly" | "workPoolRelease";

/**
 * Peer transfer hook for {@link HyperlinkHandoffStrategy}`"workPoolRelease"` (Locked #34).
 * Returns `true` when the peer accepted the entries.
 *
 * @internal
 */
export type HyperlinkHandoffPeerTransfer = {
  readonly tryEnqueueToPeer: (
    entries: ReadonlyArray<unknown>,
  ) => Effect.Effect<boolean>;
};

/** WorkPool kind ids (plain + priority). */
const isHyperlinkWorkPoolKind = (kind: string | undefined): boolean =>
  kind !== undefined && kind.startsWith("hyperlink-ts/WorkPool");

/**
 * Close a type-erased Effect without surfacing `Effect.isEffect`'s `any` channels
 * (same edge pattern as {@link ./promiseHandle}).
 */
const closeEffect = <A = unknown>(value: unknown): Effect.Effect<A> =>
  // SAFE: caller proved `Effect.isEffect` on a copy kept as `unknown`; handoff runs local impls only.
  value as never;

type ReleaseFn = (input: {
  readonly options?: unknown;
}) => Effect.Effect<unknown>;

type EnqueueFn = (entries: ReadonlyArray<unknown>) => Effect.Effect<unknown>;

const statusPhase = (
  impl: unknown,
): Effect.Effect<{ readonly phase: string }> | undefined => {
  if (!Predicate.hasProperty(impl, "status")) return undefined;
  const status = impl.status;
  if (!Predicate.hasProperty(status, "get")) return undefined;
  const get: unknown = status.get;
  // Copy before `isEffect` — never feed the narrowed `any` channels into closeEffect.
  const payload: unknown = get;
  if (!Effect.isEffect(get)) return undefined;
  return closeEffect<unknown>(payload).pipe(
    Effect.map((snap) =>
      Predicate.hasProperty(snap, "phase") && typeof snap.phase === "string"
        ? { phase: snap.phase }
        : { phase: "unknown" },
    ),
  );
};

const shutdownOf = (impl: unknown): Effect.Effect<void> | undefined => {
  if (!Predicate.hasProperty(impl, "shutdown")) return undefined;
  const member: unknown = impl.shutdown;
  const payload: unknown = member;
  if (!Effect.isEffect(member)) return undefined;
  return Effect.asVoid(closeEffect(payload));
};

const releaseFnOf = (
  impl: unknown,
  key: "release" | "releaseEncoded",
): ReleaseFn | undefined => {
  if (!Predicate.hasProperty(impl, key)) return undefined;
  const fn = impl[key];
  if (typeof fn !== "function") return undefined;
  return (input) => {
    const out: unknown = fn(input);
    const payload: unknown = out;
    if (!Effect.isEffect(out)) return Effect.succeed([]);
    return closeEffect(payload);
  };
};

const enqueueFnOf = (impl: unknown): EnqueueFn | undefined => {
  if (!Predicate.hasProperty(impl, "enqueue")) return undefined;
  const fn = impl.enqueue;
  if (typeof fn !== "function") return undefined;
  return (entries) => {
    const out: unknown = fn(entries);
    const payload: unknown = out;
    if (!Effect.isEffect(out)) return Effect.void;
    return closeEffect(payload);
  };
};

const awaitQueueOff = (impl: unknown): Effect.Effect<void> => {
  const get = statusPhase(impl);
  if (get === undefined) return Effect.void;
  return Effect.repeat(get, {
    until: (snap) => snap.phase === "off",
    schedule: Schedule.spaced(Duration.millis(50)),
  }).pipe(
    Effect.timeout(Duration.seconds(30)),
    Effect.ignore,
    Effect.asVoid,
  );
};

const asEntryArray = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : [];

const requeueLocal = (
  enqueue: EnqueueFn | undefined,
  entries: ReadonlyArray<unknown>,
  reason: string,
): Effect.Effect<void> => {
  if (entries.length === 0) return Effect.void;
  if (enqueue === undefined) {
    return Effect.logWarning(
      `handoff workPoolRelease: ${reason}; no local enqueue to recover`,
    );
  }
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(enqueue(entries));
    if (Exit.isFailure(exit)) {
      yield* Effect.logWarning(
        `handoff workPoolRelease: ${reason}; local re-queue failed`,
      );
      return;
    }
    yield* Effect.logWarning(
      `handoff workPoolRelease: ${reason}; re-queued locally`,
    );
  });
};

const drainOnly = (impl: unknown): Effect.Effect<void> =>
  Effect.gen(function* () {
    const shutdown = shutdownOf(impl);
    if (shutdown === undefined) {
      yield* Effect.logWarning("handoff drainOnly: impl has no shutdown");
      return;
    }
    yield* shutdown;
    yield* awaitQueueOff(impl);
  }).pipe(
    Effect.annotateLogs({ "handoff.strategy": "drainOnly" }),
    Effect.withLogSpan("handoff.drainOnly"),
  );

const workPoolRelease = (
  impl: unknown,
  peerTransfer: HyperlinkHandoffPeerTransfer | undefined,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const enqueue = enqueueFnOf(impl);
    const release = releaseFnOf(impl, "release");
    const releaseEncoded = releaseFnOf(impl, "releaseEncoded");

    // Peer transfer needs decoded entries (#34). Without `release`, fall back to local-only
    // `releaseEncoded` (no enqueueEncoded in v1).
    if (peerTransfer !== undefined && release !== undefined) {
      const released = asEntryArray(
        yield* release({ options: {} }).pipe(
          Effect.catch(() => Effect.succeed([])),
        ),
      );
      if (released.length > 0) {
        const ok = yield* peerTransfer.tryEnqueueToPeer(released);
        if (!ok) {
          yield* requeueLocal(enqueue, released, "peer transfer unavailable");
        }
      }
    } else if (releaseEncoded !== undefined) {
      const ok = yield* Effect.map(
        Effect.exit(releaseEncoded({ options: {} })),
        Exit.isSuccess,
      );
      if (!ok && release !== undefined) {
        yield* Effect.exit(release({ options: {} }));
      }
      if (peerTransfer !== undefined && release === undefined) {
        yield* Effect.logWarning(
          "handoff workPoolRelease: peer transfer needs decoded release; local releaseEncoded only",
        );
      }
    } else if (release !== undefined) {
      // Local-only path (no Directory self dial / no peerTransfer wired).
      yield* Effect.exit(release({ options: {} }));
    } else {
      yield* Effect.logWarning("handoff workPoolRelease: no release on impl");
    }

    const shutdown = shutdownOf(impl);
    if (shutdown !== undefined) {
      yield* shutdown;
      yield* awaitQueueOff(impl);
    }
  }).pipe(
    Effect.annotateLogs({ "handoff.strategy": "workPoolRelease" }),
    Effect.withLogSpan("handoff.workPoolRelease"),
  );

/**
 * Build the Effect run for one served HyperService's handoff strategy.
 * Non-WorkPool kinds log and no-op (opt-in migrate is WorkPool-shaped in v1).
 *
 * @internal
 */
export const makeHyperlinkHandoffRun = (
  strategy: HyperlinkHandoffStrategy,
  kind: string | undefined,
  wireImpl: unknown,
  peerTransfer?: HyperlinkHandoffPeerTransfer,
): Effect.Effect<void> => {
  if (!isHyperlinkWorkPoolKind(kind)) {
    return Effect.logWarning("handoff skipped: not a WorkPool kind").pipe(
      Effect.annotateLogs({
        "handoff.strategy": strategy,
        "handoff.kind": kind ?? "none",
      }),
      Effect.asVoid,
    );
  }
  return Match.value(strategy).pipe(
    Match.when("drainOnly", () => drainOnly(wireImpl)),
    Match.when("workPoolRelease", () =>
      workPoolRelease(wireImpl, peerTransfer),
    ),
    Match.exhaustive,
  );
};
