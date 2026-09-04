import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// `Hyperlink.make(tag, impl)` anchors a HOISTED impl to its contract at the definition site — inline impls
// are already typed by layer/serve, but an extracted const loses that; make infers the tag's spec.
class Svc extends Hyperlink.Service<Svc>()("make-test/Svc", {
  name: Hyperlink.effect(Schema.String),
  greet: Hyperlink.effectFn(Schema.Struct({ who: Schema.String }), Schema.String),
}) {}

const svcImpl = Hyperlink.make(Svc, {
  name: Effect.succeed("svc-1"),
  greet: ({ who }) => Effect.succeed(`hi ${who}`), // `who` typed from the contract, at the def site
});

// the same anchored impl feeds BOTH the local layer and a served layer (ImplOf ⊇ ServeImplOf, no locals)
void (() => Hyperlink.serve(Svc, svcImpl));

it("Hyperlink.make anchors a reusable impl (used by the local layer)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const p = yield* Svc;
      expect(yield* p.name).toBe("svc-1");
      expect(yield* p.greet({ who: "x" })).toBe("hi x");
    }).pipe(Effect.provide(Hyperlink.layer(Svc, svcImpl)), Effect.scoped),
  ));

it("Hyperlink.make is runtime identity + type-anchored", () => {
  const obj = {
    name: Effect.succeed("y"),
    greet: ({ who }: { readonly who: string }) => Effect.succeed(who),
  };
  expect(Hyperlink.make(Svc, obj)).toBe(obj); // identity

  // @ts-expect-error — `name` must be Effect<string>, not a number
  Hyperlink.make(Svc, { name: 5, greet: () => Effect.succeed("z") });
});

// A SHARED distributed resource is defined node-free (exportable); nodes are supplied at the USE site.
class Fleet extends Hyperlink.Service<Fleet>()("make-test/Fleet", {
  n: Hyperlink.effect(Schema.Number),
}) {} // no `.distributed([…])`
class NodeA extends Node.Service<NodeA>()("make-test/A") {}
class NodeB extends Node.Service<NodeB>()("make-test/B") {}

it("peersLayer sources the fleet from options.nodes (shared tag has no baked nodes)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const peers = yield* Hyperlink.peers(Fleet);
      // if the fleet weren't read from options.nodes, the tag has none → no peers → undefined.
      expect(peers["make-test/B"]).toBeDefined();
    }).pipe(
      Effect.provide(
        Hyperlink.peersLayer(Fleet, NodeA, {
          nodes: [NodeA, NodeB], // fleet supplied at the use site
          url: () => Effect.succeed("http://127.0.0.1:5999/rpc"), // dead but lazy → no hang
        }),
      ),
      Effect.scoped,
    ),
  ));
