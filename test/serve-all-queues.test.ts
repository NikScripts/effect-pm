import { Effect, Layer, Schema, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { QueueResource } from "../src";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

// Two REAL queue engines bound to ONE Node, served on ONE port via httpServer + QueueResource.serve —
// the ControlService.make({ group, port }) replacement for wow's per-league deploy.
const Item = Schema.Struct({ n: Schema.Number });
class LeagueNode extends Node.Tag<LeagueNode>("serveAllQ/node") {}
class QA extends QueueResource.Tag<QA>()("serveAllQ/A", { payload: Item, node: LeagueNode }) {}
class QB extends QueueResource.Tag<QB>()("serveAllQ/B", { payload: Item, node: LeagueNode }) {}

const Server = Node.httpServer([
  QueueResource.serveMemory(QA, { effect: (_i: { n: number }) => Effect.void }),
  QueueResource.serveMemory(QB, { effect: (_i: { n: number }) => Effect.void }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("two real queues on one node/port via httpServer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const transport = Resource.httpClient(LeagueNode, { url: `http://127.0.0.1:${port}/rpc` });
      yield* Effect.gen(function* () {
        const a = yield* QA;
        const b = yield* QB;
        yield* a.add({ n: 1 });
        yield* b.add([{ n: 2 }, { n: 3 }]);
        // the live status `value` is observed via its delta stream (client-side, over the wire).
        const waitCompleted = (q: typeof a, n: number) =>
          Stream.runHead(
            Stream.filter(
              q.status.changes,
              (s) => s.completed >= n,
            ),
          );
        const aDone = yield* waitCompleted(a, 1);
        const bDone = yield* waitCompleted(b, 2);
        expect(aDone._tag === "Some" && aDone.value.completed >= 1).toBe(true);
        expect(bDone._tag === "Some" && bDone.value.completed >= 2).toBe(true);
      }).pipe(
        Effect.provide(Layer.mergeAll(
          Resource.client(QA).pipe(Layer.provide(transport)),
          Resource.client(QB).pipe(Layer.provide(transport)),
        )),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));
