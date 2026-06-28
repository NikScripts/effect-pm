import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Ref, Schema, Stream } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientError } from "effect/unstable/http";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { ApiMetrics, clientIdOf, metricsKeyFor } from "../src/ApiMetrics";
import { HttpApiResource } from "../src/HttpApiResource";
import { resetClientUsageForTest } from "../src/internal/apiUsageRegistry";
import { forwardClient, groupOf, specOf } from "../src/Resource";

const ClientId = "test/api-metrics/client" as const;

class DemoMetrics extends ApiMetrics.Tag<DemoMetrics>(ClientId)() {}

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
    expect(DemoMetrics.key).toBe(metricsKeyFor(ClientId));
    expect(clientIdOf(DemoMetrics)).toBe(ClientId);
    expect(DemoMetrics.groupId).toBe("apiMetrics");
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

describe("ApiMetrics.serveInstances", () => {
  const OtherClientId = "test/api-metrics/other" as const;
  class OtherMetrics extends ApiMetrics.Tag<OtherMetrics>(OtherClientId)() {}

  it("routes factory instances by key header", () => {
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

    const program = Effect.gen(function* () {
      const rpc = yield* RpcTest.makeClient(groupOf(DemoMetrics));
      const alphaSvc = forwardClient(
        rpc,
        specOf(DemoMetrics),
        DemoMetrics.groupId,
        DemoMetrics.key,
      );
      const betaSvc = forwardClient(
        rpc,
        specOf(OtherMetrics),
        OtherMetrics.groupId,
        OtherMetrics.key,
      );
      const alpha = yield* alphaSvc.usageNow;
      const beta = yield* betaSvc.usageNow;
      expect(alpha.topEndpoints[0]?.endpoint).toBe("alpha");
      expect(beta.topEndpoints[0]?.endpoint).toBe("beta");
    }).pipe(
      Effect.provide(
        ApiMetrics.serveInstances(
          ApiMetrics.instance(DemoMetrics, alphaImpl),
          ApiMetrics.instance(OtherMetrics, betaImpl),
        ),
      ),
      Effect.scoped,
    );
    return Effect.runPromise(program);
  });
});

describe("ApiMetrics.layerFor", () => {
  it("links metrics tag to HttpApiResource.Service key", () => {
    const layer = ApiMetrics.layerFor(DemoMetrics, DemoClient);
    expect(layer).toBeDefined();
  });
});
