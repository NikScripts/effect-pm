import { utcDateFromMillis } from "../../src/utcDate.js";
/**
 * @module examples/mocks/schedule-gate-scenarios
 *
 * ## What this file is
 *
 * Scenario scaffolding originally used for schedule-gate demo variants. These utilities remain
 * useful when building deterministic schedule scenarios with **`TestClock`**.
 * simple refs, and helper fibers under **`TestClock`**. None of this
 * is shipped library code; it exists so the **example entrypoint** stays short and the **deep
 * explanation** of *why* each demo behaves the way it does lives in one place.
 *
 * ---
 *
 * ## Demo 1 — `CRON_TOP_OF_EACH_MINUTE` helper
 *
 * Effect uses a **6-field cron string** including **seconds** as the first field.
 * **`"0 * * * * *"`** means: “when the clock’s **second** is `0`” → effectively **top of each
 * minute** (plus second 0 of the first minute).
 *
 * Use this parsed cron expression with your own schedule-entry construction logic.
 *
 * The **example** uses a **50 ms** sample interval so **`TestClock.adjust`** jumps line up with
 * recomputation quickly. **Production:** use the default **1 s** (or slower) so you do not churn
 * the scheduler; the example is intentionally aggressive for determinism.
 *
 * The runnable example logs **tick indices** instead of **`Clock.currentTimeMillis`** in the
 * tick body so the whole script stays **`Effect<…, never, never>`** after
 * **`Effect.provide(TestClock.layer())`** (the `TestClock` layer’s TypeScript brand does not
 * always satisfy **`Clock`** in **`R`** for **`runPromise`**).
 *
 * **Quirk you may see in logs:** right after a minute boundary, **`sampleInterval`** may still
 * report **`armed: true`** for **two** consecutive poll windows before the sampler observes
 * second ≠ 0, so you can get **two ticks** back-to-back. Tightening **`sampleInterval`** reduces
 * that window at the cost of more wakeups.
 *
 * ---
 *
 * ## Demo 2 — Maintenance window refs
 *
 * You model “we are down until **T**” with:
 *
 * - **`armed: Ref false`** — gate closed; **no** polling ticks.
 * - **`nextScheduleTransition: Ref Some(T)`** — tells **`Process`** “something about the gate
 *   might change near **T**”, so **`computeDisarmedIdleSleep`** can sleep **toward **T****
 *   instead of only a coarse fallback interval.
 *
 * **Important:** the hint does **not** flip **`armed`** for you. Another fiber (or your ops
 * pipeline) must **`Ref.set(armed, true)`** when the window actually ends. The example’s
 * **`reopenFiber`** sleeps **2.5 s** simulated time then opens the gate and clears the hint.
 *
 * ---
 *
 * ## Demo 3 — Dynamic toggles (feature flag / circuit breaker)
 *
 * Same primitive as **`examples/process-supervisor-patterns.ts`**: a boolean **`armed`** ref.
 * A **`policyFiber`** flips **`armed`** at
 * fixed simulated offsets so you can see “ticks while open, ~none while closed, ticks again
 * after reopen” under **`TestClock`** without real delays.
 *
 * ---
 *
 * ## Automated tests (library behavior, not this file)
 *
 * - **`test/process-schedule.test.ts`** — schedule entry storage + mutation semantics.
 * - **`test/process.test.ts`** — schedule-driven instance behavior.
 * - **`test/disarmedIdleSleep.test.ts`** — pure sleep policy.
 */

import { Cron, Duration, Effect, Option, Ref } from "effect";

/** Cron: second field `0` → align with start of each minute (Effect 6-field cron). */
export const CRON_TOP_OF_EACH_MINUTE = Cron.parseUnsafe("0 * * * * *");

/**
 * Allocates **`armed`** / **`reopenHint`** and seeds **`nextScheduleTransition`** to
 * **`new Date(2_500)`** — i.e. **2.5 s** after the **`TestClock`** default epoch (`0` ms).
 * That matches **`maintenanceReopenFiber(..., 2_500)`**, which sleeps 2.5 s then opens the gate.
 *
 * @remarks
 * We use a **fixed** `Date` here so this module’s effects stay **`R = never`**. That avoids a
 * typing mismatch where **`TestClock.layer()`** is declared as **`Layer<TestClock>`** but
 * implements **`Clock.Clock`**, so **`Effect.provide(TestClock.layer())`** does not always
 * erase **`Clock`** from the composed program’s requirements and **`Effect.runPromise`**
 * would reject the program.
 *
 * The actual **reopen** fiber is **`maintenanceReopenFiber`** — defined separately so it stays
 * a plain **`Effect<void, never, never>`** suitable for **`forkChild`**.
 */
export const allocateMaintenanceGate = (): Effect.Effect<{
  readonly armed: Ref.Ref<boolean>;
  readonly reopenHint: Ref.Ref<Option.Option<Date>>;
}> =>
  Effect.gen(function* () {
    const armed = yield* Ref.make(false);
    const reopenHint = yield* Ref.make<Option.Option<Date>>(Option.none());
    yield* Ref.set(reopenHint, Option.some(utcDateFromMillis(2_500)));
    return { armed, reopenHint };
  });

/**
 * After **`delayMs`** simulated sleep: open the gate and clear the transition hint.
 * Fork alongside the process under the same **`TestClock`**.
 */
export const maintenanceReopenFiber = (
  armed: Ref.Ref<boolean>,
  reopenHint: Ref.Ref<Option.Option<Date>>,
  delayMs: number,
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(delayMs));
    yield* Ref.set(armed, true);
    yield* Ref.set(reopenHint, Option.none());
  });

/**
 * Refs + policy fiber for “ops toggles gate over simulated time”.
 */
export const makeDynamicRefGateScenario = (): Effect.Effect<
  {
    readonly armed: Ref.Ref<boolean>;
    readonly policyFiber: Effect.Effect<void, never, never>;
  },
  never,
  never
> =>
  Effect.gen(function* () {
    const armed = yield* Ref.make(true);

    const policyFiber = Effect.gen(function* () {
      yield* Effect.sleep(Duration.millis(350));
      yield* Ref.set(armed, false);
      yield* Effect.sleep(Duration.millis(250));
      yield* Ref.set(armed, true);
    });

    return { armed, policyFiber };
  });
