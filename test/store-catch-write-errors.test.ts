import { describe, expect, it } from "@effect/vitest";
import { Cause, Data, Effect, Exit, Schema, pipe } from "effect";
import * as Store from "../src/Store";
import { layerDefaultMemory } from "../src/Store";
import { StoreWriteError } from "../src/internal/store/errors";

// `Schema.Finite` rejects non-finite numbers on encode — NaN is a valid `number` (so it type-checks as
// a row) but fails the encode step, which `Store.effects`' append path turns into a DEFECT.
const finiteContract = Store.contract({
  readings: Schema.Struct({ n: Schema.Finite }),
});

const okContract = Store.contract({
  readings: Schema.Struct({ n: Schema.Number }),
});

describe("Store.catchWriteErrors", () => {
  it.effect("(a) an encode mismatch still DIES through a guarded store (defects are not swallowed)", () =>
    Effect.gen(function* () {
      const store = pipe(Store.effects("readings", finiteContract), Store.catchWriteErrors);

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
      const store = pipe(Store.effects("ok", okContract), Store.catchWriteErrors);

      yield* store.readings.append({ n: 1 });
      yield* store.readings.append({ n: 2 });

      expect(yield* store.readings.read()).toEqual([{ n: 1 }, { n: 2 }]);
    }).pipe(Effect.provide(layerDefaultMemory)),
  );

  it.effect("(c) reads behave identically through the guarded store", () =>
    Effect.gen(function* () {
      const store = Store.catchWriteErrors(Store.effects("cc", okContract));

      yield* store.readings.append({ n: 5 });
      expect(yield* store.readings.read()).toEqual([{ n: 5 }]);
    }).pipe(Effect.provide(layerDefaultMemory)),
  );
});

// ============================================================================
// Focused unit test of the guard's discrimination: only a `StoreWriteError`
// FAILURE is caught+swallowed; a defect and any other failure are NOT.
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty payload for discrimination test
class OtherError extends Data.TaggedError("OtherError")<{}> {}

/** A branded effects object whose methods deterministically fail in each category. */
const failing = {
  // The `StoreEffectsVariance` brand (covariant `_C`), enough to satisfy the constraint.
  [Store.TypeId]: { _C: (_: never): never => _ },
  writeFail: () => Effect.fail(new StoreWriteError({ cause: "disk full" })),
  writeOther: () => Effect.fail(new OtherError()),
  writeDefect: () => Effect.die("boom"),
  read: () => Effect.succeed([1, 2, 3]),
};

describe("Store.catchWriteErrors — category discrimination", () => {
  const guarded = Store.catchWriteErrors(failing);

  it.effect("swallows a StoreWriteError failure (succeeds as void)", () =>
    Effect.gen(function* () {
      const exit = yield* guarded.writeFail().pipe(Effect.exit);
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("re-raises a non-StoreWriteError failure untouched", () =>
    Effect.gen(function* () {
      const exit = yield* guarded.writeOther().pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasFails(exit.cause)).toBe(true);
        expect(Cause.hasDies(exit.cause)).toBe(false);
      }
    }),
  );

  it.effect("does NOT swallow a defect", () =>
    Effect.gen(function* () {
      const exit = yield* guarded.writeDefect().pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
      }
    }),
  );

  it.effect("leaves reads transparent", () =>
    Effect.gen(function* () {
      expect(yield* guarded.read()).toEqual([1, 2, 3]);
    }),
  );

  it("keeps the effects brand on the guarded result", () => {
    expect(Store.isStoreEffects(guarded)).toBe(true);
  });
});
