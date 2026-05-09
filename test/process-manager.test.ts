import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Fiber, Ref } from "effect"
import { ProcessManager, ProcessStore } from "../src"
import type { Process } from "../src"

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
  type: "scheduled",
  effect: Effect.forever(
    Effect.sleep(Duration.millis(20)).pipe(
      Effect.andThen(Ref.update(ticks, (n) => n + 1)),
    ),
  ),
  getStatus: () =>
    Effect.succeed({
      lastRun: null,
      executions: 0,
      nextRun: new Date(),
      firstStartup: null,
    }),
  runImmediately: () => Effect.void,
})

describe("ProcessManager — process lifecycle", () => {
  it.live("started process keeps running after start caller fiber exits", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0)
      const process = makeTickProcess("test/pm-lifecycle", ticks)

      const pm = yield* ProcessManager.make({
        queues: [],
        processes: [process],
      })

      const fiber = yield* Effect.forkChild(pm.startProcess(process.name))
      yield* Fiber.join(fiber)

      yield* waitUntilTicked(ticks)

      expect(yield* Ref.get(ticks)).toBeGreaterThan(0)
      yield* pm.stopProcess(process.name)
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("stopProcess closes the process scope and stops future work", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0)
      const process = makeTickProcess("test/pm-stop-lifecycle", ticks)
      const pm = yield* ProcessManager.make({
        queues: [],
        processes: [process],
      })

      yield* pm.startProcess(process.name)
      yield* waitUntilTicked(ticks)
      yield* pm.stopProcess(process.name)

      const stoppedAt = yield* Ref.get(ticks)
      yield* Effect.sleep(Duration.millis(80))
      expect(yield* Ref.get(ticks)).toBe(stoppedAt)
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("writes lifecycle events to ProcessStore when provided", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0)
      const process = makeTickProcess("test/pm-store-lifecycle", ticks)
      const pm = yield* ProcessManager.make({
        queues: [],
        processes: [process],
      })

      yield* pm.startProcess(process.name)
      yield* waitUntilTicked(ticks)
      yield* pm.stopProcess(process.name)

      const store = yield* ProcessStore
      const history = yield* store.getProcessLifecycle(process.name)
      expect(history.map((row) => row.lifecycle.tag)).toEqual(["Stopped", "Started"])
    }).pipe(Effect.provide(ProcessStore.layer)),
  )
})
