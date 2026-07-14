/**
 * Prototype — keyed {@link ShardMapEntriesStore} (current values, not event replay).
 */
import { Effect, Option } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  ShardMapEntriesStore,
  hydrateLocalMap,
  layerMemory,
} from "../src/ShardMapEntriesStore";

describe("ShardMapEntriesStore prototype", () => {
  const scope = "@test/Sessions";

  it.effect("put/get/delete keep one live row per key — no journal", () =>
    Effect.gen(function* () {
      const store = yield* ShardMapEntriesStore;

      yield* store.put(scope, "a", { id: "a", userId: "u1" });
      yield* store.put(scope, "b", { id: "b", userId: "u2" });
      yield* store.put(scope, "a", { id: "a", userId: "u1-updated" }); // upsert

      expect(yield* store.size(scope)).toBe(2);
      const a = yield* store.get(scope, "a");
      expect(Option.isSome(a) && a.value).toEqual({
        id: "a",
        userId: "u1-updated",
      });

      expect(yield* store.delete(scope, "b")).toBe(true);
      expect(yield* store.delete(scope, "b")).toBe(false);
      expect(yield* store.size(scope)).toBe(1);

      const rows = yield* store.entries(scope);
      expect(rows).toEqual([
        {
          scopeKey: scope,
          key: "a",
          value: { id: "a", userId: "u1-updated" },
        },
      ]);
    }).pipe(Effect.provide(layerMemory)),
  );

  it.effect("hydrateLocalMap recovers from entries — O(live), not O(history)", () =>
    Effect.gen(function* () {
      const store = yield* ShardMapEntriesStore;
      // Simulate churn that would poison an event-log replay:
      for (let i = 0; i < 100; i++) {
        yield* store.put(scope, "churn", { n: i });
      }
      yield* store.put(scope, "kept", { id: "kept" });
      yield* store.delete(scope, "churn");

      const map = yield* hydrateLocalMap(scope);
      expect(map.size).toBe(1);
      expect(map.get("kept")).toEqual({ id: "kept" });
      // Still one live row on disk/memory — not 101 Put + 1 Delete events.
      expect(yield* store.size(scope)).toBe(1);
    }).pipe(Effect.provide(layerMemory)),
  );
});
