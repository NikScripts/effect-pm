/**
 * Per-HyperService handoff runners (Locked #33) — invoked from {@link Node.shutdown}
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

/** WorkPool kind ids (plain + priority). @internal */
export const isHyperlinkWorkPoolKind = (kind: string | undefined): boolean =>
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

const runRelease = (release: ReleaseFn): Effect.Effect<boolean> =>
  Effect.map(Effect.exit(release({ options: {} })), Exit.isSuccess);

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

const workPoolRelease = (impl: unknown): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Local half of transfer: export pending off the source queue (peer enqueue = #34).
    const releaseEncoded = releaseFnOf(impl, "releaseEncoded");
    const release = releaseFnOf(impl, "release");
    if (releaseEncoded !== undefined) {
      const ok = yield* runRelease(releaseEncoded);
      if (!ok && release !== undefined) {
        yield* runRelease(release);
      }
    } else if (release !== undefined) {
      yield* runRelease(release);
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
    Match.when("workPoolRelease", () => workPoolRelease(wireImpl)),
    Match.exhaustive,
  );
};
