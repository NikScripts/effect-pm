import { Effect, Schema } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import { hashContract } from "../src/internal/contractHash";

class Files extends Hyperlink.Service<Files>()("deprecated/Files", {
  move: Hyperlink.effectFn({
    payload: Schema.Struct({ from: Schema.String, to: Schema.String }),
    success: Schema.Void,
  }),
  rename: Hyperlink.effectFn({
    payload: Schema.Struct({ from: Schema.String, to: Schema.String }),
    success: Schema.Void,
  }).pipe(Hyperlink.deprecated),
}) {}

describe("Hyperlink.deprecated", () => {
  it("omits deprecated members from the local Handle; impl still required", () => {
    const program = Effect.gen(function* () {
      const files = yield* Files;
      expect(Object.hasOwn(files, "move")).toBe(true);
      expect(Object.hasOwn(files, "rename")).toBe(false);
      yield* files.move({ from: "a", to: "b" });
    }).pipe(
      Effect.provide(
        Hyperlink.layer(Files, {
          move: () => Effect.void,
          rename: () => Effect.void,
        }),
      ),
      Effect.scoped,
    );
    return Effect.runPromise(program);
  });

  it("keeps contractHash stable when branding an existing wire method", () => {
    const kind = Hyperlink.kindOf(Files) ?? "hyperlink";
    const live = Files[Hyperlink.specSym];
    const unbranded = {
      move: live.move!,
      rename: Hyperlink.effectFn({
        payload: Schema.Struct({ from: Schema.String, to: Schema.String }),
        success: Schema.Void,
      }),
    };
    expect(hashContract(Files.key, kind, live)).toBe(
      hashContract(Files.key, kind, unbranded),
    );
  });

  it("keeps deprecated methods on the RpcGroup for old clients", () => {
    let renamed = 0;
    const program = Effect.gen(function* () {
      const rpc = yield* RpcTest.makeClient(Hyperlink.groupOf(Files));
      const wire = Hyperlink.forwardClient(
        rpc,
        Hyperlink.specOf(Files),
        Hyperlink.wireKeyOf(Files),
        Files.key,
      );
      yield* (
        wire as unknown as {
          readonly rename: (p: {
            readonly from: string;
            readonly to: string;
          }) => Effect.Effect<void>;
        }
      ).rename({ from: "old", to: "new" });
      expect(renamed).toBe(1);
    }).pipe(
      Effect.provide(
        Hyperlink.serveRemote(Files, {
          move: () => Effect.void,
          rename: () =>
            Effect.sync(() => {
              renamed += 1;
            }),
        }),
      ),
      Effect.scoped,
    );
    return Effect.runPromise(program);
  });

  it("dual data-first matches pipe branding", () => {
    const base = Hyperlink.effect(Schema.Void);
    const viaPipe = base.pipe(Hyperlink.deprecated);
    const viaDual = Hyperlink.deprecated(base);
    expect(viaPipe.method).toBe(base);
    expect(viaDual.method).toBe(base);
  });
});
