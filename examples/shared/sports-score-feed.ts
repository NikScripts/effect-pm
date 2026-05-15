/**
 * @module examples/shared/sports-score-feed
 *
 * Test double for a scores HTTP API — used by forms/polling/* sports demos.
 */

import { Duration, Effect, Ref } from "effect";

export interface GameScore {
  readonly home: number;
  readonly away: number;
}

export const scoreKey = (g: GameScore): string => `${g.home}-${g.away}`;

/**
 * Returns readScore (per tick) and runSimulator (demo-only side fiber).
 *
 * Scripted timeline under TestClock:
 * - t < 600 ms  → 0-0
 * - t ≈ 600 ms  → 1-0
 * - t ≈ 880 ms  → 1-1
 * - t ≈ 1100 ms → 2-1
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
