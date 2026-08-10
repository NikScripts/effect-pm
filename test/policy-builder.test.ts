/**
 * PolicyBuilder — Schema keys; References on Def; module recreates Layer helpers.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as PolicyBuilder from "../src/PolicyBuilder";
import * as Policy from "../src/Policy";

const modeSchema = Schema.Literals(["a", "b"]);

class Keys extends PolicyBuilder.make("policy-builder-test/Demo")
  .key("Flag", Schema.Boolean, { defaultValue: () => false })
  .key("Mode", modeSchema, {
    defaultValue: (): Schema.Schema.Type<typeof modeSchema> => "a",
  })
  .key("Handler", Schema.Number, {
    defaultValue: (): Effect.Effect<number> => Effect.succeed(0),
    toRuntime: (n: number) => Effect.succeed(n),
  }) {}

const Flag = Keys.Flag;
const Mode = Keys.Mode;
const Handler = Keys.Handler;

const readDemo = Effect.gen(function* () {
  return {
    flag: yield* Flag,
    mode: yield* Mode,
    handler: yield* Handler,
  };
});

describe("PolicyBuilder", () => {
  it.effect("class Keys extends make+key; bag + succeed stamp decoded config", () =>
    Effect.gen(function* () {
      const bundle = Keys.make({ Flag: true, Mode: "b", Handler: 7 });
      expect(Keys.is(bundle)).toBe(true);
      expect(Keys.config(bundle)).toEqual({
        Flag: true,
        Mode: "b",
        Handler: 7,
      });
      const got = yield* readDemo.pipe(Effect.provide(bundle));
      expect(got.flag).toBe(true);
      expect(got.mode).toBe("b");
      expect(yield* got.handler).toBe(7);

      const fromFrags = Keys.make(
        Keys.$fromConfig({ Flag: true, Mode: "b", Handler: 7 }),
      );
      expect(Keys.config(fromFrags)).toEqual({
        Flag: true,
        Mode: "b",
        Handler: 7,
      });
    }),
  );

  it.effect("References + $is/$match; layer last-write; brands do not cross", () =>
    Effect.gen(function* () {
      expect(Flag.key).toBe("policy-builder-test/Demo/Flag");
      expect(yield* Flag).toBe(false); // Reference default

      const frag = { _tag: "Flag" as const, value: true };
      expect(Keys.$is("Flag")(frag)).toBe(true);
      expect(Keys.$is("Mode")(frag)).toBe(false);
      const label = Keys.$match(frag, {
        Flag: (x) => `flag:${x.value}`,
        Mode: (x) => `mode:${x.value}`,
        Handler: (x) => `handler:${x.value}`,
      });
      expect(label).toBe("flag:true");
      expect(Keys.$fromConfig({ Flag: false, Mode: "b" })).toEqual([
        { _tag: "Flag", value: false },
        { _tag: "Mode", value: "b" },
      ]);
      expect(
        Keys.$toConfig([
          { _tag: "Flag", value: true },
          { _tag: "Mode", value: "a" },
        ]),
      ).toEqual({ Flag: true, Mode: "a" });

      const merged = Keys.make({ Flag: true, Mode: "a" }).pipe(
        Keys.layer(Keys.succeed({ _tag: "Mode", value: "b" })),
        Keys.layer(Keys.succeed({ _tag: "Flag", value: false })),
      );
      expect(Keys.config(merged)).toEqual({ Flag: false, Mode: "b" });
      const got = yield* readDemo.pipe(Effect.provide(merged));
      expect(got.flag).toBe(false);
      expect(got.mode).toBe("b");

      expect(Keys.is(Policy.sticky)).toBe(false);
      expect(
        Policy.isPolicy(Keys.succeed({ _tag: "Flag", value: true })),
      ).toBe(false);
      expect(Policy.isPolicy(Policy.sticky)).toBe(true);
      expect(Policy.Sticky.key).toBe("hyperlink-ts/Policy/Sticky");
      expect(yield* Policy.Sticky).toBe(true);
      expect(yield* Policy.Verify).toBe("reject");
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
      const built = dependent.pipe(
        Keys.provide(Keys.succeed({ _tag: "Flag", value: true })),
      );
      const got = yield* Out.pipe(Effect.provide(built));
      expect(got.flag).toBe(true);
    }),
  );
});
