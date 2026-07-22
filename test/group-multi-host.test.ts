import { Context, Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Group from "../src/Group";
import * as Node from "../src/Node";

// The payoff of killing ProcessManager: a `Group.Tag` is pure organization, and each member tag
// independently resolves its OWN node. Here one group holds two members bound to two DIFFERENT
// nodes (two real http servers); driving them through the group accessors connects each to its
// own node — no central registry, no middleman.
class NodeA extends Node.Tag<NodeA>()("multi/nodeA") {}
class NodeB extends Node.Tag<NodeB>()("multi/nodeB") {}

class Alpha extends Hyperlink.Tag<Alpha>()("multi/Alpha", 
  { where: Hyperlink.effect(Schema.String) },
  { node: NodeA },
) {}
class Beta extends Hyperlink.Tag<Beta>()("multi/Beta", 
  { where: Hyperlink.effect(Schema.String) },
  { node: NodeB },
) {}

// one group, members on different nodes (could just as easily be same node)
class Cluster extends Group.Tag<Cluster>("multi/Cluster")({ Alpha, Beta }) {}

const AlphaServer = Node.httpServer([
  Hyperlink.serve(Alpha, {
    where: Effect.succeed("alpha@nodeA"),
  }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
const BetaServer = Node.httpServer([
  Hyperlink.serve(Beta, {
    where: Effect.succeed("beta@nodeB"),
  }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const portOf = (ctx: Context.Context<HttpServer.HttpServer>): number => {
  const address = Context.get(ctx, HttpServer.HttpServer).address;
  return address._tag === "TcpAddress" ? address.port : 0;
};

it("a group's members each resolve their own node (mixed nodes, one group)", () =>
  Effect.runPromise(
    // Build each server in its OWN isolated context (separate HttpRouter per server), both alive
    // in the same scope, then drive both through the group.
    Effect.gen(function* () {
      const portA = portOf(yield* Layer.build(AlphaServer));
      const portB = portOf(yield* Layer.build(BetaServer));

      const clients = Layer.mergeAll(
        Hyperlink.client(Cluster.Alpha).pipe(
          Layer.provide(
            Hyperlink.http(NodeA, {
              url: `http://127.0.0.1:${portA}/rpc`,
            }),
          ),
        ),
        Hyperlink.client(Cluster.Beta).pipe(
          Layer.provide(
            Hyperlink.http(NodeB, {
              url: `http://127.0.0.1:${portB}/rpc`,
            }),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        // reached purely through the group — each goes to its own node
        const a = yield* Cluster.Alpha;
        const b = yield* Cluster.Beta;
        expect(yield* a.where).toBe("alpha@nodeA");
        expect(yield* b.where).toBe("beta@nodeB");
      }).pipe(Effect.provide(clients), Effect.scoped);
    }).pipe(Effect.scoped),
  ));
