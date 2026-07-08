import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Store from "../src/Store";
import { layerDefaultMemory } from "../src/Store";

// A lean base: one `event` shape with `record` (append alias) + `events` (read alias).
const base = Store.contract(
  { event: Schema.Struct({ id: Schema.String }) },
  ({ event }) => ({
    record: event.append,
    events: event.read,
  }),
);

describe("Store.extend", () => {
  it.effect("data-first extend(methods, base): added methods and base methods both resolve", () =>
    Effect.gen(function* () {
      const contract = Store.extend(
        ({ event }) => ({
          // semantic write funnelling to the base's `event.append`
          started: (id: string) => event.append({ id }),
          // an effect-function that does not touch storage
          tagged: (s: string): Effect.Effect<string> => Effect.succeed(s.toUpperCase()),
        }),
        base,
      );
      const store = Store.effects("scope", contract);

      // base method (from the extended-onto contract) still works
      yield* store.record({ id: "a" });
      // added semantic write
      yield* store.started("b");
      // the shape's own default append
      yield* store.event.append({ id: "c" });

      expect(yield* store.events()).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
      // added effect-function method resolves through the effects object
      expect(yield* store.tagged("hi")).toBe("HI");
    }).pipe(Effect.provide(layerDefaultMemory)),
  );

  it.effect("data-last (pipeable) extend: base.pipe(Store.extend(methods)) round-trips", () =>
    Effect.gen(function* () {
      const contract = base.pipe(
        Store.extend(() => ({
          doubled: (n: number): Effect.Effect<number> => Effect.succeed(n * 2),
        })),
      );
      const store = Store.effects("scope-pipe", contract);

      yield* store.record({ id: "x" });
      expect(yield* store.events()).toEqual([{ id: "x" }]);
      expect(yield* store.doubled(21)).toBe(42);
    }).pipe(Effect.provide(layerDefaultMemory)),
  );

  it.effect("extend(shapes, methods, base): a NEW shape appends/reads independently of the base shape", () =>
    Effect.gen(function* () {
      const contract = Store.extend(
        { audit: Schema.Struct({ campaignId: Schema.String }) },
        ({ audit }) => ({
          recordAudit: audit.append,
        }),
        base,
      );
      const store = Store.effects("scope-shape", contract);

      yield* store.record({ id: "a" });
      yield* store.recordAudit({ campaignId: "c1" });
      yield* store.audit.append({ campaignId: "c2" });

      // the two shapes are isolated journals
      expect(yield* store.events()).toEqual([{ id: "a" }]);
      expect(yield* store.audit.read()).toEqual([{ campaignId: "c1" }, { campaignId: "c2" }]);
    }).pipe(Effect.provide(layerDefaultMemory)),
  );

  it("extend rejects a shape key that already exists on the base", () => {
    expect(() =>
      Store.extend({ event: Schema.Struct({ id: Schema.String }) }, base),
    ).toThrow(/already declared/);
  });
});
