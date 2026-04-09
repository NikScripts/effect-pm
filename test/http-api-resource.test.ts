import { it, describe, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import type { HttpClientError } from "effect/unstable/http"
import { HttpApi } from "effect/unstable/httpapi"
import { acceptJson, HttpApiResource } from "../src"

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
})
