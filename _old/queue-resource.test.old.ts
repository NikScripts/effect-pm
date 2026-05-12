import { describe, expect, it } from "@effect/vitest"
import type { Effect as IO } from "effect"
import { Cause, Context, Data, Duration, Effect, Exit, Fiber, Layer, Ref } from "effect"
import type { QueueResourceInterface } from "../src"
import { QueueResource } from "../src"

/** For forkWith success/failure rows without `Effect.either` (naming can differ by Effect version). */
type EithRow =
  | { readonly tag: "left"; readonly e: string }
  | { readonly tag: "right"; readonly n: number }

/** Per-item dependency for requirement-propagation tests */
const ItemDeps = Context.Service<{ readonly marker: string }>(
  "test/queue-item-deps",
)

const ForkDeps = Context.Service<{ readonly token: string }>(
  "test/queue-fork-deps",
)

const CacheDeps = Context.Service<{ readonly prefix: string }>(
  "test/queue-cache-deps",
)

const RefillDeps = Context.Service<{ readonly source: string }>(
  "test/queue-refill-deps",
)

const ItemLayer = Layer.succeed(ItemDeps, { marker: "item" })
const ForkLayer = Layer.succeed(ForkDeps, { token: "fork" })
const CacheLayer = Layer.succeed(CacheDeps, { prefix: "cache" })
const RefillLayer = Layer.succeed(RefillDeps, { source: "refill" })


/** Keeps queue resource tests fast; default queue throttle is very conservative. */
const fastThrottle = { limit: 10_000, duration: Duration.seconds(1) } as const

/**
 * Waits until `getCompleted` reaches `expected` (all enqueued items in the test
 * have finished processing). We do not require `isEmpty()` here: when workers
 * are blocked in `Queue.take` waiting for more work, `isEmpty()` may stay false
 * even though the batch is done — see `docs/queue-resource-testing-notes.md`.
 */
const waitUntilProcessed = <T, R, E>(
  queue: QueueResourceInterface<T, R, E>,
  expected: number
) =>
  Effect.gen(function* () {
    while (true) {
      const done = yield* queue.getCompleted()
      if (done >= expected) return
      yield* Effect.sleep(Duration.millis(5))
    }
  })

describe("QueueResource.make — processing", () => {
  it.live("add runs the item effect", () => {
    const Queue = QueueResource.make({
      name: "test/queue-basic",
      effect: (n: number) => Effect.succeed(n + 1),
      concurrency: 2,
      throttle: fastThrottle,
    })
    return Effect.gen(function* () {
      const queue = yield* Queue
      yield* queue.add(1)
      yield* waitUntilProcessed(queue, 1)
      expect(yield* queue.getCompleted()).toBe(1)
    }).pipe(Effect.provide(Queue.layer))
  })

  it.live("batch arrays are accepted on add", () => {
    const Queue = QueueResource.make({
      name: "test/queue-batch-add",
      effect: (n: number) => Effect.succeed(n),
      concurrency: 3,
      throttle: fastThrottle,
    })
    return Effect.gen(function* () {
      const queue = yield* Queue
      yield* queue.add([10, 11, 12])
      yield* waitUntilProcessed(queue, 3)
      expect(yield* queue.getCompleted()).toBe(3)
    }).pipe(Effect.provide(Queue.layer))
  })

  it.live("getCompleted increments for each finished item", () => {
    const Queue = QueueResource.make({
      name: "test/queue-count",
      effect: (_n: number) => Effect.void,
      concurrency: 4,
      throttle: fastThrottle,
    })
    return Effect.gen(function* () {
      const queue = yield* Queue
      for (let i = 0; i < 7; i++) {
        yield* queue.add(i)
      }
      yield* waitUntilProcessed(queue, 7)
      expect(yield* queue.getCompleted()).toBe(7)
    }).pipe(Effect.provide(Queue.layer))
  })

  it.live("batch arrays work for next and deffered", () => {
    const Queue = QueueResource.make({
      name: "test/queue-batch-mixed",
      effect: (n: number) => Effect.succeed(n),
      concurrency: 2,
      throttle: fastThrottle,
    })
    return Effect.gen(function* () {
      const queue = yield* Queue
      yield* queue.next([1, 2])
      yield* queue.deffered([3])
      yield* waitUntilProcessed(queue, 3)
      expect(yield* queue.getCompleted()).toBe(3)
    }).pipe(Effect.provide(Queue.layer))
  })

  it.live("restart resets completed count when queues are already empty", () => {
    const Queue = QueueResource.make({
      name: "test/queue-restart-after-drain",
      effect: (_n: number) => Effect.void,
      concurrency: 1,
      throttle: fastThrottle,
    })
    return Effect.gen(function* () {
      const queue = yield* Queue
      for (let i = 0; i < 4; i++) {
        yield* queue.add(i)
      }
      yield* waitUntilProcessed(queue, 4)
      expect(yield* queue.getCompleted()).toBe(4)

      yield* queue.restart()
      expect(yield* queue.getCompleted()).toBe(0)
      expect(yield* queue.isEmpty()).toBe(true)
    }).pipe(Effect.provide(Queue.layer))
  })

  it.live("item effect service requirements flow into the queue layer", () => {
    const ItemDepsLive = Layer.succeed(ItemDeps)({ marker: "from-layer" })

    const Queue = QueueResource.make({
      name: "test/queue-item-ritem",
      effect: (_n: number) =>
        Effect.gen(function* () {
          const deps = yield* ItemDeps
          expect(deps.marker).toBe("from-layer")
          return 0
        }),
      concurrency: 1,
      throttle: fastThrottle,
    })

    return Effect.gen(function* () {
      const queue = yield* Queue
      yield* queue.add(1)
      yield* waitUntilProcessed(queue, 1)
    }).pipe(Effect.provide(Layer.provide(Queue.layer, ItemDepsLive)))
  })
})

describe("QueueResource.make — worker lifecycle", () => {
  it.live("workers keep processing after queue acquisition fiber exits", () => {
    const Queue = QueueResource.make({
      name: "test/queue-worker-lifecycle-acquire-fiber",
      effect: (n: number) => Effect.succeed(n),
      concurrency: 1,
      throttle: fastThrottle,
    })

    return Effect.gen(function* () {
      const acquiredInChild = Effect.gen(function* () {
        return yield* Queue
      })

      const fiber = yield* Effect.forkChild(acquiredInChild)
      const queue = yield* Fiber.join(fiber)

      yield* queue.add(1)
      yield* waitUntilProcessed(queue, 1).pipe(
        Effect.timeout(Duration.seconds(1)),
      )
      expect(yield* queue.getCompleted()).toBe(1)
    }).pipe(Effect.provide(Queue.layer))
  })
})

describe("QueueResource.make — priority", () => {
  it.live("next beats add beats deffered when enqueued while paused", () =>
    Effect.gen(function* () {
      const orderRef = yield* Ref.make<readonly string[]>([])
      const Queue = QueueResource.make({
        name: "test/queue-priority",
        effect: (label: string) =>
          Ref.update(orderRef, (xs) => [...xs, label]).pipe(Effect.as(label)),
        concurrency: 1,
        throttle: fastThrottle,
      })
      yield* Effect.gen(function* () {
        const queue = yield* Queue
        yield* queue.pause()
        yield* queue.deffered("low")
        yield* queue.add("mid")
        yield* queue.next("high")
        yield* queue.resume()
        yield* waitUntilProcessed(queue, 3)
        expect(yield* Ref.get(orderRef)).toEqual(["high", "mid", "low"])
      }).pipe(Effect.provide(Queue.layer))
    })
  )
})

describe("QueueResource.make — concurrency", () => {
  const trackedWork = (active: Ref.Ref<number>, peak: Ref.Ref<number>) =>
    Effect.gen(function* () {
      const n = yield* Ref.updateAndGet(active, (x) => x + 1)
      const p = yield* Ref.get(peak)
      if (n > p) yield* Ref.set(peak, n)
      yield* Effect.yieldNow
      yield* Ref.update(active, (x) => x - 1)
    })

  it.live("respects concurrency cap", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const Queue = QueueResource.make({
        name: "test/queue-concurrency",
        effect: (_i: number) => trackedWork(active, peak),
        concurrency: 3,
        throttle: fastThrottle,
      })
      yield* Effect.gen(function* () {
        const queue = yield* Queue
        for (let i = 0; i < 24; i++) {
          yield* queue.add(i)
        }
        yield* waitUntilProcessed(queue, 24)
        const p = yield* Ref.get(peak)
        expect(p).toBeLessThanOrEqual(3)
        expect(p).toBeGreaterThanOrEqual(1)
      }).pipe(Effect.provide(Queue.layer))
    })
  )
})

describe("QueueResource.make — size helpers", () => {
  it.live("size and sizeByPriority track pending work", () =>
    Effect.gen(function* () {
      const gate = yield* Ref.make(false)
      const Queue = QueueResource.make({
        name: "test/queue-size",
        effect: (_label: string) =>
          Effect.gen(function* () {
            while (true) {
              const open = yield* Ref.get(gate)
              if (open) return
              yield* Effect.sleep(Duration.millis(2))
            }
          }),
        concurrency: 1,
        throttle: fastThrottle,
      })
      yield* Effect.gen(function* () {
        const queue = yield* Queue
        yield* queue.pause()
        yield* queue.next("h")
        yield* queue.add("n")
        yield* queue.deffered("l")
        const by = yield* queue.sizeByPriority()
        expect(by.high).toBe(1)
        expect(by.normal).toBe(1)
        expect(by.low).toBe(1)
        expect(yield* queue.size()).toBe(3)
        expect(yield* queue.isEmpty()).toBe(false)
        yield* queue.resume()
        yield* Ref.set(gate, true)
        yield* waitUntilProcessed(queue, 3)
        expect(yield* queue.isEmpty()).toBe(true)
      }).pipe(Effect.provide(Queue.layer))
    })
  )
})

describe("QueueResource.make — forkWith", () => {
  it.live("forkWith receives successes", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<readonly number[]>([])
      const Queue = QueueResource.make({
        name: "test/queue-fork",
        effect: (n: number) => Effect.succeed(n * 2),
        concurrency: 1,
        throttle: fastThrottle,
        forkWith: (forked, _item, _queue) =>
          forked.pipe(
            Effect.flatMap((v) => Ref.update(seen, (xs) => [...xs, v])),
            Effect.catch(() => Effect.void)
          ),
      })
      yield* Effect.gen(function* () {
        const queue = yield* Queue
        yield* queue.add(5)
        yield* waitUntilProcessed(queue, 1)
        yield* Effect.sleep(Duration.millis(20))
        expect(yield* Ref.get(seen)).toEqual([10])
      }).pipe(Effect.provide(Queue.layer))
    })
  )

  it.live("failed item effect still completes processing; forkWith can ignore", () =>
    Effect.gen(function* () {
      const Queue = QueueResource.make({
        name: "test/queue-fork-fail",
        effect: (n: number) =>
          n === 0 ? Effect.fail("bad" as const) : Effect.succeed(n),
        concurrency: 1,
        throttle: fastThrottle,
        forkWith: (forked, _item, _queue) =>
          forked.pipe(Effect.catch(() => Effect.void)),
      })
      yield* Effect.gen(function* () {
        const queue = yield* Queue
        yield* queue.add(0)
        yield* queue.add(1)
        yield* waitUntilProcessed(queue, 2)
        expect(yield* queue.getCompleted()).toBe(2)
      }).pipe(Effect.provide(Queue.layer))
    })
  )
})

describe("QueueResource.make — cache", () => {
  it.live("cache is invoked when items are added", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const Queue = QueueResource.make({
        name: "test/queue-cache",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
        throttle: fastThrottle,
        cache: (item, _queue) =>
          Effect.gen(function* () {
            const n = Array.isArray(item) ? item.length : 1
            yield* Ref.update(calls, (c) => c + n)
          }),
      })
      yield* Effect.gen(function* () {
        const queue = yield* Queue
        yield* queue.add(1)
        yield* queue.add([2, 3])
        yield* waitUntilProcessed(queue, 3)
        expect(yield* Ref.get(calls)).toBe(3)
      }).pipe(Effect.provide(Queue.layer))
    })
  )
})

describe("QueueResource.make — refill", () => {
  it.live("refill runs on cold start before any add()", () =>
    Effect.gen(function* () {
      const refills = yield* Ref.make(0)
      const Queue = QueueResource.make({
        name: "test/queue-refill-cold",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
        throttle: fastThrottle,
        // One-shot: after the queue drains, refill would run again but must not
        // re-enqueue, or the worker will spin (empty → refill → add → process…).
        refill: (p) =>
          Effect.gen(function* () {
            const n = yield* Ref.get(refills)
            if (n === 0) {
              yield* Ref.set(refills, 1)
              yield* p.add(42)
            }
          }),
      })
      yield* Effect.gen(function* () {
        const queue = yield* Queue
        // Workers start with the layer; no queue.add() — first work comes from refill.
        yield* waitUntilProcessed(queue, 1)
        expect(yield* Ref.get(refills)).toBe(1)
        expect(yield* queue.getCompleted()).toBe(1)
      }).pipe(Effect.provide(Queue.layer))
    })
  )

  it.live("refill runs when the queue becomes empty", () =>
    Effect.gen(function* () {
      const refills = yield* Ref.make(0)
      const Queue = QueueResource.make({
        name: "test/queue-refill",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
        throttle: fastThrottle,
        refill: (p) =>
          Effect.gen(function* () {
            const n = yield* Ref.get(refills)
            if (n === 0) {
              yield* Ref.set(refills, 1)
              yield* p.add(99)
            }
          }),
      })
      yield* Effect.gen(function* () {
        const queue = yield* Queue
        yield* queue.add(1)
        yield* waitUntilProcessed(queue, 2)
        expect(yield* Ref.get(refills)).toBe(1)
        expect(yield* queue.getCompleted()).toBe(2)
      }).pipe(Effect.provide(Queue.layer))
    })
  )
})

/**
 * RItem = item `effect` needs; RFork = `forkWith` needs. `cache` / `refill` are
 * typed in the public API as `R = never` on their return effect, but at runtime
 * they run in the same fiber context as the queue; merged layers supply services.
 * A few cases use `as any` on the object passed to `make` to satisfy tsc; behavior
 * under test is still runtime propagation, not the cast.
 *
 * For services used inside `cache` (forked), `Queue.layer.pipe(Layer.provideMerge(…))`
 * keeps them in the runtime `Context`. `Layer.provide(Queue.layer, X)` is enough
 * for `refill` and the item effect, which run on the worker fiber.
 */
describe("QueueResource.make — service dependencies (RItem, RFork, cache, refill)", () => {
  class Nope extends Data.TaggedError("Nope")<{ id: string }> {}

  it.live("concurrent item effects all receive the same RItem from the layer", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<readonly string[]>([])
      const Queue = QueueResource.make({
        name: "test/queue-ritem-concurrent",
        effect: (n: number) =>
          Effect.gen(function* () {
            const d = yield* ItemDeps
            yield* Ref.update(log, (xs) => [...xs, `${d.marker}:${n}`])
            return n
          }),
        concurrency: 4,
        throttle: fastThrottle,
      })
      yield* Effect.gen(function* () {
        const q = yield* Queue
        for (let k = 0; k < 10; k++) {
          yield* q.add(k)
        }
        yield* waitUntilProcessed(q, 10)
        const xs = yield* Ref.get(log)
        expect(xs.length).toBe(10)
        expect(new Set(xs.map((s) => s.startsWith("item:"))).size).toBe(1)
        expect(yield* q.getCompleted()).toBe(10)
      }).pipe(Effect.provide(Layer.provide(Queue.layer, ItemLayer)))
    })
  )

  it.live("forkWith (RFork) can require a different service when E is never", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<readonly string[]>([])
      const Queue = QueueResource.make({
        name: "test/queue-rfork-only",
        effect: (n: number) => Effect.succeed(n * 2),
        concurrency: 1,
        throttle: fastThrottle,
        forkWith: (forked) =>
          Effect.gen(function* () {
            const d = yield* ForkDeps
            const v = yield* forked
            yield* Ref.update(log, (xs) => [...xs, `${d.token}:${v}`])
          }),
      })
      yield* Effect.gen(function* () {
        const q = yield* Queue
        yield* q.add(5)
        yield* waitUntilProcessed(q, 1)
        yield* Effect.sleep(Duration.millis(50))
        expect(yield* Ref.get(log)).toEqual(["fork:10"])
      }).pipe(Effect.provide(Layer.provide(Queue.layer, ForkLayer)))
    })
  )

  it.live("RItem and RFork can point at different services in one queue", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make<readonly string[]>([])
      const Queue = QueueResource.make({
        name: "test/queue-ritem-rfork",
        effect: (n: number) =>
          Effect.gen(function* () {
            const i = yield* ItemDeps
            return `proc:${i.marker}:${n}`
          }),
        concurrency: 1,
        throttle: fastThrottle,
        forkWith: (forked) =>
          Effect.gen(function* () {
            const f = yield* ForkDeps
            const s = yield* forked
            yield* Ref.update(out, (xs) => [...xs, `fork:${f.token}:${s}`])
          }),
      })
      const deps = Layer.mergeAll(ItemLayer, ForkLayer)
      yield* Effect.gen(function* () {
        const q = yield* Queue
        yield* q.add(7)
        yield* waitUntilProcessed(q, 1)
        // forkWith runs in a child fiber; give it time to update `out`
        yield* Effect.sleep(Duration.millis(50))
        expect(yield* Ref.get(out)).toEqual(["fork:fork:proc:item:7"])
      }).pipe(Effect.provide(Layer.provide(Queue.layer, deps)))
    })
  )

  it.live("non-never E: forkWith is invoked for failure and success when RFork is provided", () =>
    Effect.gen(function* () {
        const eithers = yield* Ref.make<readonly EithRow[]>([])
        const Queue = QueueResource.make({
          name: "test/queue-rfork-either",
          effect: (n: number) => (n === 0 ? Effect.fail("boom") : Effect.succeed(n)),
          concurrency: 1,
          throttle: fastThrottle,
          forkWith: (forked) =>
            Effect.gen(function* () {
              yield* ForkDeps
              const ex = yield* Effect.exit(forked)
              if (Exit.isFailure(ex)) {
                yield* Ref.update(eithers, (xs) => [
                  ...xs,
                  { tag: "left" as const, e: String(Cause.squash(ex.cause)) },
                ])
              } else {
                yield* Ref.update(eithers, (xs) => [
                  ...xs,
                  { tag: "right" as const, n: ex.value as number },
                ])
              }
            }),
        })
        const forkLayer = Layer.provide(Queue.layer, ForkLayer)
        yield* Effect.gen(function* () {
          const q = yield* Queue
          yield* q.add(0)
          yield* q.add(3)
          yield* waitUntilProcessed(q, 2)
          yield* Effect.sleep(Duration.millis(50))
          const xs = yield* Ref.get(eithers)
          expect(xs.length).toBe(2)
          const lefts = xs.filter((r) => r.tag === "left")
          const rights = xs.filter((r) => r.tag === "right")
          expect(lefts.length).toBe(1)
          expect(rights.length).toBe(1)
          expect(lefts[0]!.e).toBe("boom")
          expect(rights[0]!.n).toBe(3)
        }).pipe(Effect.provide(forkLayer))
    })
  )

  it.live("tagged E: forkWith uses RFork and records failure and success", () =>
    Effect.gen(function* () {
      const flags = yield* Ref.make<readonly string[]>([])
      const Queue = QueueResource.make({
        name: "test/queue-rfork-tagged",
        effect: (n: number) =>
          n < 0 ? Effect.fail(new Nope({ id: "x" })) : Effect.succeed(n),
        concurrency: 1,
        throttle: fastThrottle,
        forkWith: (forked) =>
          Effect.gen(function* () {
            const d = yield* ForkDeps
            const ex = yield* Effect.exit(forked)
            if (Exit.isFailure(ex)) {
              yield* Ref.update(
                flags,
                (fs) => [...fs, `fork+${d.token}+fail`],
              )
            } else if (Exit.isSuccess(ex)) {
              yield* Ref.update(
                flags,
                (fs) => [...fs, `fork+${d.token}+ok:${ex.value}`],
              )
            }
          }),
      })
      const forkLayer = Layer.provide(Queue.layer, ForkLayer)
      yield* Effect.gen(function* () {
        const q = yield* Queue
        yield* q.add(-1)
        yield* q.add(5)
        yield* waitUntilProcessed(q, 2)
        yield* Effect.sleep(Duration.millis(50))
        const fs = yield* Ref.get(flags)
        expect(fs.filter((f) => f.includes("ok"))).toEqual([
          "fork+fork+ok:5",
        ])
        expect(fs.filter((f) => f.includes("fail")).length).toBe(1)
      }).pipe(Effect.provide(forkLayer))
    })
  )

  it.live("cache callback can use a service from a merged layer (runtime R)", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<readonly string[]>([])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfg: any = {
        name: "test/queue-cache-r",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
        throttle: fastThrottle,
        cache: (item: number | readonly number[], _q: never) =>
          Effect.gen(function* () {
            const c = yield* CacheDeps
            const n = Array.isArray(item) ? item.length : 1
            yield* Ref.update(
              log,
              (xs) => [...xs, `${c.prefix}:n${n}`],
            )
          }),
      }
      const Queue = QueueResource.make(cfg)
      yield* Effect.gen(function* () {
        const q = yield* Queue
        yield* q.add(1)
        yield* q.add([2, 3, 4])
        yield* waitUntilProcessed(q, 4)
        // Cache runs in a fork; wait for the forked work to log
        yield* Effect.sleep(Duration.millis(50))
        expect(
          Array.from(yield* Ref.get(log))
            .slice()
            .sort(),
        ).toEqual(["cache:n1", "cache:n3"].slice().sort())
      }).pipe(
        Effect.provide(Queue.layer.pipe(Layer.provideMerge(CacheLayer))),
      )
    })
  )

  it.live("refill callback can use a service from a merged layer (runtime R)", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<readonly string[]>([])
      const refilled = yield* Ref.make(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfg: any = {
        name: "test/queue-refill-r",
        effect: (_n: number) => Effect.void,
        concurrency: 1,
        throttle: fastThrottle,
        refill: (p: { add: (n: number) => IO.Effect<void> }) =>
          Effect.gen(function* () {
            const r = yield* Ref.get(refilled)
            if (r > 0) {
              return
            }
            yield* Ref.set(refilled, 1)
            const s = yield* RefillDeps
            yield* Ref.update(
              log,
              (xs) => [...xs, `from=${s.source}`],
            )
            yield* p.add(1)
          }),
      }
      const Queue = QueueResource.make(cfg)
      yield* Effect.gen(function* () {
        const q = yield* Queue
        yield* waitUntilProcessed(q, 1)
        expect(yield* Ref.get(log)).toEqual(["from=refill"])
      }).pipe(Effect.provide(Layer.provide(Queue.layer, RefillLayer)))
    })
  )

  it.live("RItem in effect + R in cache: both from merged context", () =>
    Effect.gen(function* () {
      const cacheLog = yield* Ref.make<readonly string[]>([])
      const itemLog = yield* Ref.make<readonly string[]>([])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfg: any = {
        name: "test/queue-ritem-cache",
        effect: (n: number) =>
          Effect.gen(function* () {
            const i = yield* ItemDeps
            yield* Ref.update(
              itemLog,
              (xs) => [...xs, `${i.marker}@${n}`],
            )
            return n
          }),
        concurrency: 1,
        throttle: fastThrottle,
        cache: (item: number | readonly number[], _q: never) =>
          Effect.gen(function* () {
            const c = yield* CacheDeps
            const n = Array.isArray(item) ? item.length : 1
            yield* Ref.update(
              cacheLog,
              (xs) => [...xs, `${c.prefix}*${n}`],
            )
          }),
      }
      const Queue = QueueResource.make(cfg)
      yield* Effect.gen(function* () {
        const q = yield* Queue
        yield* q.add(9)
        yield* waitUntilProcessed(q, 1)
        // cache logs in a fork; item runs in worker
        yield* Effect.sleep(Duration.millis(30))
        expect(yield* Ref.get(cacheLog)).toEqual(["cache*1"])
        expect(yield* Ref.get(itemLog)).toEqual(["item@9"])
      }).pipe(
        Effect.provide(
          Queue.layer.pipe(
            Layer.provideMerge(Layer.mergeAll(ItemLayer, CacheLayer)),
          ),
        ),
      )
    })
  )

  it.live("RItem, RFork, cache, and refill each see their own service in one program", () =>
    Effect.gen(function* () {
      const trace = yield* Ref.make<readonly string[]>([])
      const didRefill = yield* Ref.make(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfg: any = {
        name: "test/queue-full-stack-deps",
        effect: (n: number) =>
          Effect.gen(function* () {
            const i = yield* ItemDeps
            return `${i.marker}:${n}`
          }),
        concurrency: 1,
        throttle: fastThrottle,
        cache: (item: number | readonly number[], _q: never) =>
          Effect.gen(function* () {
            const c = yield* CacheDeps
            const k = Array.isArray(item) ? `arr:${item.length}` : `one:${item}`
            yield* Ref.update(trace, (xs) => [...xs, `cache=${c.prefix}:${k}`])
          }),
        forkWith: (forked: IO.Effect<string, never>) =>
          Effect.gen(function* () {
            const f = yield* ForkDeps
            const s = yield* forked
            yield* Ref.update(
              trace,
              (xs) => [...xs, `fork=${f.token}:${s}`],
            )
          }),
        refill: (p: { add: (n: number) => IO.Effect<void> }) =>
          Effect.gen(function* () {
            const d = yield* Ref.get(didRefill)
            if (d > 0) {
              return
            }
            yield* Ref.set(didRefill, 1)
            const r = yield* RefillDeps
            yield* Ref.update(
              trace,
              (xs) => [...xs, `refill=${r.source}`],
            )
            yield* p.add(0)
          }),
      }
      const Queue = QueueResource.make(cfg)
      yield* Effect.gen(function* () {
        const q = yield* Queue
        // Cold start: refill enqueues; item runs with Item; cache skipped for refill
        yield* waitUntilProcessed(q, 1)
        yield* Effect.sleep(Duration.millis(50))
        const t1 = yield* Ref.get(trace)
        expect(
          t1.find((l) => l === "refill=refill") !== undefined
        )
        expect(
          t1.find((l) => l === "fork=fork:item:0") !== undefined
        )
        // User add: cache + process + fork
        yield* q.add(1)
        yield* waitUntilProcessed(q, 2)
        yield* Effect.sleep(Duration.millis(50))
        const t2 = (yield* Ref.get(trace)) as string[]
        expect(
          t2.find((l) => l.startsWith("cache=cache:one:1")) !== undefined
        )
        expect(
          t2.find((l) => l === "fork=fork:item:1") !== undefined
        )
      }).pipe(
        Effect.provide(
          Layer.provide(
            Queue.layer,
            Layer.mergeAll(
              ItemLayer,
              ForkLayer,
              CacheLayer,
              RefillLayer,
            ),
          ),
        ),
      )
    })
  )
})
