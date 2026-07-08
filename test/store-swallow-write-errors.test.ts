import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Schema, pipe } from "effect";
import * as Store from "../src/Store";
import { layerDefaultMemory } from "../src/Store";

// `Schema.Finite` rejects non-finite numbers on encode — NaN is a valid `number` (so it type-checks as
// a row) but fails the encode step, which `Store.effects`' append path turns into a DEFECT.
const finiteContract = Store.contract({
  readings: Schema.Struct({ n: Schema.Finite }),
});

const okContract = Store.contract({
  readings: Schema.Struct({ n: Schema.Number }),
});

describe("Store.swallowWriteErrors", () => {
  it.effect("(a) an encode mismatch still DIES through a swallowed store (defects are not swallowed)", () =>
    Effect.gen(function* () {
      const store = pipe(Store.effects("readings", finiteContract), Store.swallowWriteErrors);

      const exit = yield* store.readings.append({ n: Number.NaN }).pipe(Effect.exit);

      // Swallowed → would be Success(void); instead it is a defect that propagated untouched.
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
      }
    }).pipe(Effect.provide(layerDefaultMemory)),
  );

  it.effect("(b) a normal append round-trips transparently through the transform", () =>
    Effect.gen(function* () {
      const store = pipe(Store.effects("ok", okContract), Store.swallowWriteErrors);

      yield* store.readings.append({ n: 1 });
      yield* store.readings.append({ n: 2 });

      expect(yield* store.readings.read()).toEqual([{ n: 1 }, { n: 2 }]);
    }).pipe(Effect.provide(layerDefaultMemory)),
  );

  it.effect("(c) reads are untouched (same reference); only write methods are wrapped", () =>
    Effect.gen(function* () {
      const original = Store.effects("cc", okContract);
      const swallowed = Store.swallowWriteErrors(original);

      // The read method is the SAME function reference — the transform leaves it alone …
      expect(swallowed.readings.read).toBe(original.readings.read);
      // … while the write method is replaced by the guarded wrapper.
      expect(swallowed.readings.append).not.toBe(original.readings.append);

      // And reads still behave normally through the transformed store.
      yield* swallowed.readings.append({ n: 5 });
      expect(yield* swallowed.readings.read()).toEqual([{ n: 5 }]);
    }).pipe(Effect.provide(layerDefaultMemory)),
  );
});
