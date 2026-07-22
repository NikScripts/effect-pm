import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { QueueHyperlink } from "../src";
import * as Node from "../src/Node";

// A served node exposes a plain HTTP `/health` readiness route alongside `/rpc` — so a dumb probe
// (deploy gate, load balancer) gets a status code, and the JSON body lists the node's resources.
const Item = Schema.Struct({ n: Schema.Number });
class HealthNode extends Node.Tag<HealthNode>()("health/node") {}
class HealthQueue extends QueueHyperlink.Tag<HealthQueue>()("health/Q", { payload: Item, node: HealthNode }) {}

const Server = Node.httpServer([
  QueueHyperlink.serveMemory(HealthQueue, { effect: (_i: { n: number }) => Effect.void }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("httpServer mounts a /health readiness route (200 + resource roster)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      yield* Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const res = yield* client.get(`http://127.0.0.1:${port}/health`);
        expect(res.status).toBe(200);
        const body = yield* res.text;
        expect(body).toContain('"status":"ok"');
        expect(body).toContain("health/Q"); // the served resource is in the roster
      }).pipe(Effect.provide(FetchHttpClient.layer), Effect.scoped);
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));
