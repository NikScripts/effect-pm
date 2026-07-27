import { Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// C1 — unified Node set: nodes overwrite, andNode append, client(Tag) when size === 1.

class NodeA extends Node.Tag<NodeA>()("nodes/A", {
  path: "/tmp/hyperlink-ts-nodes-a.sock",
}) {}
class NodeB extends Node.Tag<NodeB>()("nodes/B", {
  path: "/tmp/hyperlink-ts-nodes-b.sock",
}) {}
class NodeC extends Node.Tag<NodeC>()("nodes/C", {
  path: "/tmp/hyperlink-ts-nodes-c.sock",
}) {}

const echoImpl = {
  ping: ({ n }: { readonly n: number }) => Effect.succeed(n + 1),
};

describe("Hyperlink.nodes / andNode (C1)", () => {
  it("{ node } ctor sugar stamps set-of-one", () => {
    class Mail extends Hyperlink.Tag<Mail>()(
      "nodes/MailCtor",
      { ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number) },
      { node: NodeA },
    ) {}
    expect(Hyperlink.nodesOf(Mail)).toEqual([NodeA]);
    expect(Hyperlink.nodeOf(Mail)).toBe(NodeA);
  });

  it("nodes overwrites; size 1 syncs nodeSym for client(Tag)", () => {
    class Mail extends Hyperlink.Tag<Mail>()("nodes/MailOverwrite", {
      ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Hyperlink.nodes([NodeA, NodeB])) {}

    expect(Hyperlink.nodesOf(Mail)).toHaveLength(2);
    expect(Hyperlink.nodeOf(Mail)).toBeUndefined();

    const stamped = Hyperlink.nodes(Mail, [NodeC]);
    expect(Hyperlink.nodesOf(stamped)).toEqual([NodeC]);
    expect(Hyperlink.nodeOf(stamped)).toBe(NodeC);
  });

  it("andNode appends one", () => {
    class Pool extends Hyperlink.Tag<Pool>()("nodes/Pool", {
      ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Hyperlink.nodes([NodeA])) {}

    const withB = Hyperlink.andNode(Pool, NodeB);
    expect(Hyperlink.nodesOf(withB).map((n) => n.key)).toEqual([
      NodeA.key,
      NodeB.key,
    ]);
    expect(Hyperlink.nodeOf(withB)).toBeUndefined();
  });

  it("distributedOf aliases nodesOf; bare distributed stamps empty set", () => {
    expect(Hyperlink.distributedOf).toBe(Hyperlink.nodesOf);
    class Mail extends Hyperlink.Tag<Mail>()("nodes/MailBare", {
      ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Hyperlink.distributed) {}
    expect(Hyperlink.nodesOf(Mail)).toEqual([]);
    expect(Hyperlink.distributedOf(Mail)).toEqual([]);
  });

  it("identity rejects andNode that would exceed one Node", () => {
    class Solo extends Hyperlink.Tag<Solo>()("nodes/Solo", {
      ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Hyperlink.identity, Hyperlink.nodes([NodeA])) {}

    expect(() => Hyperlink.andNode(Solo, NodeB)).toThrow(
      Hyperlink.IdentityMultiNode,
    );
  });

  it.live("client dials the sole node after nodes([X])", () =>
    Effect.gen(function* () {
      const path = `/tmp/hyperlink-ts-nodes-client-${process.pid}.sock`;
      class Worker extends Node.Tag<Worker>()("nodes/Worker", { path }) {}
      class Ping extends Hyperlink.Tag<Ping>()("nodes/Ping", {
        ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
      }).pipe(Hyperlink.nodes([Worker])) {}

      const serverCtx = yield* Layer.build(
        Node.ipcServer([Hyperlink.serve(Ping, echoImpl)], { path }),
      );
      // Size-1 `nodes([Worker])` sole-binds — client(Tag) auto-connects.
      const clientCtx = yield* Layer.build(Hyperlink.client(Ping));

      const n = yield* Effect.gen(function* () {
        const ping = yield* Ping;
        return yield* ping.ping({ n: 40 });
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(41);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  it.live("client dials the sole node after andNode(X) from empty", () =>
    Effect.gen(function* () {
      const path = `/tmp/hyperlink-ts-nodes-andnode-${process.pid}.sock`;
      class Worker extends Node.Tag<Worker>()("nodes/AndWorker", { path }) {}
      class Ping extends Hyperlink.Tag<Ping>()("nodes/AndPing", {
        ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
      }).pipe(Hyperlink.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.ipcServer([Hyperlink.serve(Ping, echoImpl)], { path }),
      );
      const clientCtx = yield* Layer.build(Hyperlink.client(Ping));

      const n = yield* Effect.gen(function* () {
        const ping = yield* Ping;
        return yield* ping.ping({ n: 7 });
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(8);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  it.live("Hyperlink.client(Tag, Worker) auto-connects without Node.connect", () =>
    Effect.gen(function* () {
      const path = `/tmp/hyperlink-ts-nodes-autoconnect-${process.pid}.sock`;
      class Worker extends Node.Tag<Worker>()("nodes/AutoWorker", { path }) {}
      class Ping extends Hyperlink.Tag<Ping>()("nodes/AutoPing", {
        ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
      }) {}

      const serverCtx = yield* Layer.build(
        Node.ipcServer([Hyperlink.serve(Ping, echoImpl)], { path }),
      );
      // No Layer.provide(Node.connect(Worker)) — addressed Worker dials itself.
      const clientCtx = yield* Layer.build(Hyperlink.client(Ping, Worker));

      const n = yield* Effect.gen(function* () {
        const ping = yield* Ping;
        return yield* ping.ping({ n: 10 });
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(11);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  it.live("node-bearing client(Tag) auto-connects when { node } is addressed", () =>
    Effect.gen(function* () {
      const path = `/tmp/hyperlink-ts-nodes-hosted-${process.pid}.sock`;
      class Worker extends Node.Tag<Worker>()("nodes/HostedWorker", { path }) {}
      class Ping extends Hyperlink.Tag<Ping>()(
        "nodes/HostedPing",
        { ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number) },
        { node: Worker },
      ) {}

      const serverCtx = yield* Layer.build(
        Node.ipcServer([Hyperlink.serve(Ping, echoImpl)], { path }),
      );
      // Ship only the tag — no connect, no 2nd-arg node.
      const clientCtx = yield* Layer.build(Hyperlink.client(Ping));

      const n = yield* Effect.gen(function* () {
        const ping = yield* Ping;
        return yield* ping.ping({ n: 2 });
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(3);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );
});
