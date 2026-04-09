import { it, describe, expect } from "@effect/vitest"
import { Duration, Effect, Ref } from "effect"
import { RunResource } from "../src"

const trackedWork = (active: Ref.Ref<number>, peak: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const n = yield* Ref.updateAndGet(active, (x) => x + 1)
    const p = yield* Ref.get(peak)
    if (n > p) yield* Ref.set(peak, n)
    yield* Effect.yieldNow
    yield* Ref.update(active, (x) => x - 1)
  })

describe("RunResource.makeRunner", () => {
  it.live("limits omitted -> identity wrap (high parallelism)", () => {
    const Gate = RunResource.makeRunner({ name: "test/no-limits" })
    return Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const work = trackedWork(active, peak)
      const runner = yield* Gate
      yield* Effect.all(Array.from({ length: 40 }, () => runner(work)), {
        concurrency: "unbounded",
      })
      const p = yield* Ref.get(peak)
      expect(p).toBeGreaterThan(8)
    }).pipe(Effect.provide(Gate.layer))
  })

  it.live("limits: {} defaults concurrency to 1", () => {
    const Gate = RunResource.makeRunner({
      name: "test/default-concurrency",
      limits: {},
    })
    return Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const work = trackedWork(active, peak)
      const runner = yield* Gate
      yield* Effect.all(Array.from({ length: 30 }, () => runner(work)), {
        concurrency: "unbounded",
      })
      const p = yield* Ref.get(peak)
      expect(p).toBe(1)
    }).pipe(Effect.provide(Gate.layer))
  })

  it.live("respects limits.concurrency", () => {
    const Gate = RunResource.makeRunner({
      name: "test/concurrency-4",
      limits: { concurrency: 4 },
    })
    return Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const work = trackedWork(active, peak)
      const runner = yield* Gate
      yield* Effect.all(Array.from({ length: 40 }, () => runner(work)), {
        concurrency: "unbounded",
      })
      const p = yield* Ref.get(peak)
      expect(p).toBeLessThanOrEqual(4)
      expect(p).toBeGreaterThanOrEqual(1)
    }).pipe(Effect.provide(Gate.layer))
  })

  it.live("throttle completes without hanging", () => {
    const Gate = RunResource.makeRunner({
      name: "test/throttle",
      limits: {
        concurrency: 2,
        throttle: { limit: 20, duration: Duration.millis(200) },
      },
    })
    return Effect.gen(function* () {
      const runner = yield* Gate
      const results = yield* Effect.all(
        Array.from({ length: 8 }, () => runner(Effect.succeed(1))),
        { concurrency: "unbounded" }
      )
      expect(results.length).toBe(8)
    }).pipe(Effect.provide(Gate.layer))
  })
})

describe("RunResource.make", () => {
  it.live("unit effect: yield* tag() returns configured value", () => {
    const Tag = RunResource.make({
      name: "test/unit",
      effect: Effect.succeed(7),
      limits: {},
    })
    return Effect.gen(function* () {
      const run = yield* Tag
      const v = yield* run()
      expect(v).toBe(7)
    }).pipe(Effect.provide(Tag.layer))
  })

  it.live("parameterized effect: run(input) forwards argument", () => {
    const Tag = RunResource.make({
      name: "test/fn",
      effect: (n: number) => Effect.succeed(n * 3),
      limits: {},
    })
    return Effect.gen(function* () {
      const run = yield* Tag
      const v = yield* run(5)
      expect(v).toBe(15)
    }).pipe(Effect.provide(Tag.layer))
  })

  it.live("repeated yield* reuses same semaphore", () => {
    let callCount = 0
    const Tag = RunResource.make({
      name: "test/reuse",
      effect: Effect.sync(() => ++callCount),
      limits: { concurrency: 1 },
    })
    return Effect.gen(function* () {
      const run = yield* Tag
      yield* run()
      yield* run()
      yield* run()
      expect(callCount).toBe(3)
    }).pipe(Effect.provide(Tag.layer))
  })
})
