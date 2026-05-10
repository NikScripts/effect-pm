/**
 * Process supervisor patterns (v0.7+)
 *
 * Runnable demos using **`TestClock`** (deterministic, no real sleeps):
 *
 * 1. **`Polling.acceleratingScoped`** - delays **shorten** after each tick. Call
 *    **`yield* Polling.resetCadence`** from effects that share the same merged `Polling` layer.
 * 2. **`schedulePollWhileDisarmed`** - re-check interval when the schedule has no transition hint
 *    (see `resolveDisarmedFallbackPoll` in logs).
 * 3. **`ProcessSchedule.fromArmedRef`** - pause/resume **scheduled** ticks without `stopProcess`.
 *
 * ```bash
 * npx tsx examples/process-supervisor-patterns.ts
 * ```
 *
 * Full `ProcessGroup` + CLI demo: `examples/example.ts`. API tables: `docs/PROCESS-API.md`.
 *
 * @module process-supervisor-patterns
 */

import { Duration, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import {
  Process,
  Polling,
  ProcessSchedule,
  ProcessStore,
  resolveDisarmedFallbackPoll,
} from "../src";

const acceleratingDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── Accelerating polling (intervals shrink each tick) ──");

  const tickCount = yield* Ref.make(0);

  const proc = Process.make({
    name: "patterns/accelerating",
    effect: Ref.update(tickCount, (n) => n + 1),
    schedule: ProcessSchedule.alwaysArmed,
  });

  const runtime = Layer.mergeAll(
    ProcessStore.layer,
    Polling.acceleratingScoped({
      minIntervalMs: 40,
      maxIntervalMs: 400,
      decayK: 0.4,
    }),
    ProcessSchedule.alwaysArmed,
  );

  const supervised = proc.effect.pipe(Effect.provide(runtime));

  const mainFiber = yield* Effect.forkChild(supervised);

  yield* TestClock.adjust(Duration.seconds(2));
  yield* Fiber.interrupt(mainFiber);

  const totalTicks = yield* Ref.get(tickCount);
  yield* Effect.logInfo(
    `ticks in ~2s simulated wall time: ${totalTicks} (accelerating: first gaps are ~maxIntervalMs, then shorter)`,
  );
});

const disarmRearmDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── fromArmedRef: disarmed idle, then re-arm ──");

  const armed = yield* Ref.make(false);
  const ticks = yield* Ref.make(0);

  const proc = Process.make({
    name: "patterns/disarm-rearm",
    effect: Ref.update(ticks, (n) => n + 1),
    schedule: ProcessSchedule.fromArmedRef({ armed }),
    schedulePollWhileDisarmed: Duration.millis(100),
  });

  const runtime = Layer.mergeAll(
    ProcessStore.layer,
    Polling.spaced(Duration.millis(100)),
    ProcessSchedule.fromArmedRef({ armed }),
  );

  const fib = yield* Effect.forkChild(proc.effect.pipe(Effect.provide(runtime)));

  yield* TestClock.adjust(Duration.millis(350));
  const whileDisarmed = yield* Ref.get(ticks);

  yield* Ref.set(armed, true);
  yield* TestClock.adjust(Duration.millis(250));
  const afterRearm = yield* Ref.get(ticks);

  yield* Fiber.interrupt(fib);

  yield* Effect.logInfo(
    `ticks while disarmed: ${whileDisarmed} (expect 0); after re-arm: ${afterRearm} (expect ≥ 1)`,
  );
});

const program = Effect.gen(function* () {
  const ms = Duration.toMillis(resolveDisarmedFallbackPoll(undefined));
  yield* Effect.logInfo(
    `resolveDisarmedFallbackPoll(undefined) → ${ms} ms (default disarmed fallback, floored)`,
  );

  yield* acceleratingDemo;
  yield* disarmRearmDemo;

  yield* Effect.logInfo("Done. See docs/PROCESS-API.md for full API tables.");
}).pipe(Effect.provide(TestClock.layer()), Effect.scoped);

Effect.runPromise(program).then(
  () => {
    console.log("✅ process-supervisor-patterns.ts finished");
    process.exit(0);
  },
  (e) => {
    console.error("❌", e);
    process.exit(1);
  },
);
