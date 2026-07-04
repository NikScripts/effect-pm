import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Ref, Schema, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
  HttpServer,
} from "effect/unstable/http";
import type { HttpClientError } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as ApiMetrics from "../src/ApiMetrics";
import { HttpApiResource } from "../src/HttpApiResource";
import { resetClientUsageForTest } from "../src/internal/apiUsageRegistry";
import * as Resource from "../src/Resource";

const ClientId = "test/api-metrics/client" as const;

class DemoMetrics extends ApiMetrics.Tag<DemoMetrics>()(ClientId) {}

const pingEndpoint = HttpApiEndpoint.get("ping", "/ping", {
  success: Schema.Struct({ pong: Schema.Boolean }),
});

const demoApi = HttpApi.make("api-metrics-demo").add(
  HttpApiGroup.make("g").add(pingEndpoint),
);

class DemoClient extends HttpApiResource.Service<DemoClient>()(ClientId, demoApi, {
  concurrency: 2,
}) {}

const json200 = JSON.stringify({ pong: true });

const fakeHttpClientLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
    (reqEff) =>
      Effect.flatMap(reqEff, (req) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(req, new Response(json200, { status: 200 })),
        ),
      ),
    (request) => Effect.succeed(request),
  ),
);

const liveLayers = Layer.mergeAll(
  DemoClient.layer.pipe(Layer.provide(fakeHttpClientLayer)),
  ApiMetrics.layer(DemoMetrics, { windowMs: Duration.seconds(1) }),
);

beforeEach(() => {
  Effect.runSync(resetClientUsageForTest());
});

describe("ApiMetrics.Tag", () => {
  it("auto-suffixes the Resource key and stores clientIdSym", () => {
    expect(DemoMetrics.key).toBe(ApiMetrics.metricsKeyFor(ClientId));
    expect(ApiMetrics.clientIdOf(DemoMetrics)).toBe(ClientId);
    // per-instance group: the groupId is the metrics key (its own wire prefix), not a shared family
    expect(DemoMetrics.groupId).toBe(ApiMetrics.metricsKeyFor(ClientId));
  });
});

describe("ApiMetrics.layer", () => {
  it.effect("usageNow reflects HttpApiResource endpoint calls", () =>
    Effect.gen(function* () {
      const client = yield* DemoClient;
      const metrics = yield* DemoMetrics;
      yield* client.g.ping();
      yield* client.g.ping();
      const snap = yield* metrics.usageNow;
      expect(snap.clientId).toBe(ClientId);
      expect(snap.requestsTotal).toBe(2);
      expect(snap.errorsTotal).toBe(0);
      expect(snap.topEndpoints[0]?.endpoint).toBe("ping");
    }).pipe(Effect.provide(liveLayers), Effect.scoped),
  );

  it.effect("metrics stream emits on endpoint usage", () =>
    Effect.gen(function* () {
      const client = yield* DemoClient;
      const metrics = yield* DemoMetrics;
      const samples = yield* Ref.make(0);
      yield* Effect.forkScoped(
        Stream.runForEach(metrics.metrics, () => Ref.update(samples, (n) => n + 1)),
      );
      yield* Effect.yieldNow;
      yield* client.g.ping();
      yield* Effect.yieldNow;
      expect(yield* Ref.get(samples)).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.provide(liveLayers), Effect.scoped),
  );
});

describe("ApiMetrics per-instance groups + httpServer", () => {
  const OtherClientId = "test/api-metrics/other" as const;
  class OtherMetrics extends ApiMetrics.Tag<OtherMetrics>()(OtherClientId) {}

  it("each tag is its own group with a distinct, key-prefixed wire id", () => {
    expect(DemoMetrics.groupId).not.toBe(OtherMetrics.groupId);
    expect(OtherMetrics.groupId).toBe(ApiMetrics.metricsKeyFor(OtherClientId));
  });

  // Two metrics tags served on one node via `httpServer`; each reached over http with its own
  // per-instance group — `Resource.client` routes to the right one (no shared key header).
  const alphaImpl = {
    usageNow: Effect.succeed({
      clientId: ClientId,
      inFlight: 0,
      requestsTotal: 1,
      errorsTotal: 0,
      topEndpoints: [{ group: "g", endpoint: "alpha", requests: 1, errors: 0 }],
    }),
    metrics: Stream.empty,
  };
  const betaImpl = {
    usageNow: Effect.succeed({
      clientId: OtherClientId,
      inFlight: 0,
      requestsTotal: 2,
      errorsTotal: 0,
      topEndpoints: [{ group: "g", endpoint: "beta", requests: 2, errors: 0 }],
    }),
    metrics: Stream.empty,
  };
  const Server = Resource.httpServer([
    Resource.serve(DemoMetrics, alphaImpl),
    Resource.serve(OtherMetrics, betaImpl),
  ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

  it("httpServer serves both; clients read the right one", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
        const port = addr._tag === "TcpAddress" ? addr.port : 0;
        const protocol = RpcClient.layerProtocolHttp({
          url: `http://127.0.0.1:${port}/rpc`,
        }).pipe(
          Layer.provide(RpcSerialization.layerNdjson),
          Layer.provide(FetchHttpClient.layer),
        );
        yield* Effect.gen(function* () {
          const demo = yield* DemoMetrics;
          const other = yield* OtherMetrics;
          const alpha = yield* demo.usageNow;
          const beta = yield* other.usageNow;
          expect(alpha.topEndpoints[0]?.endpoint).toBe("alpha");
          expect(beta.topEndpoints[0]?.endpoint).toBe("beta");
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Resource.client(DemoMetrics),
              Resource.client(OtherMetrics),
            ).pipe(Layer.provide(protocol)),
          ),
          Effect.scoped,
        );
      }).pipe(Effect.provide(Server), Effect.scoped),
    ));
});

describe("ApiMetrics.layerFor", () => {
  it("links metrics tag to HttpApiResource.Service key", () => {
    const layer = ApiMetrics.layerFor(DemoMetrics, DemoClient);
    expect(layer).toBeDefined();
  });
});
