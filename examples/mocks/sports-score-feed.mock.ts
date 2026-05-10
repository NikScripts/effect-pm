/**
 * @module examples/mocks/sports-score-feed
 *
 * ## What this file is
 *
 * **Test-only** stand-in for a remote **scores HTTP API** used by
 * **`examples/sports-polling-accelerating.ts`** (three demos: basic spaced poll, minimal
 * accelerating + **`resetCadence`**, verbose cadence logging). The example imports **`readScore`**
 * and **`runSimulator`** and does **not** depend on how state is stored here (`Ref`, sleeps,
 * etc.).
 *
 * ---
 *
 * ## How the poller uses this double
 *
 * 1. **`readScore`** — what you would replace with `HttpClient.get` → parse JSON → `GameScore`.
 *    Called **once per process tick** (after the supervisor’s `awaitNextTick`).
 * 2. **`runSimulator`** — **only exists for the demo**: simulates the outside world mutating
 *    the scoreboard while **`TestClock`** advances. In production you **delete** this fiber
 *    entirely; the real league service updates scores without your code.
 * 3. **`runSimulator`** and the process **share** the same hidden `Ref` so reads see writes
 *    immediately after simulated time passes.
 *
 * ---
 *
 * ## Scripted timeline (simulated milliseconds)
 *
 * All sleeps are **`Effect.sleep`**, so under **`TestClock.layer()`** they consume **simulated**
 * time, not real wall time.
 *
 * | Elapsed since start | `readScore` returns | Why this value |
 * |--------------------|---------------------|----------------|
 * | **0 … 600** | **0–0** | First **`Polling.acceleratingScoped`** wait is ~**500 ms** at iteration 0, so the **first tick** still sees a **quiet** board. |
 * | **600 … 880** | **1–0** | First “goal” → poller compares **`scoreKey`** to last tick → should call **`resetCadence`**. |
 * | **880 … 1100** | **1–1** | Equalizer → another **`resetCadence`**. |
 * | **≥ 1100** | **2–1** | Lead change → reset again, then **no further writes** so **`afterTick`** keeps shrinking the poll gap until **`minIntervalMs`**. |
 *
 * ---
 *
 * ## How **`resetCadence`** interacts with score changes
 *
 * **`Polling.resetCadence`** (on the service the tick `yield*`s) does two things:
 *
 * 1. Sets the accelerating curve’s **iteration** back to **0** (longer delay before the next tick).
 * 2. **Wakes** the current `awaitNextTick` wait so you do not sit on an already-shortened delay
 *    from a previous burst.
 *
 * The **supervisor** and the **tick body** must share the **same** `Polling` layer instance.
 * That is why the example builds **`pollLayer` once** and provides it only at the **fork** of
 * `process.effect` (not inlined on `Process.make`). See **`docs/PROCESS-API.md`** and the
 * slim **`sports-polling-accelerating.ts`** header.
 *
 * ---
 *
 * ## Replacing this in production
 *
 * - Implement **`readScore`** with your HTTP client and error policy (retry, circuit break, etc.).
 * - Remove **`runSimulator`** and any `forkChild` of it.
 * - Keep **one** merged **`Layer`** for **`pollLayer` + `ProcessStore` + schedule** at the app root
 *   so **`resetCadence`** inside the tick still sees the supervisor’s polling service.
 */

import { Duration, Effect, Ref } from "effect";

/** Parsed “body” shape the poller cares about (not raw JSON). */
export interface GameScore {
  readonly home: number;
  readonly away: number;
}

/** Stable string for “did the board change?” — avoids deep compares. */
export const scoreKey = (g: GameScore): string => `${g.home}-${g.away}`;

/**
 * Allocates hidden state and returns the two effects the example wires up.
 *
 * @remarks
 * Idempotent usage: call once per program; fork **`runSimulator`** once alongside the process.
 */
export const makeSportsScoreFeedTestDouble = (): Effect.Effect<
  {
    readonly readScore: Effect.Effect<GameScore, never, never>;
    readonly runSimulator: Effect.Effect<void, never, never>;
  },
  never,
  never
> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<GameScore>({ home: 0, away: 0 });

    const readScore = Ref.get(state);

    const runSimulator = Effect.gen(function* () {
      yield* Effect.sleep(Duration.millis(600));
      yield* Ref.set(state, { home: 1, away: 0 });
      yield* Effect.sleep(Duration.millis(280));
      yield* Ref.set(state, { home: 1, away: 1 });
      yield* Effect.sleep(Duration.millis(220));
      yield* Ref.set(state, { home: 2, away: 1 });
    });

    return { readScore, runSimulator } as const;
  });
