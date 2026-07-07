import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Storage, layerDefaultMemory } from "../src/Store";
import * as Store from "../src/Store";

// The baked-in default store: with NO app `Store.Service` provided, the bridge still resolves any
// scope on demand against a process-local in-memory journal. This is what lets the queue engine
// append unconditionally — there is always a store, so no serviceOption.

const readingsContract = Store.contract({
  readings: Schema.Struct({ value: Schema.Number }),
});

describe("baked-in default store (layerDefaultMemory)", () => {
  it.effect("resolves + round-trips a scope with no app Store.Service provided", () =>
    Effect.gen(function* () {
      const bridge = yield* Storage;
      const handle = yield* bridge.at("scope-a", readingsContract);

      yield* handle.readings.append({ value: 42 });
      yield* handle.readings.append({ value: 7 });

      expect(yield* handle.readings.read()).toEqual([{ value: 42 }, { value: 7 }]);
    }).pipe(Effect.provide(layerDefaultMemory), Effect.scoped),
  );

  it.effect("keeps scopes isolated by scopeKey (one journal, keyed rows — no 'sharing')", () =>
    Effect.gen(function* () {
      const bridge = yield* Storage;
      const a = yield* bridge.at("scope-a", readingsContract);
      const b = yield* bridge.at("scope-b", readingsContract);

      yield* a.readings.append({ value: 1 });
      yield* b.readings.append({ value: 2 });

      expect(yield* a.readings.read()).toEqual([{ value: 1 }]);
      expect(yield* b.readings.read()).toEqual([{ value: 2 }]);
    }).pipe(Effect.provide(layerDefaultMemory), Effect.scoped),
  );
});
