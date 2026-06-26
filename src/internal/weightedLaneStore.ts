/**
 * @module internal/weightedLaneStore
 *
 * The weighted {@link LaneStore} impl behind `CustomQueueResource` (see
 * `docs/plans/weighted-middle-scheduling.md`). Three tiers:
 *
 * - **high** — strict top (polled first),
 * - **middle** — arbitrarily many numeric groups (`add(item, n)`); the number is the group's
 *   **weight**. Among non-empty middle groups a scheduler picks the next item — `"weighted"` (no
 *   starvation, service ∝ weight) or `"strict"` (highest number first, opt-in, can starve),
 * - **low** — strict bottom (polled only when high + middle are empty).
 *
 * Built on the transactional (`Tx*`) primitives: every lane is a plain array held in a {@link TxRef}
 * (the middle groups in a {@link TxHashMap}), and a single `Effect.tx` does the tiered choice
 * atomically. It is **poll-based** — the engine owns the worker-wake/blocking (see {@link LaneStore}).
 *
 * The `"weighted"` scheduler is virtual-time weighted-fair queuing (the take-one analog of deficit
 * round robin): each active group carries a virtual time advanced by `1 / weight` per item served,
 * and the smallest is chosen — so a weight-3 group is served ~3× as often as a weight-1 group, yet
 * no group starves (a neglected group keeps its low virtual time and is chosen next). An unseen or
 * rejoining group joins at the **system virtual time**, so it neither monopolizes nor is penalized.
 *
 * @internal
 */
import { Effect, Option, TxHashMap, TxRef } from "effect";
import type { Lane, LaneSizes, LaneStore } from "./laneStore";

/** Which middle-group scheduling algorithm to use. @internal */
export type SchedulerKind = "weighted" | "strict";

interface SchedulerState {
  /** Virtual time per active group (weighted scheduler only). Pruned when a group empties. */
  readonly vtime: Record<number, number>;
  /**
   * System virtual time — advances to the served group's tag on each take. An unseen or rejoining
   * group joins at `systemV` (not at 0, which would let it monopolize; not at the min-known, which
   * would penalize a present-but-never-served group).
   */
  readonly systemV: number;
}

/** Normalize a group key to a valid weight (≥ 1, integer). */
const weightOf = (group: number): number => Math.max(1, Math.floor(group));

interface Pick {
  readonly key: number;
  readonly nextState: SchedulerState;
}

/** Strict: the highest group number wins (can starve lower groups). Callers pass a non-empty array. */
const pickStrict = (
  nonEmpty: ReadonlyArray<readonly [number, ReadonlyArray<unknown>]>,
  state: SchedulerState,
): Pick => {
  let best: number | undefined;
  for (const [key] of nonEmpty) {
    if (best === undefined || key > best) best = key;
  }
  if (best === undefined) throw new Error("pickStrict: no non-empty groups");
  return { key: best, nextState: state };
};

/** Weighted-fair (virtual time): smallest virtual time wins; advance it by `1 / weight`. */
const pickWeighted = (
  nonEmpty: ReadonlyArray<readonly [number, ReadonlyArray<unknown>]>,
  state: SchedulerState,
): Pick => {
  let bestKey: number | undefined;
  let bestEff = state.systemV;
  for (const [key] of nonEmpty) {
    // Unseen/rejoining groups join at the system virtual time.
    const eff = state.vtime[key] ?? state.systemV;
    if (bestKey === undefined || eff < bestEff || (eff === bestEff && key < bestKey)) {
      bestKey = key;
      bestEff = eff;
    }
  }
  if (bestKey === undefined) throw new Error("pickWeighted: no non-empty groups");
  return {
    key: bestKey,
    nextState: {
      vtime: { ...state.vtime, [bestKey]: bestEff + 1 / weightOf(bestKey) },
      systemV: bestEff,
    },
  };
};

/**
 * Build a weighted {@link LaneStore}. `kind` selects the middle scheduler; high/low are strict.
 *
 * @internal
 */
export const makeWeightedLaneStore = <A>(options: {
  readonly kind: SchedulerKind;
}): Effect.Effect<LaneStore<A>> =>
  Effect.gen(function* () {
    const high = yield* TxRef.make<ReadonlyArray<A>>([]);
    const low = yield* TxRef.make<ReadonlyArray<A>>([]);
    const middle = yield* TxHashMap.make<number, ReadonlyArray<A>>();
    const sched = yield* TxRef.make<SchedulerState>({ vtime: {}, systemV: 0 });
    const pick = options.kind === "strict" ? pickStrict : pickWeighted;

    const offer = (item: A, lane: Lane): Effect.Effect<void> =>
      Effect.tx(
        Effect.gen(function* () {
          if (lane === "high") {
            yield* TxRef.update(high, (xs) => [...xs, item]);
          } else if (lane === "low") {
            yield* TxRef.update(low, (xs) => [...xs, item]);
          } else {
            const key = weightOf(lane.group);
            const existing = yield* TxHashMap.get(middle, key);
            const next = Option.match(existing, {
              onNone: () => [item] as ReadonlyArray<A>,
              onSome: (xs) => [...xs, item],
            });
            yield* TxHashMap.set(middle, key, next);
          }
        }),
      );

    const poll: Effect.Effect<Option.Option<A>> = Effect.tx(
      Effect.gen(function* () {
        const hi = yield* TxRef.get(high);
        const hiHead = hi[0];
        if (hiHead !== undefined) {
          yield* TxRef.set(high, hi.slice(1));
          return Option.some(hiHead);
        }

        const entries = yield* TxHashMap.entries(middle);
        const nonEmpty = entries.filter(([, items]) => items.length > 0);
        if (nonEmpty.length > 0) {
          const state = yield* TxRef.get(sched);
          const picked = pick(nonEmpty, state);
          const chosen = nonEmpty.find(([key]) => key === picked.key);
          const item = chosen?.[1][0];
          if (chosen !== undefined && item !== undefined) {
            const rest = chosen[1].slice(1);
            if (rest.length === 0) {
              yield* TxHashMap.remove(middle, picked.key);
              // Drop the emptied group's virtual time so it rejoins (at systemV) if it reappears.
              const { [picked.key]: _dropped, ...prunedVtime } = picked.nextState.vtime;
              yield* TxRef.set(sched, {
                vtime: prunedVtime,
                systemV: picked.nextState.systemV,
              });
            } else {
              yield* TxHashMap.set(middle, picked.key, rest);
              yield* TxRef.set(sched, picked.nextState);
            }
            return Option.some(item);
          }
        }

        const lo = yield* TxRef.get(low);
        const loHead = lo[0];
        if (loHead !== undefined) {
          yield* TxRef.set(low, lo.slice(1));
          return Option.some(loHead);
        }

        return Option.none<A>();
      }),
    );

    const isEmpty: Effect.Effect<boolean> = Effect.tx(
      Effect.gen(function* () {
        const hi = yield* TxRef.get(high);
        if (hi.length > 0) return false;
        const lo = yield* TxRef.get(low);
        if (lo.length > 0) return false;
        const entries = yield* TxHashMap.entries(middle);
        return entries.every(([, items]) => items.length === 0);
      }),
    );

    const sizes: Effect.Effect<LaneSizes> = Effect.tx(
      Effect.gen(function* () {
        const hi = yield* TxRef.get(high);
        const lo = yield* TxRef.get(low);
        const entries = yield* TxHashMap.entries(middle);
        const middleSizes: Record<number, number> = {};
        for (const [key, items] of entries) {
          if (items.length > 0) middleSizes[key] = items.length;
        }
        return { high: hi.length, low: lo.length, middle: middleSizes };
      }),
    );

    const drain: Effect.Effect<ReadonlyArray<A>> = Effect.tx(
      Effect.gen(function* () {
        const hi = yield* TxRef.get(high);
        const lo = yield* TxRef.get(low);
        const entries = yield* TxHashMap.entries(middle);
        const middleItems = entries
          .slice()
          .sort(([a], [b]) => a - b)
          .flatMap(([, items]) => items);
        yield* TxRef.set(high, []);
        yield* TxRef.set(low, []);
        for (const [key] of entries) {
          yield* TxHashMap.remove(middle, key);
        }
        yield* TxRef.set(sched, { vtime: {}, systemV: 0 });
        return [...hi, ...middleItems, ...lo];
      }),
    );

    const extractMatching = (
      predicate: (item: A) => boolean,
    ): Effect.Effect<ReadonlyArray<A>> =>
      Effect.tx(
        Effect.gen(function* () {
          const matched: A[] = [];
          const partition = (items: ReadonlyArray<A>): ReadonlyArray<A> => {
            const kept: A[] = [];
            for (const item of items) {
              if (predicate(item)) matched.push(item);
              else kept.push(item);
            }
            return kept;
          };

          const hi = yield* TxRef.get(high);
          yield* TxRef.set(high, partition(hi));

          const entries = yield* TxHashMap.entries(middle);
          for (const [key, items] of entries.slice().sort(([a], [b]) => a - b)) {
            const kept = partition(items);
            if (kept.length === 0) {
              yield* TxHashMap.remove(middle, key);
              yield* TxRef.update(sched, (s) => {
                const { [key]: _dropped, ...vtime } = s.vtime;
                return { vtime, systemV: s.systemV };
              });
            } else {
              yield* TxHashMap.set(middle, key, kept);
            }
          }

          const lo = yield* TxRef.get(low);
          yield* TxRef.set(low, partition(lo));

          return matched;
        }),
      );

    return { offer, poll, isEmpty, sizes, drain, extractMatching };
  });
