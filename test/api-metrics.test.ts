import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Ref, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientError } from "effect/unstable/http";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Gate from "../src/Gate";
import { resetClientUsageForTest } from "../src/internal/apiUsageRegistry";

const ClientId = "test/api-metrics/client" as const;

const pingEndpoint = HttpApiEndpoint.get("ping", "/ping", {
  success: Schema.Struct({ pong: Schema.Boolean }),
});

const demoApi = HttpApi.make("api-metrics-demo").add(
  HttpApiGroup.make("g").add(pingEndpoint),
);

class DemoClient extends Gate.HttpApiClient<DemoClient>()(ClientId, demoApi, {
  concurrency: 2,
  windowMs: Duration.seconds(1),
}) {
  static readonly layer = Gate.httpApiClientLayer(DemoClient);
}

class LimitedClient extends Gate.HttpApiClient<LimitedClient>()(
  "test/api-metrics/limited",
  demoApi,
  {
    concurrency: 2,
    rateLimit: { limit: 5, window: Duration.seconds(60) },
  },
) {
  static readonly layer = Gate.httpApiClientLayer(LimitedClient);
}

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

const liveLayers = DemoClient.layer.pipe(Layer.provide(fakeHttpClientLayer));
const limitedLayers = LimitedClient.layer.pipe(Layer.provide(fakeHttpClientLayer));

beforeEach(() => {
  Effect.runSync(resetClientUsageForTest());
});

describe("Gate.HttpApiClient metrics nest", () => {
  it("stamps kind + default metricsKey metadata", () => {
    expect(DemoClient.key).toBe(ClientId);
    expect(Gate.metricsKeyOf(DemoClient)).toBe("metrics");
  });

  it.effect("usage.get reflects endpoint calls", () =>
    Effect.gen(function* () {
      const client = yield* DemoClient;
      yield* client.g.ping();
      yield* client.g.ping();
      const snap = yield* client.metrics.usage.get;
      expect(snap.clientId).toBe(ClientId);
      expect(snap.requestsTotal).toBe(2);
      expect(snap.errorsTotal).toBe(0);
      expect(snap.topEndpoints[0]?.endpoint).toBe("ping");
    }).pipe(Effect.provide(liveLayers), Effect.scoped),
  );

  it.effect("windows stream emits after traffic", () =>
    Effect.gen(function* () {
      const client = yield* DemoClient;
      const samples = yield* Ref.make(0);
      yield* Effect.forkScoped(
        Stream.runForEach(client.metrics.windows, () =>
          Ref.update(samples, (n) => n + 1),
        ),
      );
      yield* Effect.yieldNow;
      yield* client.g.ping();
      yield* Effect.yieldNow;
      expect(yield* Ref.get(samples)).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.provide(liveLayers), Effect.scoped),
  );

  it("fail-loud when metricsKey collides with an HttpApi group id", () => {
    expect(() =>
      Gate.HttpApiClient()("test/collide", demoApi, { metricsKey: "g" }),
    ).toThrow(Gate.MetricsKeyCollision);
  });

  it.effect("rateLimit publishes remaining on the nest", () =>
    Effect.gen(function* () {
      const client = yield* LimitedClient;
      expect(yield* client.metrics.remaining.get).toBe(5);
      yield* client.g.ping();
      expect(yield* client.metrics.remaining.get).toBe(4);
    }).pipe(Effect.provide(limitedLayers), Effect.scoped),
  );

  it("adaptive without rateLimit fails loud at mint", () => {
    expect(() =>
      Gate.HttpApiClient()("test/adaptive-no-rl", demoApi, { adaptive: true }),
    ).toThrow(Gate.AdaptiveRequiresRateLimit);
  });
});

class AdaptiveClient extends Gate.HttpApiClient<AdaptiveClient>()(
  "test/api-metrics/adaptive",
  demoApi,
  {
    concurrency: 1,
    rateLimit: { limit: 1_000, window: Duration.minutes(1) },
    adaptive: { key: "upstream:test-adaptive" },
  },
) {
  static readonly layer = Gate.httpApiClientLayer(AdaptiveClient, {
    baseUrl: "https://api.example.com",
  });
}

describe("Gate.HttpApiClient adaptive 429", () => {
  it.effect("429 + Retry-After cools down the next round-trip", () =>
    Effect.gen(function* () {
      const hits = yield* Ref.make(0);
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
          (reqEff) =>
            Effect.flatMap(reqEff, (req) =>
              Effect.gen(function* () {
                const n = yield* Ref.updateAndGet(hits, (x) => x + 1);
                if (n === 1) {
                  return HttpClientResponse.fromWeb(
                    req,
                    new Response("{}", {
                      status: 429,
                      headers: { "retry-after": "60" },
                    }),
                  );
                }
                return HttpClientResponse.fromWeb(
                  req,
                  new Response(json200, {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  }),
                );
              }),
            ),
          (request) => Effect.succeed(request),
        ),
      );

      yield* Effect.gen(function* () {
        const client = yield* AdaptiveClient;
        // First call hits 429 — decode fails; adaptiveFeedback still records cooldown.
        yield* client.g.ping().pipe(Effect.exit);
        expect(yield* Ref.get(hits)).toBe(1);

        const fiber = yield* Effect.forkChild(client.g.ping().pipe(Effect.exit));
        yield* TestClock.adjust(Duration.seconds(30));
        expect(yield* Ref.get(hits)).toBe(1);
        yield* TestClock.adjust(Duration.seconds(30));
        yield* Fiber.join(fiber);
        expect(yield* Ref.get(hits)).toBe(2);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            AdaptiveClient.layer.pipe(Layer.provide(httpLayer)),
            TestClock.layer(),
          ),
        ),
        Effect.scoped,
      );
    }),
  );
});
