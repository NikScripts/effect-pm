import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Store from "../src/Store";
import { Storage, layerDefaultMemory } from "../src/Store";

const nestedContract = Store.contract({
  sensors: {
    temperature: Schema.Struct({ celsius: Schema.Number }),
    humidity: Schema.Struct({ percent: Schema.Number }),
  },
});

const queueContract = Store.contract(
  { event: Schema.Struct({ id: Schema.String }) },
  ({ event }) => ({
    record: event.append,
    events: event.read,
  }),
);

describe("Store.effects", () => {
  it("stamps the TypeId brand — isStoreEffects is true for effects, false for a plain object", () => {
    const store = Store.effects("sensors", nestedContract);
    expect(Store.isStoreEffects(store)).toBe(true);
    // The transform preserves the brand (rebuilt object is re-stamped).
    expect(Store.isStoreEffects(Store.catchWriteErrors(store))).toBe(true);
    expect(Store.isStoreEffects({})).toBe(false);
    expect(Store.isStoreEffects(null)).toBe(false);
    // The brand is non-enumerable — invisible to method access / destructuring.
    expect(Object.keys(store)).not.toContain(Store.TypeId);
  });

  it.effect("append/read round-trips against the provided store (requirement satisfied by the layer)", () =>
    Effect.gen(function* () {
      const store = Store.effects("sensors", nestedContract);

      // Nested default effects — each is Effect<…, never, Storage>, satisfied by the provided layer.
      yield* store.sensors.temperature.append({ celsius: 21 });
      yield* store.sensors.temperature.append({ celsius: 25 });
      yield* store.sensors.humidity.append({ percent: 40 });

      expect(yield* store.sensors.temperature.read()).toEqual([{ celsius: 21 }, { celsius: 25 }]);
      expect(yield* store.sensors.humidity.read()).toEqual([{ percent: 40 }]);
    }).pipe(Effect.provide(layerDefaultMemory)),
  );

  it.effect("custom methods resolve through the effects object too", () =>
    Effect.gen(function* () {
      const store = Store.effects("queue", queueContract);

      yield* store.record({ id: "a" });
      yield* store.event.append({ id: "b" });

      expect(yield* store.events()).toEqual([{ id: "a" }, { id: "b" }]);
    }).pipe(Effect.provide(layerDefaultMemory)),
  );

  it.effect("bridge.at memoizes: the same (scope, contract) yields the SAME handle reference", () =>
    Effect.gen(function* () {
      const bridge = yield* Storage;

      const first = yield* bridge.at("scope-x", nestedContract);
      const second = yield* bridge.at("scope-x", nestedContract);
      // Write-once: identical reference on the second resolution.
      expect(second).toBe(first);

      // A different contract reference is a distinct cache entry.
      const other = Store.contract({ readings: Schema.Struct({ v: Schema.Number }) });
      const third = yield* bridge.at("scope-x", other);
      expect(third).not.toBe(first);

      // A different scope key is a distinct cache entry too.
      const otherScope = yield* bridge.at("scope-y", nestedContract);
      expect(otherScope).not.toBe(first);
    }).pipe(Effect.provide(layerDefaultMemory)),
  );
});
