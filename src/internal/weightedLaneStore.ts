/**
 * @module internal/weightedLaneStore
 *
 * The custom data structure behind `CustomQueueResource` (see
 * `docs/plans/weighted-middle-scheduling.md`). Three tiers:
 *
 * - **high** — strict top (always taken first),
 * - **middle** — arbitrarily many numeric groups (`Queue.add(item, n)`); the number is the group's
 *   **weight**. Among non-empty middle groups a scheduler picks the next item — `"weighted"` (no
 *   starvation, service ∝ weight) or `"strict"` (highest number first, opt-in, can starve),
 * - **low** — strict bottom (taken only when high + middle are empty).
 *
 * Built on the transactional (`Tx*`) primitives: every lane is a plain array held in a {@link TxRef}
 * (the middle groups in a {@link TxHashMap}), and a single `Effect.Transaction` does the tiered
 * choice atomically — `Effect.txRetry` provides the blocking take (wake-on-offer) and safe
 * multi-worker pulls for free, replacing manual wake signals.
 *
 * The `"weighted"` scheduler is virtual-time weighted-fair queuing (the take-one analog of deficit
 * round robin): each active group carries a virtual time advanced by `1 / weight` per item served,
 * and the smallest virtual time is chosen — so a weight-3 group is served ~3× as often as a weight-1
 * group, yet no group starves (a neglected group keeps its low virtual time and is chosen next).
 *
 * @internal
 */
import { Effect, Option, Queue, TxHashMap, TxRef } from "effect";

/** Which middle-group scheduling algorithm to use. @internal */
export type SchedulerKind = "weighted" | "strict";

/** Where an offered item goes. A middle `group` number is also its weight (must be ≥ 1). @internal */
export type Lane = "high" | "low" | { readonly group: number };

/** Per-lane occupancy. `groups` is keyed by the middle group number. @internal */
export interface LaneSizes {
  readonly high: number;
  readonly low: number;
  readonly groups: Record<number, number>;
}

/** The custom lane store — the `LaneStore` impl for weighted/strict middle scheduling. @internal */
export interface WeightedLaneStore<A> {
  /** Enqueue `item` into a lane (FIFO within the lane/group). */
  readonly offer: (item: A, lane: Lane) => Effect.Effect<void>;
  /** Take the next item by tier + middle schedule; blocks (transactionally) until one is available. */
  readonly take: Effect.Effect<A>;
  /** Like {@link take} but returns `Option.none` instead of blocking when empty. */
  readonly poll: Effect.Effect<Option.Option<A>>;
  /** Current per-lane occupancy. */
  readonly sizes: Effect.Effect<LaneSizes>;
  /** Remove and return every queued item (high, then middle by group ascending, then low). */
  readonly drain: Effect.Effect<ReadonlyArray<A>>;
}

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
 * Build a {@link WeightedLaneStore}. `kind` selects the middle scheduler; the high/low tiers are
 * always strict.
 *
 * @internal
 */
export const makeWeightedLaneStore = <A>(options: {
  readonly kind: SchedulerKind;
}): Effect.Effect<WeightedLaneStore<A>> =>
  Effect.gen(function* () {
    const high = yield* TxRef.make<ReadonlyArray<A>>([]);
    const low = yield* TxRef.make<ReadonlyArray<A>>([]);
    const middle = yield* TxHashMap.make<number, ReadonlyArray<A>>();
    const sched = yield* TxRef.make<SchedulerState>({ vtime: {}, systemV: 0 });
    // Wake doorbell: every offer rings it; the blocking `take` waits on it between polls. Blocking is
    // poll + doorbell rather than transactional `txRetry` (the latter's wake proved unreliable here).
    // An unbounded ring buffer means no lost wakeups; spurious rings just cost an extra poll.
    const doorbell = yield* Queue.unbounded<void>();
    const pick = options.kind === "strict" ? pickStrict : pickWeighted;

    const offer = (item: A, lane: Lane): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.tx(
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
        yield* Queue.offer(doorbell, undefined);
      });

    /** The tiered choice, shared by take (blocks) and poll (returns none). */
    const choose = Effect.gen(function* () {
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
    });

    const poll: Effect.Effect<Option.Option<A>> = Effect.tx(choose);

    const take: Effect.Effect<A> = Effect.gen(function* () {
      while (true) {
        const polled = yield* poll;
        if (Option.isSome(polled)) return polled.value;
        // Empty: wait for the next offer to ring the doorbell, then re-poll.
        yield* Queue.take(doorbell);
      }
    });

    const sizes: Effect.Effect<LaneSizes> = Effect.tx(
      Effect.gen(function* () {
        const hi = yield* TxRef.get(high);
        const lo = yield* TxRef.get(low);
        const entries = yield* TxHashMap.entries(middle);
        const groups: Record<number, number> = {};
        for (const [key, items] of entries) {
          if (items.length > 0) groups[key] = items.length;
        }
        return { high: hi.length, low: lo.length, groups };
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

    return { offer, take, poll, sizes, drain };
  });
