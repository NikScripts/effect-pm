/**
 * @module examples/process-supervisor-patterns
 *
 * ## Supervisor patterns (v0.7+) — **no real wall-clock sleeps**
 *
 * This file complements **`examples/example.ts`**: instead of a full `ProcessGroup`, each
 * demo **`Effect.forkChild`s** a single `process.effect` and drives time with **`TestClock`**.
 * That keeps CI and laptops fast while still exercising real supervisor code paths.
 *
 * ### Demos included (read top-to-bottom in source)
 *
 * 1. **`acceleratingDemo`** — `Polling.acceleratingScoped`: delay **shrinks** each tick.
 *    From any effect that shares the merged `Polling` layer, **`yield* Polling.resetCadence`**
 *    snaps back toward the long initial delay and wakes the waiter.
 * 2. **`disarmRearmDemo`** — mutate in-memory schedule entries (`set` / `clear`) to
 *    disarm and then re-arm windows.
 *    Compare with `stopProcess`, which **interrupts** the fiber.
 *
 * For schedule composition patterns and runtime mutation examples,
 * see **`examples/schedule-control-surfaces.ts`**.
 *
 * ### How to run
 *
 * ```bash
 * pnpm run example:process-supervisor-patterns
 * # or
 * npx tsx examples/process-supervisor-patterns.ts
 * ```
 *
 * ### Further reading
 *
 * - `docs/PROCESS-API.md` — tables for `Polling`, `ProcessSchedule`, disarmed sleep helpers
 * - `docs/plans/09-process-v2-effect-first.md` — canonical supervisor semantics
 * - `examples/example.ts` — full `ProcessGroup` + real clock demo
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

/** Demonstrates **accelerating** cadence + explicit time jumps via `TestClock`. */
const acceleratingDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── Accelerating polling (intervals shrink each tick) ──");

  const tickCount = yield* Ref.make(0);

  const proc = Process.make({
    name: "patterns/accelerating",
    effect: Ref.update(tickCount, (n) => n + 1),
    schedule: ProcessSchedule.inMemory([
      ProcessSchedule.at("patterns-accelerating", new Date(0)),
    ]),
  });

  const runtime = Layer.mergeAll(
    ProcessStore.layer,
    Polling.acceleratingScoped({
      minIntervalMs: 40,
      maxIntervalMs: 400,
      decayK: 0.4,
    }),
    ProcessSchedule.inMemory([
      ProcessSchedule.at("patterns-accelerating", new Date(0)),
    ]),
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

/** Demonstrates delayed start from a schedule entry. */
const disarmRearmDemo = Effect.gen(function* () {
  yield* Effect.logInfo("── schedule entry starts later, then process begins ──");

  const ticks = yield* Ref.make(0);

  const proc = Process.make({
    name: "patterns/disarm-rearm",
    effect: Ref.update(ticks, (n) => n + 1),
  });

  const runtime = Layer.mergeAll(
    ProcessStore.layer,
    Polling.spaced(Duration.millis(100)),
    ProcessSchedule.inMemory([
      ProcessSchedule.at("delayed-start", new Date(500)),
    ]),
  );

  const fib = yield* Effect.forkChild(proc.effect.pipe(Effect.provide(runtime)));

  yield* TestClock.adjust(Duration.millis(350));
  const whileDisarmed = yield* Ref.get(ticks);

  yield* TestClock.adjust(Duration.millis(250));
  const afterRearm = yield* Ref.get(ticks);

  yield* Fiber.interrupt(fib);

  yield* Effect.logInfo(
    `ticks before startAt: ${whileDisarmed} (expect 0); ticks after startAt: ${afterRearm} (expect ≥ 1)`,
  );
});

/** Runs demos under **`TestClock.layer`** so sleeps in the supervisor are simulated. */
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
