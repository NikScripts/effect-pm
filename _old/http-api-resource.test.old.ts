import { it, describe, expect } from "@effect/vitest"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import type { HttpClientError } from "effect/unstable/http"
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { acceptJson, HttpApiResource } from "../src"

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

const pingEndpoint = HttpApiEndpoint.get("ping", "/ping", {
  success: Schema.Struct({ pong: Schema.Boolean }),
})

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
      client: {},
      limits: {},
    })
    return Effect.gen(function* () {
      const client = yield* Tag
      expect(client).toBeDefined()
      expect(typeof client).toBe("object")
    }).pipe(
      Effect.provide(Tag.layer),
      Effect.provide(fakeHttpClientLayer)
    )
  })

  it("tag id uses the provided name", () => {
    const api = HttpApi.make("my-cool-api")
    const Tag = HttpApiResource.make(api, {
      name: "api/my-cool-api",
      client: {},
    })
    expect(Tag.key).toBe("api/my-cool-api")
  })

  it("tag id can be any custom string", () => {
    const api = HttpApi.make("some-api")
    const Tag = HttpApiResource.make(api, {
      name: "custom/tag-id",
      client: {},
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
        client: {},
        limits: {},
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
      }).pipe(Effect.provide(Tag.layer), Effect.provide(httpLayer))
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
        client: {},
        limits: { concurrency: 3 },
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
      }).pipe(Effect.provide(Tag.layer), Effect.provide(httpLayer))
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
        client: {},
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
      }).pipe(Effect.provide(Tag.layer), Effect.provide(httpLayer))
      expect(peakConcurrent).toBe(12)
    })
  )

  it.live("applies transformClient before the run gate", () =>
    Effect.gen(function* () {
      const api = HttpApi.make("vitest-tc").add(HttpApiGroup.make("g").add(pingEndpoint))
      const Tag = HttpApiResource.make(api, {
        name: "test/http-api-transform-order",
        limits: {},
        client: {
          transformClient: (c) =>
            HttpClient.mapRequest(c, HttpClientRequest.setHeader("X-Test-Order", "user-first")),
        },
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
      }).pipe(Effect.provide(Tag.layer), Effect.provide(httpLayer))
    })
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
      const Tag = Context.Service<
        ClientShape & { _brand: "test/existing-client" },
        ClientShape
      >("test/existing-client")
      const layerCapture = HttpApiResource.layerEffect(Tag, makeClient, {
        limits: {},
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
      }).pipe(Effect.provide(layerCapture), Effect.provide(httpLayer))
      expect(result.builds).toBe(1)
      expect(result.peakConcurrent).toBe(1)
    })
  )
})
