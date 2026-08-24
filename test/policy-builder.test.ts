/**
 * PolicyBuilder — Schema keys; PascalCase refs; camelCase Layer methods.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as PolicyBuilder from "../src/PolicyBuilder";
import * as LookupPolicy from "../src/LookupPolicy";

const modeSchema = Schema.Literals(["a", "b"]);

class DemoPolicies extends PolicyBuilder.make("policy-builder-test/Demo")
  .key("Flag", Schema.Boolean, { defaultValue: () => false })
  .key("Mode", modeSchema, {
    defaultValue: (): Schema.Schema.Type<typeof modeSchema> => "a",
  })
  .key("Handler", Schema.Number, {
    defaultValue: (): Effect.Effect<number> => Effect.succeed(0),
    toRuntime: (n: number) => Effect.succeed(n),
  }) {}

const Flag = DemoPolicies.Flag;
const Mode = DemoPolicies.Mode;
const Handler = DemoPolicies.Handler;

const readDemo = Effect.gen(function* () {
  return {
    flag: yield* Flag,
    mode: yield* Mode,
    handler: yield* Handler,
  };
});

describe("PolicyBuilder", () => {
  it.effect("class DemoPolicies extends make+key; bag + succeed stamp decoded config", () =>
    Effect.gen(function* () {
      const bundle = DemoPolicies.make({ Flag: true, Mode: "b", Handler: 7 });
      expect(DemoPolicies.is(bundle)).toBe(true);
      expect(DemoPolicies.config(bundle)).toEqual({
        Flag: true,
        Mode: "b",
        Handler: 7,
      });
      const got = yield* readDemo.pipe(Effect.provide(bundle));
      expect(got.flag).toBe(true);
      expect(got.mode).toBe("b");
      expect(yield* got.handler).toBe(7);

      const fromFrags = DemoPolicies.make(
        DemoPolicies.fromConfig({ Flag: true, Mode: "b", Handler: 7 }),
      );
      expect(DemoPolicies.config(fromFrags)).toEqual({
        Flag: true,
        Mode: "b",
        Handler: 7,
      });
    }),
  );

  it.effect("PascalCase refs + camelCase methods; fragment matchers; brands do not cross", () =>
    Effect.gen(function* () {
      expect(Flag.key).toBe("policy-builder-test/Demo/Flag");
      expect(yield* Flag).toBe(false); // Reference default

      // Tag string "Flag" → method flag; "Mode" → mode
      const viaMethod = DemoPolicies.flag(true).pipe(
        DemoPolicies.layer(DemoPolicies.mode("b")),
      );
      expect(DemoPolicies.config(viaMethod)).toEqual({ Flag: true, Mode: "b" });

      const frag = { _tag: "Flag" as const, value: true };
      expect(DemoPolicies.isFragment("Flag")(frag)).toBe(true);
      expect(DemoPolicies.isFragment("Mode")(frag)).toBe(false);
      const label = DemoPolicies.matchFragment(frag, {
        Flag: (x) => `flag:${x.value}`,
        Mode: (x) => `mode:${x.value}`,
        Handler: (x) => `handler:${x.value}`,
      });
      expect(label).toBe("flag:true");
      expect(DemoPolicies.fromConfig({ Flag: false, Mode: "b" })).toEqual([
        { _tag: "Flag", value: false },
        { _tag: "Mode", value: "b" },
      ]);
      expect(
        DemoPolicies.toConfig([
          { _tag: "Flag", value: true },
          { _tag: "Mode", value: "a" },
        ]),
      ).toEqual({ Flag: true, Mode: "a" });

      const merged = DemoPolicies.make({ Flag: true, Mode: "a" }).pipe(
        DemoPolicies.layer(DemoPolicies.mode("b")),
        DemoPolicies.layer(DemoPolicies.flag(false)),
      );
      expect(DemoPolicies.config(merged)).toEqual({ Flag: false, Mode: "b" });
      const got = yield* readDemo.pipe(Effect.provide(merged));
      expect(got.flag).toBe(false);
      expect(got.mode).toBe("b");

      expect(DemoPolicies.is(LookupPolicy.sticky)).toBe(false);
      expect(LookupPolicy.isPolicy(DemoPolicies.flag(true))).toBe(false);
      expect(LookupPolicy.isPolicy(LookupPolicy.sticky)).toBe(true);
      expect(LookupPolicy.Sticky.key).toBe("hyperlink-ts/LookupPolicy/Sticky");
      expect(yield* LookupPolicy.Sticky).toBe(true);
      expect(yield* LookupPolicy.Verify).toBe("reject");
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
      const built = dependent.pipe(DemoPolicies.provide(DemoPolicies.flag(true)));
      const got = yield* Out.pipe(Effect.provide(built));
      expect(got.flag).toBe(true);
    }),
  );
});
