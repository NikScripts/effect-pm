/**
 * PolicyBuilder — shared family kernel (define / make / layer / succeed / is).
 */
import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as PolicyBuilder from "../src/PolicyBuilder";
import * as Policy from "../src/Policy";

const Flag = Context.Reference<boolean>("policy-builder-test/Flag", {
  defaultValue: (): boolean => false,
});

const Mode = Context.Reference<"a" | "b">("policy-builder-test/Mode", {
  defaultValue: (): "a" => "a",
});

const Handler = Context.Reference<Effect.Effect<number>>(
  "policy-builder-test/Handler",
  {
    defaultValue: (): Effect.Effect<number> => Effect.succeed(0),
  },
);

const Demo = PolicyBuilder.define({
  id: "policy-builder-test/Demo",
  keys: {
    Flag: PolicyBuilder.key(Flag),
    Mode: PolicyBuilder.key(Mode),
    Handler: PolicyBuilder.keyEncoded(
      Handler,
      (input: number | Effect.Effect<number>) =>
        typeof input === "number" ? Effect.succeed(input) : input,
    ),
  },
});

const readDemo = Effect.gen(function* () {
  return {
    flag: yield* Flag,
    mode: yield* Mode,
    handler: yield* Handler,
  };
});

describe("PolicyBuilder family", () => {
  it.effect("make + succeed set refs; config stamps inputs", () =>
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

      // Eng’d Policy family uses a different brand id
      expect(Demo.is(Policy.sticky)).toBe(false);
      expect(Policy.isPolicy(Demo.succeed("Flag", true))).toBe(false);
      expect(Policy.isPolicy(Policy.sticky)).toBe(true);
    }),
  );

  it.effect("provide supplies family layers to a dependent Layer", () =>
    Effect.gen(function* () {
      // Same shape as Policy.provide(cutover)(lookupClient): dependent requires Flag.
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
