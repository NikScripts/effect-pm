/**
 * N-level {@link LaneStore} with scheduled take (`weighted`, `strict-descending`, or custom pick).
 * Not imported on the default queue bundle path — loaded via dynamic import from
 * {@link laneStoreFactoryFromConfig}.
 *
 * @internal
 */
import { Effect, Option, Queue, SynchronizedRef } from "effect";
import type { LaneStore, LevelSizes } from "./laneStore";
import type { TakeAlgorithm, TakeAlgorithmPickContext } from "./takeAlgorithm";

const clampLevel = (level: number, levelCount: number): number =>
  Math.min(levelCount - 1, Math.max(0, Math.floor(level)));

const weightOf = (level: number): number => Math.max(1, Math.floor(level));

interface WeightedState {
  readonly vtime: Record<number, number>;
  readonly systemV: number;
}

interface PickResult {
  readonly level: number;
  readonly nextState: unknown;
}

const pickStrictDescending = (
  nonEmpty: ReadonlyArray<{ readonly level: number; readonly size: number }>,
  state: unknown,
): PickResult => {
  let best: number | undefined;
  for (const { level } of nonEmpty) {
    if (best === undefined || level > best) best = level;
  }
  if (best === undefined) throw new Error("pickStrictDescending: no non-empty levels");
  return { level: best, nextState: state };
};

const pickWeighted = (
  nonEmpty: ReadonlyArray<{ readonly level: number; readonly size: number }>,
  state: unknown,
): PickResult => {
  const sched =
    state === undefined
      ? { vtime: {}, systemV: 0 }
      : (state as WeightedState);
  let bestLevel: number | undefined;
  let bestEff = sched.systemV;
  for (const { level } of nonEmpty) {
    const eff = sched.vtime[level] ?? sched.systemV;
    if (
      bestLevel === undefined ||
      eff < bestEff ||
      (eff === bestEff && level < bestLevel)
    ) {
      bestLevel = level;
      bestEff = eff;
    }
  }
  if (bestLevel === undefined) throw new Error("pickWeighted: no non-empty levels");
  return {
    level: bestLevel,
    nextState: {
      vtime: { ...sched.vtime, [bestLevel]: bestEff + 1 / weightOf(bestLevel) },
      systemV: bestEff,
    },
  };
};

const resolvePick = (
  takeAlgorithm: Exclude<TakeAlgorithm, "priority">,
  nonEmpty: ReadonlyArray<{ readonly level: number; readonly size: number }>,
  state: unknown,
): PickResult | undefined => {
  if (typeof takeAlgorithm === "string") {
    if (takeAlgorithm === "strict-descending") {
      return pickStrictDescending(nonEmpty, state);
    }
    return pickWeighted(nonEmpty, state);
  }
  const ctx: TakeAlgorithmPickContext = { nonEmpty, state };
  return takeAlgorithm(ctx);
};

/**
 * @internal
 */
export const makeLevelLaneStoreScheduled = <A>(options: {
  readonly levelCount: number;
  readonly capacity: number;
  readonly takeAlgorithm: Exclude<TakeAlgorithm, "priority">;
}): Effect.Effect<LaneStore<A>> =>
  Effect.gen(function* () {
    const levelCount = Math.max(1, Math.floor(options.levelCount));
    const takeAlgorithm = options.takeAlgorithm;

    const queues: Array<Queue.Queue<A>> = [];
    for (let i = 0; i < levelCount; i++) {
      queues.push(yield* Queue.bounded<A>(options.capacity));
    }
    const sched = yield* SynchronizedRef.make<unknown>(undefined);

    const sizeOf = (q: Queue.Queue<A>): Effect.Effect<number> =>
      Effect.map(Queue.size(q), (n) => Math.max(0, n));

    const nonEmptyLevels = (): Effect.Effect<
      ReadonlyArray<{ readonly level: number; readonly size: number }>
    > =>
      Effect.gen(function* () {
        const out: Array<{ level: number; size: number }> = [];
        for (let i = 0; i < levelCount; i++) {
          const size = yield* sizeOf(queues[i]!);
          if (size > 0) out.push({ level: i, size });
        }
        return out;
      });

    const offer = (item: A, level: number): Effect.Effect<void> =>
      Queue.offer(queues[clampLevel(level, levelCount)]!, item);

    const poll: Effect.Effect<Option.Option<A>> = SynchronizedRef.modifyEffect(
      sched,
      (state) =>
        Effect.gen(function* () {
          const nonEmpty = yield* nonEmptyLevels();
          if (nonEmpty.length === 0) {
            return [Option.none<A>(), state] as const;
          }
          const picked = resolvePick(takeAlgorithm, nonEmpty, state);
          if (picked === undefined) {
            return [Option.none<A>(), state] as const;
          }
          const item = yield* Queue.poll(queues[picked.level]!);
          if (Option.isNone(item)) {
            return [Option.none<A>(), state] as const;
          }
          let nextState = picked.nextState;
          if (typeof takeAlgorithm === "string" && takeAlgorithm === "weighted") {
            const remaining = yield* sizeOf(queues[picked.level]!);
            if (remaining === 0) {
              const ws = nextState as WeightedState;
              const { [picked.level]: _dropped, ...vtime } = ws.vtime;
              nextState = { vtime, systemV: ws.systemV };
            }
          }
          return [item, nextState] as const;
        }),
    );

    const isEmpty: Effect.Effect<boolean> = Effect.gen(function* () {
      for (let i = 0; i < levelCount; i++) {
        if ((yield* sizeOf(queues[i]!)) > 0) return false;
      }
      return true;
    });

    const sizes: Effect.Effect<LevelSizes> = Effect.gen(function* () {
      const out: number[] = [];
      for (let i = 0; i < levelCount; i++) {
        out.push(yield* sizeOf(queues[i]!));
      }
      return out;
    });

    const drainLane = (
      q: Queue.Queue<A>,
      onItem: (item: A) => boolean,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const kept: A[] = [];
        let polled = yield* Queue.poll(q);
        while (Option.isSome(polled)) {
          if (!onItem(polled.value)) kept.push(polled.value);
          polled = yield* Queue.poll(q);
        }
        if (kept.length > 0) yield* Queue.offerAll(q, kept);
      });

    const drain: Effect.Effect<ReadonlyArray<A>> = Effect.gen(function* () {
      const out: A[] = [];
      for (let i = 0; i < levelCount; i++) {
        yield* drainLane(queues[i]!, (item) => (out.push(item), true));
      }
      yield* SynchronizedRef.set(sched, undefined);
      return out;
    });

    const extractMatching = (
      predicate: (item: A) => boolean,
    ): Effect.Effect<ReadonlyArray<A>> =>
      Effect.gen(function* () {
        const matched: A[] = [];
        const take = (item: A): boolean => {
          if (predicate(item)) {
            matched.push(item);
            return true;
          }
          return false;
        };
        for (let i = 0; i < levelCount; i++) {
          yield* drainLane(queues[i]!, take);
        }
        return matched;
      });

    return { offer, poll, isEmpty, sizes, drain, extractMatching };
  });
