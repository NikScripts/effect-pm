/**
 * Unit tests for {@link optionalFacetEmit} and bridge helpers.
 */

import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Ref } from "effect";
import {
  facetHasOwnMethod,
  optionalFacetEmit,
  optionalFacetEmitWithBridge,
} from "../../src/internal/store/helpers";

type OptionalEmitTestService =
  | { readonly persist: () => Effect.Effect<void> }
  | {
      readonly persist: () => Effect.Effect<void>;
      readonly recordEntry: () => Effect.Effect<void>;
    };

class OptionalEmitTestStore extends Context.Service<
  OptionalEmitTestStore,
  OptionalEmitTestService
>()(
  "@nikscripts/effect-pm/test/internal/store-helpers.test/OptionalEmitTestStore",
) {}

describe("optionalFacetEmit", () => {
  it.effect("no-ops when the facet tag is absent", () =>
    optionalFacetEmit(OptionalEmitTestStore, (api) => api.persist()).pipe(
      Effect.as(true),
    ),
  );

  it.effect("runs onSome when the facet is provided", () =>
    Effect.gen(function* () {
      const ref = yield* Ref.make(0);
      yield* optionalFacetEmit(OptionalEmitTestStore, () =>
        Ref.update(ref, (n) => n + 1),
      );
      expect(yield* Ref.get(ref)).toBe(1);
    }).pipe(
      Effect.provide(
        Layer.succeed(OptionalEmitTestStore, {
          persist: () => Effect.void,
        }),
      ),
    ),
  );
});

describe("optionalFacetEmitWithBridge", () => {
  it.effect("uses onMock when the instance owns the marker method", () =>
    Effect.gen(function* () {
      const ref = yield* Ref.make<"mock" | "real">("real");
      yield* optionalFacetEmitWithBridge(
        OptionalEmitTestStore,
        "recordEntry",
        () => Ref.set(ref, "mock"),
        () => Ref.set(ref, "real"),
      );
      expect(yield* Ref.get(ref)).toBe("mock");
    }).pipe(
      Effect.provide(
        Layer.succeed(OptionalEmitTestStore, {
          recordEntry: () => Effect.void,
          persist: () => Effect.void,
        }),
      ),
    ),
  );

  it.effect("uses onReal for a normal telemetry-shaped instance", () =>
    Effect.gen(function* () {
      const ref = yield* Ref.make<"mock" | "real">("mock");
      yield* optionalFacetEmitWithBridge(
        OptionalEmitTestStore,
        "recordEntry",
        () => Ref.set(ref, "mock"),
        () => Ref.set(ref, "real"),
      );
      expect(yield* Ref.get(ref)).toBe("real");
    }).pipe(
      Effect.provide(
        Layer.succeed(OptionalEmitTestStore, {
          persist: () => Effect.void,
        }),
      ),
    ),
  );
});

describe("facetHasOwnMethod", () => {
  it("detects own properties only", () => {
    const withRecord = { recordEntry: () => undefined, persist: () => undefined };
    expect(facetHasOwnMethod(withRecord, "recordEntry")).toBe(true);
    expect(facetHasOwnMethod(withRecord, "persist")).toBe(true);
    expect(facetHasOwnMethod({ persist: () => undefined }, "recordEntry")).toBe(
      false,
    );
  });
});
