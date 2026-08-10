/**
 * PolicyBuilder — Schema keys; callable PascalCase handles.
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

const Flag = Demo.Flag;
const Mode = Demo.Mode;
const Handler = Demo.Handler;

const readDemo = Effect.gen(function* () {
  return {
    flag: yield* Flag,
    mode: yield* Mode,
    handler: yield* Handler,
  };
});

describe("PolicyBuilder", () => {
  it.effect("class extends make+key; bag + handle Layers stamp decoded config", () =>
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

      const fromHandles = Demo.layer(Flag(true), Mode("b"), Handler(7));
      expect(Demo.config(fromHandles)).toEqual({
        Flag: true,
        Mode: "b",
        Handler: 7,
      });
      const gotHandles = yield* readDemo.pipe(Effect.provide(fromHandles));
      expect(gotHandles.flag).toBe(true);
      expect(gotHandles.mode).toBe("b");
      expect(yield* gotHandles.handler).toBe(7);

      const fromFrags = Demo.make(Demo.$fromConfig({ Flag: true, Mode: "b", Handler: 7 }));
      expect(Demo.config(fromFrags)).toEqual({
        Flag: true,
        Mode: "b",
        Handler: 7,
      });
    }),
  );

  it.effect("handle is Reference + Layer; $is/$match/$fromConfig/$toConfig", () =>
    Effect.gen(function* () {
      const layer = Flag(true);
      expect(Demo.is(layer)).toBe(true);
      expect(Demo.config(layer)).toEqual({ Flag: true });
      expect(Flag.key).toBe("policy-builder-test/Demo/Flag");
      expect(yield* Flag).toBe(false); // Reference default

      const frag = { _tag: "Flag" as const, value: true };
      expect(Demo.$is("Flag")(frag)).toBe(true);
      expect(Demo.$is("Mode")(frag)).toBe(false);
      const label = Demo.$match(frag, {
        Flag: (x) => `flag:${x.value}`,
        Mode: (x) => `mode:${x.value}`,
        Handler: (x) => `handler:${x.value}`,
      });
      expect(label).toBe("flag:true");
      const bag = { Flag: false as const, Mode: "b" as const };
      expect(Demo.$fromConfig(bag)).toEqual([
        { _tag: "Flag", value: false },
        { _tag: "Mode", value: "b" },
      ]);
      expect(
        Demo.$toConfig([
          { _tag: "Flag", value: true },
          { _tag: "Mode", value: "a" },
        ]),
      ).toEqual({ Flag: true, Mode: "a" });

      const merged = Demo.make({ Flag: true, Mode: "a" }).pipe(
        Demo.layer(Mode("b")),
        Demo.layer(Flag(false)),
      );
      expect(Demo.config(merged)).toEqual({ Flag: false, Mode: "b" });
      const got = yield* readDemo.pipe(Effect.provide(merged));
      expect(got.flag).toBe(false);
      expect(got.mode).toBe("b");

      expect(Demo.is(Policy.Sticky(true))).toBe(false);
      expect(Policy.isPolicy(Flag(true))).toBe(false);
      expect(Policy.isPolicy(Policy.Sticky(true))).toBe(true);
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
      const built = dependent.pipe(Demo.provide(Flag(true)));
      const got = yield* Out.pipe(Effect.provide(built));
      expect(got.flag).toBe(true);
    }),
  );
});
