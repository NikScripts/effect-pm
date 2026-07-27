import { Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import * as Hyperlink from "../src/Hyperlink";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// Loud-failures §4.1 — nodeless `client(tag)` without ambient RpcClient.Protocol fails as
// `MissingClientProtocol` (remediation message), not Effect's opaque "Service not found" die.
class Probe extends Hyperlink.Tag<Probe>()("missing-protocol/Probe", {
  ping: Hyperlink.effect(Schema.String),
}) {}

describe("Hyperlink.MissingClientProtocol", () => {
  it.effect("client(tag) without Protocol fails MissingClientProtocol", () =>
    Effect.gen(function* () {
      // Cast away `R = RpcClient.Protocol` so we can Layer.build with an empty context and
      // exercise the runtime serviceOption backstop (compile-time still requires Protocol).
      // E stays `never` on the public type (replaces a die); runtime Exit carries the tagged error.
      const layer = Hyperlink.client(Probe) as Layer.Layer<Probe>;
      const exit = yield* Effect.exit(Layer.build(layer).pipe(Effect.scoped));
      expectTaggedFailure(exit, "MissingClientProtocol");
    }),
  );
});
