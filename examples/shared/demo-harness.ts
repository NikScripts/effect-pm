/**
 * @module examples/shared/demo-harness
 *
 * TestClock fork/advance helpers for example scripts.
 */

import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

/** Fork supervised process + side fiber, advance simulated time, interrupt process. */
export const forkSupervisedAndSideThenAdvanceTime = (options: {
  readonly supervised: Effect.Effect<void, never, never>;
  readonly sideFiber: Effect.Effect<void, never, never>;
  readonly advanceBy: Duration.Duration;
}): Effect.Effect<void, never, never> =>
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
