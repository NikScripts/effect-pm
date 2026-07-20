import { Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

// C1 — unified Node set: nodes overwrite, andNode append, client(Tag) when size === 1.

class NodeA extends Node.Tag<NodeA>("nodes/A", {
  path: "/tmp/effect-pm-nodes-a.sock",
}) {}
class NodeB extends Node.Tag<NodeB>("nodes/B", {
  path: "/tmp/effect-pm-nodes-b.sock",
}) {}
class NodeC extends Node.Tag<NodeC>("nodes/C", {
  path: "/tmp/effect-pm-nodes-c.sock",
}) {}

const echoImpl = {
  ping: ({ n }: { readonly n: number }) => Effect.succeed(n + 1),
};

describe("Resource.nodes / andNode (C1)", () => {
  it("{ node } ctor sugar stamps set-of-one", () => {
    class Mail extends Resource.Tag<Mail>()(
      "nodes/MailCtor",
      { ping: Resource.effectFn({ n: Schema.Number }, Schema.Number) },
      { node: NodeA },
    ) {}
    expect(Resource.nodesOf(Mail)).toEqual([NodeA]);
    expect(Resource.nodeOf(Mail)).toBe(NodeA);
  });

  it("nodes overwrites; size 1 syncs nodeSym for client(Tag)", () => {
    class Mail extends Resource.Tag<Mail>()("nodes/MailOverwrite", {
      ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Resource.nodes([NodeA, NodeB])) {}

    expect(Resource.nodesOf(Mail)).toHaveLength(2);
    expect(Resource.nodeOf(Mail)).toBeUndefined();

    const stamped = Resource.nodes(Mail, [NodeC]);
    expect(Resource.nodesOf(stamped)).toEqual([NodeC]);
    expect(Resource.nodeOf(stamped)).toBe(NodeC);
  });

  it("andNode appends one", () => {
    class Pool extends Resource.Tag<Pool>()("nodes/Pool", {
      ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Resource.nodes([NodeA])) {}

    const withB = Resource.andNode(Pool, NodeB);
    expect(Resource.nodesOf(withB).map((n) => n.key)).toEqual([
      NodeA.key,
      NodeB.key,
    ]);
    expect(Resource.nodeOf(withB)).toBeUndefined();
  });

  it("distributedOf aliases nodesOf; bare distributed stamps empty set", () => {
    expect(Resource.distributedOf).toBe(Resource.nodesOf);
    class Mail extends Resource.Tag<Mail>()("nodes/MailBare", {
      ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Resource.distributed) {}
    expect(Resource.nodesOf(Mail)).toEqual([]);
    expect(Resource.distributedOf(Mail)).toEqual([]);
  });

  it("identity rejects andNode that would exceed one Node", () => {
    class Solo extends Resource.Tag<Solo>()("nodes/Solo", {
      ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Resource.identity, Resource.nodes([NodeA])) {}

    expect(() => Resource.andNode(Solo, NodeB)).toThrow(
      Resource.IdentityMultiNode,
    );
  });

  it.effect("client dials the sole node after nodes([X])", () =>
    Effect.gen(function* () {
      const path = `/tmp/effect-pm-nodes-client-${process.pid}.sock`;
      class Worker extends Node.Tag<Worker>("nodes/Worker", { path }) {}
      class Ping extends Resource.Tag<Ping>()("nodes/Ping", {
        ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
      }).pipe(Resource.nodes([Worker])) {}

      const serverCtx = yield* Layer.build(
        Node.ipcServer([Resource.serve(Ping, echoImpl)], { path }),
      );
      // Pipe `nodes` does not narrow to NodeBoundTag at the type level — name the node.
      // Addressed Worker → Resource.client auto-wires Node.connect.
      const clientCtx = yield* Layer.build(Resource.client(Ping, Worker));

      const n = yield* Effect.gen(function* () {
        const ping = yield* Ping;
        return yield* ping.ping({ n: 40 });
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(41);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  it.effect("Resource.client(Tag, Worker) auto-connects without Node.connect", () =>
    Effect.gen(function* () {
      const path = `/tmp/effect-pm-nodes-autoconnect-${process.pid}.sock`;
      class Worker extends Node.Tag<Worker>("nodes/AutoWorker", { path }) {}
      class Ping extends Resource.Tag<Ping>()("nodes/AutoPing", {
        ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
      }) {}

      const serverCtx = yield* Layer.build(
        Node.ipcServer([Resource.serve(Ping, echoImpl)], { path }),
      );
      // No Layer.provide(Node.connect(Worker)) — addressed Worker dials itself.
      const clientCtx = yield* Layer.build(Resource.client(Ping, Worker));

      const n = yield* Effect.gen(function* () {
        const ping = yield* Ping;
        return yield* ping.ping({ n: 10 });
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(11);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  it.effect("node-bearing client(Tag) auto-connects when { node } is addressed", () =>
    Effect.gen(function* () {
      const path = `/tmp/effect-pm-nodes-hosted-${process.pid}.sock`;
      class Worker extends Node.Tag<Worker>("nodes/HostedWorker", { path }) {}
      class Ping extends Resource.Tag<Ping>()(
        "nodes/HostedPing",
        { ping: Resource.effectFn({ n: Schema.Number }, Schema.Number) },
        { node: Worker },
      ) {}

      const serverCtx = yield* Layer.build(
        Node.ipcServer([Resource.serve(Ping, echoImpl)], { path }),
      );
      // Ship only the tag — no connect, no 2nd-arg node.
      const clientCtx = yield* Layer.build(Resource.client(Ping));

      const n = yield* Effect.gen(function* () {
        const ping = yield* Ping;
        return yield* ping.ping({ n: 2 });
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(3);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );
});
