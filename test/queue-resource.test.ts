import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Ref } from "effect"
import type { QueueResourceInterface } from "../src"
import { QueueResource } from "../src"

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
