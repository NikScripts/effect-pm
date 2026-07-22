import { Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import * as Resource from "../src/Resource";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// Loud-failures §4.1 — nodeless `client(tag)` without ambient RpcClient.Protocol fails as
// `MissingClientProtocol` (remediation message), not Effect's opaque "Service not found" die.
class Probe extends Resource.Tag<Probe>()("missing-protocol/Probe", {
  ping: Resource.effect(Schema.String),
}) {}

const Proc = Resource.tagFor("missing-protocol/proc", {
  ping: Resource.effect(Schema.String),
});
class P1 extends Proc<P1>("missing-protocol/p1") {}

describe("Resource.MissingClientProtocol", () => {
  it.effect("client(tag) without Protocol fails MissingClientProtocol", () =>
    Effect.gen(function* () {
      // Cast away `R = RpcClient.Protocol` so we can Layer.build with an empty context and
      // exercise the runtime serviceOption backstop (compile-time still requires Protocol).
      // E stays `never` on the public type (replaces a die); runtime Exit carries the tagged error.
      const layer = Resource.client(Probe) as Layer.Layer<Probe>;
      const exit = yield* Effect.exit(Layer.build(layer).pipe(Effect.scoped));
      expectTaggedFailure(exit, "MissingClientProtocol");
    }),
  );

  it.effect("clientInstances without Protocol fails MissingClientProtocol", () =>
    Effect.gen(function* () {
      const layer = Resource.clientInstances(Proc, P1) as Layer.Layer<P1>;
      const exit = yield* Effect.exit(Layer.build(layer).pipe(Effect.scoped));
      expectTaggedFailure(exit, "MissingClientProtocol");
    }),
  );
});
