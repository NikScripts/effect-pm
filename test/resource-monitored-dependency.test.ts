import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

const DbStatus = Schema.Struct({
  connected: Schema.Boolean,
  latencyMs: Schema.Number,
});

const { spec, readiness } = Resource.monitoredDependency({
  status: DbStatus,
  changes: DbStatus,
  readyWhen: (s) => s.connected,
  detail: (s) => (s.connected ? `${s.latencyMs}ms` : "disconnected"),
});

class Database extends Resource.withReadiness(
  Resource.Tag<Database>()("monitored/Database", spec),
  readiness,
) {}

const Server = Node.httpServer([
  Resource.serve(Database, {
    status: Effect.succeed({ connected: false, latencyMs: 0 }),
    changes: Stream.empty,
  }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const withPort = <A, E, R>(
  use: (port: number) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | HttpServer.HttpServer> =>
  Effect.gen(function* () {
    const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
    return yield* use(addr._tag === "TcpAddress" ? addr.port : 0);
  });

describe("Resource.monitoredDependency", () => {
  it.effect("wires status + changes + readiness into /health", () =>
    withPort((port) =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const res = yield* client.get(`http://127.0.0.1:${port}/health`);
        expect(res.status).toBe(503);
        const body = yield* res.text;
        expect(body).toContain('"ready":false');
        expect(body).toContain("disconnected");
      }).pipe(Effect.provide(FetchHttpClient.layer), Effect.scoped),
    ).pipe(Effect.provide(Server), Effect.scoped),
  );

  it.effect("readinessCheck derives readyWhen from status", () =>
    Effect.gen(function* () {
      const down = yield* Resource.readinessCheck(Database, {
        status: Effect.succeed({ connected: false, latencyMs: 0 }),
      });
      expect(down).toEqual({ ready: false, detail: "disconnected" });

      const up = yield* Resource.readinessCheck(Database, {
        status: Effect.succeed({ connected: true, latencyMs: 12 }),
      });
      expect(up).toEqual({ ready: true, detail: "12ms" });
    }),
  );
});
