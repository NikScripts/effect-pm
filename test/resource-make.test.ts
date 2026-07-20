import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

// `Resource.make(tag, impl)` anchors a HOISTED impl to its contract at the definition site — inline impls
// are already typed by layer/serve, but an extracted const loses that; make infers the tag's spec.
class Svc extends Resource.Tag<Svc>()("make-test/Svc", {
  name: Resource.effect(Schema.String),
  greet: Resource.effectFn(Schema.Struct({ who: Schema.String }), Schema.String),
}) {}

const svcImpl = Resource.make(Svc, {
  name: Effect.succeed("svc-1"),
  greet: ({ who }) => Effect.succeed(`hi ${who}`), // `who` typed from the contract, at the def site
});

// the same anchored impl feeds BOTH the local layer and a served layer (ImplOf ⊇ ServeImplOf, no locals)
void (() => Resource.serve(Svc, svcImpl));

it("Resource.make anchors a reusable impl (used by the local layer)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const p = yield* Svc;
      expect(yield* p.name).toBe("svc-1");
      expect(yield* p.greet({ who: "x" })).toBe("hi x");
    }).pipe(Effect.provide(Resource.layer(Svc, svcImpl)), Effect.scoped),
  ));

it("Resource.make is runtime identity + type-anchored", () => {
  const obj = {
    name: Effect.succeed("y"),
    greet: ({ who }: { readonly who: string }) => Effect.succeed(who),
  };
  expect(Resource.make(Svc, obj)).toBe(obj); // identity

  // @ts-expect-error — `name` must be Effect<string>, not a number
  Resource.make(Svc, { name: 5, greet: () => Effect.succeed("z") });
});

// A SHARED distributed resource is defined node-free (exportable); nodes are supplied at the USE site.
class Fleet extends Resource.Tag<Fleet>()("make-test/Fleet", {
  n: Resource.effect(Schema.Number),
}) {} // no `.distributed([…])`
class NodeA extends Node.Tag<NodeA>("make-test/A") {}
class NodeB extends Node.Tag<NodeB>("make-test/B") {}

it("peersLayer sources the fleet from options.nodes (shared tag has no baked nodes)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const peers = yield* Resource.peers(Fleet);
      // if the fleet weren't read from options.nodes, the tag has none → no peers → undefined.
      expect(peers["make-test/B"]).toBeDefined();
    }).pipe(
      Effect.provide(
        Resource.peersLayer(Fleet, NodeA, {
          nodes: [NodeA, NodeB], // fleet supplied at the use site
          url: () => Effect.succeed("http://127.0.0.1:5999/rpc"), // dead but lazy → no hang
        }),
      ),
      Effect.scoped,
    ),
  ));
