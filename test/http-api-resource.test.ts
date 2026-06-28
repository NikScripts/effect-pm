import { it, describe, expect } from "@effect/vitest"
import { Context, Effect, Exit, Layer, Metric, Ref, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import type { HttpClientError } from "effect/unstable/http"
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { acceptJson, HttpApiResource } from "../src"

const pingEndpoint = HttpApiEndpoint.get("ping", "/ping", {
  success: Schema.Struct({ pong: Schema.Boolean }),
})

const json200 = JSON.stringify({ pong: true })

const makeRecordingClient = (activeRef: Ref.Ref<number>, peakRef: Ref.Ref<number>): HttpClient.HttpClient =>
  HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
    (reqEff) =>
      Effect.flatMap(reqEff, (req) =>
        Effect.gen(function* () {
          const n = yield* Ref.updateAndGet(activeRef, (x) => x + 1)
          const prevPeak = yield* Ref.get(peakRef)
          if (n > prevPeak) yield* Ref.set(peakRef, n)
          yield* Effect.yieldNow
          yield* Ref.update(activeRef, (x) => x - 1)
          return HttpClientResponse.fromWeb(
            req,
            new Response(json200, {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          )
        })
      ),
    (request) => Effect.succeed(request)
  )

const fakeHttpClientLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
    (reqEff) =>
      Effect.flatMap(reqEff, (req) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(req, new Response("{}", { status: 200 }))
        )
      ),
    (request) => Effect.succeed(request)
  )
)

describe("acceptJson", () => {
  it.live("sets Accept: application/json on outgoing requests", () =>
    Effect.gen(function* () {
      const base: HttpClient.HttpClient = HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
        (reqEff) =>
          Effect.flatMap(reqEff, (req) => {
            expect(req.headers.accept).toContain("application/json")
            return Effect.succeed(
              HttpClientResponse.fromWeb(req, new Response("{}", { status: 200 }))
            )
          }),
        (request) => Effect.succeed(request)
      )
      const client = acceptJson(base)
      yield* client.execute(HttpClientRequest.get("https://example.test/json"))
    })
  )
})

describe("HttpApiResource.make", () => {
  it.live("builds a tag whose layer yields a client", () => {
    const api = HttpApi.make("vitest-empty-api")
    const Tag = HttpApiResource.make(api, {
      name: "test/vitest-empty-api",
      concurrency: 1,
    })
    return Effect.gen(function* () {
      const client = yield* Tag
      expect(client).toBeDefined()
      expect(typeof client).toBe("object")
    }).pipe(
      Effect.provide(Tag.layer.pipe(Layer.provide(fakeHttpClientLayer)))
    )
  })

  it("tag id uses the provided name", () => {
    const api = HttpApi.make("my-cool-api")
    const Tag = HttpApiResource.make(api, {
      name: "api/my-cool-api",
    })
    expect(Tag.key).toBe("api/my-cool-api")
  })

  it("tag id can be any custom string", () => {
    const api = HttpApi.make("some-api")
    const Tag = HttpApiResource.make(api, {
      name: "custom/tag-id",
    })
    expect(Tag.key).toBe("custom/tag-id")
  })

  it.live("limits concurrency (default 1) serializes HTTP requests", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const api = HttpApi.make("vitest-c1").add(HttpApiGroup.make("g").add(pingEndpoint))
      const Tag = HttpApiResource.make(api, {
        name: "test/http-api-c1",
        concurrency: 1,
      })
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        makeRecordingClient(active, peak)
      )
      const peakConcurrent = yield* Effect.gen(function* () {
        const client = yield* Tag
        yield* Effect.all(
          Array.from({ length: 12 }, () => client.g.ping()),
          { concurrency: "unbounded" }
        )
        return yield* Ref.get(peak)
      }).pipe(Effect.provide(Tag.layer.pipe(Layer.provide(httpLayer))))
      expect(peakConcurrent).toBe(1)
    })
  )

  it.live("limits concurrency 3 caps concurrent in-flight requests", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const api = HttpApi.make("vitest-c3").add(HttpApiGroup.make("g").add(pingEndpoint))
      const Tag = HttpApiResource.make(api, {
        name: "test/http-api-c3",
        concurrency: 3,
      })
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        makeRecordingClient(active, peak)
      )
      const peakConcurrent = yield* Effect.gen(function* () {
        const client = yield* Tag
        yield* Effect.all(
          Array.from({ length: 15 }, () => client.g.ping()),
          { concurrency: "unbounded" }
        )
        return yield* Ref.get(peak)
      }).pipe(Effect.provide(Tag.layer.pipe(Layer.provide(httpLayer))))
      expect(peakConcurrent).toBeLessThanOrEqual(3)
      expect(peakConcurrent).toBeGreaterThanOrEqual(1)
    })
  )

  it.live("omitted limits does not gate concurrent requests", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const api = HttpApi.make("vitest-nogate").add(HttpApiGroup.make("g").add(pingEndpoint))
      const Tag = HttpApiResource.make(api, {
        name: "test/http-api-no-limits",
      })
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        makeRecordingClient(active, peak)
      )
      const peakConcurrent = yield* Effect.gen(function* () {
        const client = yield* Tag
        yield* Effect.all(
          Array.from({ length: 12 }, () => client.g.ping()),
          { concurrency: "unbounded" }
        )
        return yield* Ref.get(peak)
      }).pipe(Effect.provide(Tag.layer.pipe(Layer.provide(httpLayer))))
      expect(peakConcurrent).toBe(12)
    })
  )

  it.live("applies transformClient before the run gate", () =>
    Effect.gen(function* () {
      const api = HttpApi.make("vitest-tc").add(HttpApiGroup.make("g").add(pingEndpoint))
      const Tag = HttpApiResource.make(api, {
        name: "test/http-api-transform-order",
        concurrency: 1,
        transformClient: (c) =>
          HttpClient.mapRequest(c, HttpClientRequest.setHeader("X-Test-Order", "user-first")),
      })
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
          (reqEff) =>
            Effect.flatMap(reqEff, (req) => {
              expect(req.headers["x-test-order"]).toBe("user-first")
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  req,
                  new Response(json200, {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  })
                )
              )
            }),
          (request) => Effect.succeed(request)
        )
      )
      yield* Effect.gen(function* () {
        const client = yield* Tag
        yield* client.g.ping()
      }).pipe(Effect.provide(Tag.layer.pipe(Layer.provide(httpLayer))))
    })
  )

  it.live("records endpoint usage metrics by group + endpoint name", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const api = HttpApi.make("vitest-metrics").add(HttpApiGroup.make("g").add(pingEndpoint))
      const Tag = HttpApiResource.make(api, {
        name: "test/http-api-metrics",
        concurrency: 2,
      })
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        makeRecordingClient(active, peak)
      )
      yield* Effect.gen(function* () {
        const client = yield* Tag
        yield* Effect.all(
          Array.from({ length: 3 }, () => client.g.ping()),
          { concurrency: "unbounded" },
        )
      }).pipe(Effect.provide(Tag.layer.pipe(Layer.provide(httpLayer))))
      const snapshot = yield* Metric.snapshot
      const findEndpoint = (id: string) =>
        snapshot.find(
          (m) =>
            m.id === id &&
            m.attributes?.client === "test/http-api-metrics" &&
            m.attributes?.group === "g" &&
            m.attributes?.endpoint === "ping",
        )
      expect(findEndpoint("httpapi_endpoint_requests_total")?.state).toMatchObject({ count: 3 })
      expect(findEndpoint("httpapi_endpoint_duration_ms")?.state).toMatchObject({ count: 3 })
      expect(
        snapshot.find(
          (m) =>
            m.id === "httpapi_endpoint_requests_total" &&
            m.attributes?.client === "test/http-api-metrics" &&
            m.attributes?.group === "g" &&
            m.attributes?.endpoint === "ping" &&
            m.attributes?.outcome === "success",
        )?.state,
      ).toMatchObject({ count: 3 })
      expect(
        snapshot.find(
          (m) =>
            m.id === "httpapi_in_flight" &&
            m.attributes?.client === "test/http-api-metrics",
        )?.state,
      ).toBeDefined()
    }).pipe(Effect.scoped),
  )

  it.live("records outcome=error and error tag on endpoint failure", () =>
    Effect.gen(function* () {
      const failEndpoint = HttpApiEndpoint.get("fail", "/fail", {
        success: Schema.Struct({ ok: Schema.Boolean }),
      })
      const api = HttpApi.make("vitest-fail").add(HttpApiGroup.make("g").add(failEndpoint))
      const Tag = HttpApiResource.make(api, {
        name: "test/http-api-fail-metrics",
      })
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
          (reqEff) =>
            Effect.flatMap(reqEff, (req) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  req,
                  new Response("not json", { status: 500, headers: { "content-type": "text/plain" } }),
                ),
              ),
            ),
          (request) => Effect.succeed(request),
        ),
      )
      const exit = yield* Effect.gen(function* () {
        const client = yield* Tag
        yield* client.g.fail()
      }).pipe(Effect.exit, Effect.provide(Tag.layer.pipe(Layer.provide(httpLayer))))
      expect(Exit.isFailure(exit)).toBe(true)
      const snapshot = yield* Metric.snapshot
      expect(
        snapshot.find(
          (m) =>
            m.id === "httpapi_endpoint_requests_total" &&
            m.attributes?.client === "test/http-api-fail-metrics" &&
            m.attributes?.group === "g" &&
            m.attributes?.endpoint === "fail" &&
            m.attributes?.outcome === "error",
        )?.state,
      ).toMatchObject({ count: 1 })
      expect(
        snapshot.find(
          (m) =>
            m.id === "httpapi_endpoint_errors_total" &&
            m.attributes?.client === "test/http-api-fail-metrics" &&
            m.attributes?.group === "g" &&
            m.attributes?.endpoint === "fail",
        )?.state,
      ).toMatchObject({ count: 1 })
    }).pipe(Effect.scoped),
  )
})

describe("HttpApiResource.Tag", () => {
  it.live("declares a class tag with baked-in layer and endpoint metrics", () =>
    Effect.gen(function* () {
      const api = HttpApi.make("vitest-tag-api").add(HttpApiGroup.make("g").add(pingEndpoint))
      class PingClient extends HttpApiResource.Tag<PingClient>()("test/http-api-resource-tag", api, {
        concurrency: 1,
      }) {}
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
          (reqEff) =>
            Effect.flatMap(reqEff, (req) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  req,
                  new Response(json200, {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  }),
                ),
              ),
            ),
          (request) => Effect.succeed(request),
        ),
      )
      yield* Effect.gen(function* () {
        const client = yield* PingClient
        yield* client.g.ping()
      }).pipe(Effect.provide(PingClient.layer.pipe(Layer.provide(httpLayer))))
      const snapshot = yield* Metric.snapshot
      expect(
        snapshot.find(
          (m) =>
            m.id === "httpapi_endpoint_requests_total" &&
            m.attributes?.client === "test/http-api-resource-tag" &&
            m.attributes?.group === "g" &&
            m.attributes?.endpoint === "ping" &&
            m.attributes?.outcome === "success",
        )?.state,
      ).toMatchObject({ count: 1 })
    }),
  )
})

describe("HttpApiResource.layerEffect", () => {
  it.live("wraps an existing client effect with one shared gated instance", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const builds = yield* Ref.make(0)
      const api = HttpApi.make("vitest-existing-client").add(HttpApiGroup.make("g").add(pingEndpoint))
      const makeClient = Effect.gen(function* () {
        yield* Ref.update(builds, (n) => n + 1)
        return yield* HttpApiClient.make(api, {
          transformClient: acceptJson,
        })
      })
      type ClientShape = Effect.Success<typeof makeClient>
      class Tag extends Context.Service<Tag, ClientShape>()(
        "@nikscripts/effect-pm/test/http-api-resource.test/Tag",
      ) {}
      const layerCapture = HttpApiResource.layerEffect(Tag, makeClient, {
        concurrency: 1,
        api,
      })
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        makeRecordingClient(active, peak)
      )
      const result = yield* Effect.gen(function* () {
        const clientA = yield* Tag
        const clientB = yield* Tag
        expect(clientA).toBe(clientB)
        yield* Effect.all(
          Array.from({ length: 12 }, (_, i) =>
            i % 2 === 0 ? clientA.g.ping() : clientB.g.ping()
          ),
          { concurrency: "unbounded" }
        )
        return {
          builds: yield* Ref.get(builds),
          peakConcurrent: yield* Ref.get(peak),
        }
      }).pipe(Effect.provide(layerCapture.pipe(Layer.provide(httpLayer))))
      expect(result.builds).toBe(1)
      expect(result.peakConcurrent).toBe(1)
      const snapshot = yield* Metric.snapshot
      expect(
        snapshot.find(
          (m) =>
            m.id === "httpapi_endpoint_requests_total" &&
            m.attributes?.client === "@nikscripts/effect-pm/test/http-api-resource.test/Tag" &&
            m.attributes?.group === "g" &&
            m.attributes?.endpoint === "ping" &&
            m.attributes?.outcome === "success",
        )?.state,
      ).toMatchObject({ count: 12 })
    })
  )
})
