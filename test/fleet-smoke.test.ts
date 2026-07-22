import { Duration, Effect, Layer, Option, Schema, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { QueueHyperlink } from "../src";
import * as NodeStatus from "../src/NodeStatus";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// Headless smoke of the dashboard's live data path — over WebSocket, the transport a browser dashboard
// actually uses. A node serves two queues; a producer (a client, the sanctioned way) enqueues over the
// wire; and we assert the three things that were each silently broken at some point:
//   1. the queue actually drains (producer → server → processing crosses the ws), and
//   2. NodeStatus reports the node up with the right resource count, and
//   3. the NodeStatus change stream delivers a live snapshot.
// A protocol/wiring regression on any of these turns this red instead of shipping a blank dashboard.
// (Single node: two in-process servers collide on the shared HttpServer tag; multi-node peer
// aggregation is covered by multi-host.test.ts.)

const Job = Schema.Struct({ id: Schema.String });
interface Job {
  readonly id: string;
}
class Mail extends QueueHyperlink.Tag<Mail>()("smoke/Mail", { payload: Job }) {}
class Jobs extends QueueHyperlink.Tag<Jobs>()("smoke/Jobs", { payload: Job }) {}

const server = Node.wsServer([
  QueueHyperlink.serveMemory(Mail, { effect: () => Effect.void }),
  QueueHyperlink.serveMemory(Jobs, { effect: () => Effect.void }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("fleet data-path smoke (ws): a producer feeds queues and NodeStatus reports ready", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = address._tag === "TcpAddress" ? address.port : 0;
      const wire = Hyperlink.protocolWebsocket(`ws://127.0.0.1:${port}/rpc`);

      yield* Effect.gen(function* () {
        const mail = yield* Mail;
        const node = yield* NodeStatus.Tag;

        // 1. producer → the queue drains over the wire.
        const completed: number[] = [];
        yield* Stream.runForEach(mail.status.changes, (s) =>
          Effect.sync(() => completed.push(s.completed)),
        ).pipe(Effect.forkScoped);
        yield* Effect.sleep("200 millis");
        yield* mail.add({ id: "a" });
        yield* mail.add({ id: "b" });
        yield* mail.add({ id: "c" });
        yield* Effect.sleep("500 millis");
        expect(completed.at(-1) ?? 0).toBeGreaterThan(0);

        // 2. NodeStatus reports the node up with both queues.
        const snap = yield* node.status.get;
        expect(snap.up).toBe(true);
        expect(snap.resourceCount).toBe(2);

        // 3. the live NodeStatus stream delivers a snapshot.
        const head = yield* Stream.runHead(node.status.changes);
        expect(Option.isSome(head)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Hyperlink.client(Mail).pipe(Layer.provide(wire)),
            Hyperlink.client(NodeStatus.Tag).pipe(Layer.provide(wire)),
          ),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(server), Effect.scoped, Effect.timeout(Duration.seconds(10))),
  ));
