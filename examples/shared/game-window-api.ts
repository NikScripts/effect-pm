/**
 * @module examples/shared/game-window-api
 *
 * **Test double** for “we polled an external **game schedule** API and learned when the match
 * is **live** vs **finished**”. Used by **`examples/scenarios/game-window-polling-with-process-group.ts`**.
 *
 * ### Scripted timeline (simulated ms, under **`TestClock`**)
 *
 * | Phase | Simulated delay (cumulative) | What happens to schedule state |
 * |-------|------------------------------|-------------------------------|
 * | Pre-game | **0 → 800** | no active schedule entry — no process ticks. |
 * | Kickoff | at **800** | entry opens — process may poll your `effect`. |
 * | Live window | **800 → 2000** | entry active — ticks run per **`Polling`**. |
 * | Full time | at **2000** | entry closes — ticks stop; driver stays alive until **`ProcessGroup.stop`**. |
 *
 * ### Production swap-in
 *
 * Replace this `Effect.gen` with a loop: **`HttpClient.request`** → parse JSON → compare
 * **`Date` / ISO strings** and update your schedule entries (`set` / `add` / `clear`).
 * Run it as its own supervised fiber or merge into your app **`Layer`**.
 */

import { Duration, Effect, Ref } from "effect";

/**
 * Fiber body: flip **`armed`** when our pretend API says the game went live / ended.
 * Fork with **`Effect.forkChild`** alongside **`group.start`** (see example file).
 */
export const gameScheduleApiSimulator = (
  armed: Ref.Ref<boolean>,
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    // Pretend network + parsing latency before first successful poll.
    yield* Effect.sleep(Duration.millis(800));
    yield* Ref.set(armed, true);

    // Pretend game duration until the API reports full time.
    yield* Effect.sleep(Duration.millis(1_200));
    yield* Ref.set(armed, false);
  });
