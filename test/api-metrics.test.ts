import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Ref, Schema, Stream } from "effect";
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
import * as Gate from "../src/Gate";
import { resetClientUsageForTest } from "../src/internal/apiUsageRegistry";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

const ClientId = "test/api-metrics/client" as const;

class DemoMetrics extends ApiMetrics.Tag<DemoMetrics>()(ClientId) {}

const pingEndpoint = HttpApiEndpoint.get("ping", "/ping", {
  success: Schema.Struct({ pong: Schema.Boolean }),
});

const demoApi = HttpApi.make("api-metrics-demo").add(
  HttpApiGroup.make("g").add(pingEndpoint),
);

class DemoClient extends Gate.httpApiClientService<DemoClient>()(ClientId, demoApi, {
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
  it("auto-suffixes the Hyperlink key and stores clientIdSym", () => {
    expect(DemoMetrics.key).toBe(ApiMetrics.metricsKeyFor(ClientId));
    expect(ApiMetrics.clientIdOf(DemoMetrics)).toBe(ClientId);
    // per-instance group: the groupId is the metrics key (its own wire prefix), not a shared family
    expect(DemoMetrics.groupId).toBe(ApiMetrics.metricsKeyFor(ClientId));
  });
});

describe("ApiMetrics.layer", () => {
  it.effect("usage.get reflects HttpApiClient endpoint calls", () =>
    Effect.gen(function* () {
      const client = yield* DemoClient;
      const metrics = yield* DemoMetrics;
      yield* client.g.ping();
      yield* client.g.ping();
      const snap = yield* metrics.usage.get;
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

  it.effect("usage.changes emits when endpoint usage is recorded", () =>
    Effect.gen(function* () {
      const client = yield* DemoClient;
      const metrics = yield* DemoMetrics;
      const collected = yield* Effect.forkChild(
        Stream.runHead(
          Stream.filter(metrics.usage.changes, (s) => s.requestsTotal >= 1),
        ),
      );
      yield* Effect.yieldNow;
      yield* client.g.ping();
      const head = yield* Fiber.join(collected);
      expect(head._tag).toBe("Some");
      if (head._tag === "Some") {
        expect(head.value.requestsTotal).toBeGreaterThanOrEqual(1);
      }
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
  // per-instance group — `Hyperlink.client` routes to the right one (no shared key header).
  const alphaSnap = {
    clientId: ClientId,
    inFlight: 0,
    requestsTotal: 1,
    errorsTotal: 0,
    topEndpoints: [{ group: "g", endpoint: "alpha", requests: 1, errors: 0 }],
  };
  const betaSnap = {
    clientId: OtherClientId,
    inFlight: 0,
    requestsTotal: 2,
    errorsTotal: 0,
    topEndpoints: [{ group: "g", endpoint: "beta", requests: 2, errors: 0 }],
  };
  const alphaImpl = {
    usage: {
      get: Effect.succeed(alphaSnap),
      changes: Stream.fromIterable([alphaSnap]),
    },
    metrics: Stream.empty,
  };
  const betaImpl = {
    usage: {
      get: Effect.succeed(betaSnap),
      changes: Stream.fromIterable([betaSnap]),
    },
    metrics: Stream.empty,
  };
  const Server = Node.httpServer([
    Hyperlink.serve(DemoMetrics, alphaImpl),
    Hyperlink.serve(OtherMetrics, betaImpl),
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
          const alpha = yield* demo.usage.get;
          const beta = yield* other.usage.get;
          expect(alpha.topEndpoints[0]?.endpoint).toBe("alpha");
          expect(beta.topEndpoints[0]?.endpoint).toBe("beta");
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Hyperlink.client(DemoMetrics),
              Hyperlink.client(OtherMetrics),
            ).pipe(Layer.provide(protocol)),
          ),
          Effect.scoped,
        );
      }).pipe(Effect.provide(Server), Effect.scoped),
    ));
});

describe("ApiMetrics.layerFor", () => {
  it("links metrics tag to Gate.httpApiClientService key", () => {
    const layer = ApiMetrics.layerFor(DemoMetrics, DemoClient);
    expect(layer).toBeDefined();
  });
});
