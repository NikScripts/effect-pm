import { Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

describe("InvalidHttpTarget (Layer / Effect channel)", () => {
  it.effect("clientHttp fails the Layer with InvalidHttpTarget — no sync throw", () =>
    Effect.gen(function* () {
      class Ping extends Resource.Tag<Ping>()("iht/Ping", {
        ping: Resource.effect(Schema.String),
      }) {}
      // Building the layer value must not throw.
      const layer = Resource.clientHttp(Ping, "not-a-valid-target");
      const exit = yield* Effect.exit(Layer.build(layer).pipe(Effect.scoped));
      expectTaggedFailure(exit, "InvalidHttpTarget");
    }),
  );

  it.effect("positional Tag bad string stamps InvalidHttpTarget for derived connect", () =>
    Effect.gen(function* () {
      // Loose string overload — runtime leaves the node unaddressed + stamps the error.
      class Bad extends Node.Tag<Bad>("iht/Bad", "ftp://nope") {}
      expect(Bad.url).toBeUndefined();
      expect(Bad.kind).toBeUndefined();
      expect(Node.isAddressedNode(Bad)).toBe(false);

      const layer = Node.connect(
        Bad as unknown as Node.AddressedNode<Bad>,
      );
      const exit = yield* Effect.exit(Layer.build(layer).pipe(Effect.scoped));
      expectTaggedFailure(exit, "InvalidHttpTarget");
    }),
  );

  it("valid port / url targets still resolve without error", () => {
    class Port extends Node.Tag<Port>("iht/Port", 3001) {}
    class Url extends Node.Tag<Url>("iht/Url", "https://mail.internal/rpc") {}
    expect(Port.url).toBe("http://localhost:3001/rpc");
    expect(Port.kind).toBe("Http");
    expect(Url.url).toBe("https://mail.internal/rpc");
    expect(Url.kind).toBe("Http");
  });
});
