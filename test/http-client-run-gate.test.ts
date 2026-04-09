import { it, describe, expect } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import type { HttpClientError } from "effect/unstable/http"
import { HttpClientRunGate, RunResource } from "../src"

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
          return HttpClientResponse.fromWeb(req, new Response("", { status: 200 }))
        })
      ),
    (request) => Effect.succeed(request)
  )

describe("HttpClientRunGate", () => {
  it.live("transformClient gates execute through the runner", () => {
    const Runner = RunResource.makeRunner({
      name: "test/http-gate-c1",
      limits: {},
    })
    return Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const runner = yield* Runner
      const gated = HttpClientRunGate.transformClient(
        makeRecordingClient(active, peak),
        runner
      )
      yield* Effect.all(
        Array.from({ length: 12 }, () =>
          gated.execute(HttpClientRequest.get("https://example.test/a"))
        ),
        { concurrency: "unbounded" }
      )
      const p = yield* Ref.get(peak)
      expect(p).toBe(1)
    }).pipe(Effect.provide(Runner.layer))
  })

  it.live("withRunner is pipe-friendly and respects concurrency", () => {
    const Runner = RunResource.makeRunner({
      name: "test/http-gate-pipe",
      limits: { concurrency: 3 },
    })
    return Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const runner = yield* Runner
      const gated = makeRecordingClient(active, peak).pipe(
        HttpClientRunGate.withRunner(runner)
      )
      yield* Effect.all(
        Array.from({ length: 15 }, () =>
          gated.execute(HttpClientRequest.get("https://example.test/b"))
        ),
        { concurrency: "unbounded" }
      )
      const p = yield* Ref.get(peak)
      expect(p).toBeLessThanOrEqual(3)
      expect(p).toBeGreaterThanOrEqual(1)
    }).pipe(Effect.provide(Runner.layer))
  })
})
