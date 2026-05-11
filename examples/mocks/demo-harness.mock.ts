/**
 * @module examples/mocks/demo-harness
 *
 * **Not domain mocks** — small helpers shared by runnable **`examples/*.ts`** scripts so entry
 * files stay focused on **`Process` / `Polling` / `ProcessSchedule`** instead of repetitive
 * **`forkChild` + `TestClock.adjust` + `process.exit`** noise.
 *
 * | Export | Purpose |
 * |--------|---------|
 * | **`forkSupervisedAndSideThenAdvanceTime`** | Fork supervised `process.effect` + a side fiber (e.g. feed simulator), **`TestClock.adjust`**, interrupt the process fiber. |
 * | **`runNodeProgramOrExit`** | `Effect.runPromise` then **`process.exit`** — normal **Node/tsx** script epilogue. |
 */

import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

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

export const runNodeProgramOrExit = (
  program: Effect.Effect<void, never, never>,
  successLine: string,
): void => {
  void Effect.runPromise(
    program.pipe(Effect.tap(() => Effect.logInfo(successLine))),
  );
};
