/**
 * @module examples/shared/demo-harness
 *
 * TestClock fork/advance helpers for example scripts.
 */

import { Duration, Effect, Fiber, Layer, ManagedRuntime } from "effect";
import { TestClock } from "effect/testing";

/** Fork supervised process + side fiber, advance simulated time, interrupt process. */
export const forkSupervisedAndSideThenAdvanceTime = <R>(options: {
  /** Daemon (or other) effect; environment must be supplied by the caller’s scope. */
  readonly supervised: Effect.Effect<void, never, R>;
  readonly sideFiber: Effect.Effect<void, never, never>;
  readonly advanceBy: Duration.Duration;
}): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const mainFib = yield* Effect.forkChild(options.supervised);
    yield* Effect.forkChild(options.sideFiber);
    yield* TestClock.adjust(options.advanceBy);
    yield* Fiber.interrupt(mainFib);
  });

/** Standard Node/tsx epilogue — log success line then exit. */
export const runNodeProgramOrExit = (
  program: Effect.Effect<void, never, never>,
  successLine: string,
): void => {
  void Effect.runPromise(
    program.pipe(Effect.tap(() => Effect.logInfo(successLine))),
  );
};

/**
 * Like {@link runNodeProgramOrExit}, but runs the program in a {@link ManagedRuntime}
 * built from `layer` (same idea as `ManagedRuntime` in Effect’s own source: layer → runtime →
 * `runPromise`, without scattering `Effect.provide(effect, layer)` through scripts).
 */
export const runNodeProgramWithLayer = <R, EL, LE = never>(
  program: Effect.Effect<void, EL, R>,
  layer: Layer.Layer<R, LE, never>,
  successLine: string,
): void => {
  const rt = ManagedRuntime.make(layer);
  void rt
    .runPromise(program.pipe(Effect.tap(() => Effect.logInfo(successLine))))
    .finally(() => rt.dispose());
};
