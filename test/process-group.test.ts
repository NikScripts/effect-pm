import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Fiber, Option, Ref } from "effect"
import { ProcessGroup, ProcessStore } from "../src"
import type { Process, ProcessDetails } from "../src"

const waitUntilTicked = (ticks: Ref.Ref<number>) =>
  Effect.gen(function* () {
    while ((yield* Ref.get(ticks)) === 0) {
      yield* Effect.sleep(Duration.millis(5))
    }
  }).pipe(Effect.timeout(Duration.seconds(1)))

const makeTickProcess = (
  name: string,
  ticks: Ref.Ref<number>,
): Process<never> => ({
  name,
  type: "managed",
  effect: Effect.forever(
    Effect.sleep(Duration.millis(20)).pipe(
      Effect.andThen(Ref.update(ticks, (n) => n + 1)),
    ),
  ),
  getStatus: () =>
    Effect.succeed({
      lastRun: null,
      executions: 0,
      firstStartup: null,
      armed: false,
      nextScheduleTransition: Option.none(),
      nextPollCadence: Option.none(),
      activeInstances: 0,
      nextTriggerRun: Option.none(),
    } satisfies ProcessDetails),
  runImmediately: () => Effect.void,
})

describe("ProcessGroup — process lifecycle", () => {
  /**
   * Tests in this block use explicit in-memory {@link ProcessStore.layer}.
   * Lifecycle rows are not durable across restarts. For sqlite-backed history,
   * provide `layerProcessStore` (see ProcessGroup.localEnvLayer TSDoc).
   */

  it.live("started process keeps running after start caller fiber exits", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0)
      const process = makeTickProcess("test/pg-lifecycle", ticks)

      const group = yield* ProcessGroup.make({
        queues: [],
        processes: [process],
      })

      const fiber = yield* Effect.forkChild(group.start(process.name))
      yield* Fiber.join(fiber)

      yield* waitUntilTicked(ticks)

      expect(yield* Ref.get(ticks)).toBeGreaterThan(0)
      yield* group.stop(process.name)
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("stop closes the process scope and stops future work", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0)
      const process = makeTickProcess("test/pg-stop-lifecycle", ticks)
      const group = yield* ProcessGroup.make({
        queues: [],
        processes: [process],
      })

      yield* group.start(process.name)
      yield* waitUntilTicked(ticks)
      yield* group.stop(process.name)

      const stoppedAt = yield* Ref.get(ticks)
      yield* Effect.sleep(Duration.millis(80))
      expect(yield* Ref.get(ticks)).toBe(stoppedAt)
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("writes lifecycle events to ProcessStore when provided", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0)
      const process = makeTickProcess("test/pg-store-lifecycle", ticks)
      const group = yield* ProcessGroup.make({
        queues: [],
        processes: [process],
      })

      yield* group.start(process.name)
      yield* waitUntilTicked(ticks)
      yield* group.stop(process.name)

      const store = yield* ProcessStore
      const history = yield* store.getProcessLifecycle(process.name)
      // Events are appended after each control; newest-first query order → Stopped before Started
      expect(history.map((row) => row.lifecycle.tag)).toEqual(["Stopped", "Started"])
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("restart on a running process writes Stopped, Started, and Restarted", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0)
      const process = makeTickProcess("test/pg-restart-lifecycle", ticks)
      const group = yield* ProcessGroup.make({
        queues: [],
        processes: [process],
      })

      yield* group.start(process.name)
      yield* waitUntilTicked(ticks)
      yield* group.restart(process.name)
      yield* waitUntilTicked(ticks)
      yield* group.stop(process.name)

      const store = yield* ProcessStore
      const history = yield* store.getProcessLifecycle(process.name)
      const tags = history.map((row) => row.lifecycle.tag)
      expect(tags.filter((tag) => tag === "Started")).toHaveLength(2)
      expect(tags.filter((tag) => tag === "Stopped")).toHaveLength(2)
      expect(tags.filter((tag) => tag === "Restarted")).toHaveLength(1)
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("lifecycle recording is a no-op when ProcessStore is absent", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0)
      const process = makeTickProcess("test/pg-no-store-lifecycle", ticks)
      const group = yield* ProcessGroup.make({
        queues: [],
        processes: [process],
      })

      // Controls must succeed without analytics storage in context
      yield* group.start(process.name)
      yield* waitUntilTicked(ticks)
      yield* group.stop(process.name)

      const storeOption = yield* Effect.serviceOption(ProcessStore)
      expect(storeOption._tag).toBe("None")
    }),
  )
})
