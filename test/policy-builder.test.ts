/**
 * PolicyBuilder — Schema keys + class extends; module recreates helpers.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as PolicyBuilder from "../src/PolicyBuilder";
import * as Policy from "../src/Policy";

const modeSchema = Schema.Literals(["a", "b"]);

class Demo extends PolicyBuilder.make("policy-builder-test/Demo")
  .key("Flag", Schema.Boolean, { defaultValue: () => false })
  .key("Mode", modeSchema, {
    defaultValue: (): Schema.Schema.Type<typeof modeSchema> => "a",
  })
  .key("Handler", Schema.Number, {
    defaultValue: (): Effect.Effect<number> => Effect.succeed(0),
    toRuntime: (n: number) => Effect.succeed(n),
  }) {}

const Flag = Demo.references.Flag;
const Mode = Demo.references.Mode;
const Handler = Demo.references.Handler;

const readDemo = Effect.gen(function* () {
  return {
    flag: yield* Flag,
    mode: yield* Mode,
    handler: yield* Handler,
  };
});

describe("PolicyBuilder family", () => {
  it.effect("class extends make+key(schema); make/succeed stamp decoded config", () =>
    Effect.gen(function* () {
      const bundle = Demo.make({ Flag: true, Mode: "b", Handler: 7 });
      expect(Demo.is(bundle)).toBe(true);
      expect(Demo.config(bundle)).toEqual({
        Flag: true,
        Mode: "b",
        Handler: 7,
      });
      const got = yield* readDemo.pipe(Effect.provide(bundle));
      expect(got.flag).toBe(true);
      expect(got.mode).toBe("b");
      expect(yield* got.handler).toBe(7);
    }),
  );

  it.effect("layer last-write wins; brands do not cross families", () =>
    Effect.gen(function* () {
      const merged = Demo.make({ Flag: true, Mode: "a" }).pipe(
        Demo.layer(Demo.succeed("Mode", "b")),
        Demo.layer(Demo.succeed("Flag", false)),
      );
      expect(Demo.config(merged)).toEqual({ Flag: false, Mode: "b" });
      const got = yield* readDemo.pipe(Effect.provide(merged));
      expect(got.flag).toBe(false);
      expect(got.mode).toBe("b");

      expect(Demo.is(Policy.sticky)).toBe(false);
      expect(Policy.isPolicy(Demo.succeed("Flag", true))).toBe(false);
      expect(Policy.isPolicy(Policy.sticky)).toBe(true);
      expect(Policy.Family.is(Policy.sticky)).toBe(true);
      expect(Policy.Sticky.key).toBe("hyperlink-ts/Policy/Sticky");
    }),
  );

  it.effect("provide supplies family layers to a dependent Layer", () =>
    Effect.gen(function* () {
      class Out extends Context.Service<
        Out,
        { readonly flag: boolean }
      >()("hyperlink-ts/test/policy-builder.test/Out") {}
      const dependent = Layer.effect(
        Out,
        Effect.gen(function* () {
          return { flag: yield* Flag };
        }),
      );
      const built = dependent.pipe(Demo.provide(Demo.succeed("Flag", true)));
      const got = yield* Out.pipe(Effect.provide(built));
      expect(got.flag).toBe(true);
    }),
  );
});
