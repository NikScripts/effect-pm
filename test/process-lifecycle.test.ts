import { ProcessStorage } from "../src/ProcessStorage";
import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect } from "effect"
import { ProcessLifecycleScope } from "../src/ProcessLifecycleScope"
import { ProcessLifecycleStore } from "../src/store/processLifecycle"

const started = (processId: string) =>
  ProcessLifecycleScope.run({ processId }, ProcessLifecycleStore.Lifecycle.Started)

const stopped = (processId: string) =>
  ProcessLifecycleScope.run({ processId }, ProcessLifecycleStore.Lifecycle.Stopped)

describe("ProcessLifecycleStore", () => {
  it.effect("Lifecycle.* + lifecycle round-trip via ProcessStorage.layer", () =>
    Effect.gen(function* () {
      yield* started("billing/sync")
      yield* stopped("billing/sync")

      const lifecycle = yield* ProcessLifecycleStore
      const rows = yield* lifecycle.lifecycle("billing/sync")
      expect(rows.map((row) => row.lifecycle.tag)).toEqual(["Stopped", "Started"])
    }).pipe(Effect.provide(ProcessStorage.layer)),
  )

  it.live("latestLifecycleByProcess returns newest tag per process id", () =>
    Effect.gen(function* () {
      yield* started("p1")
      yield* Effect.sleep(Duration.millis(2))
      yield* stopped("p1")
      yield* started("p2")

      const lifecycle = yield* ProcessLifecycleStore
      const latest = yield* lifecycle.latestLifecycleByProcess(["p1", "p2", "missing"])
      expect(latest.get("p1")).toBe("Stopped")
      expect(latest.get("p2")).toBe("Started")
      expect(latest.has("missing")).toBe(false)
    }).pipe(Effect.provide(ProcessStorage.layer)),
  )

  it.live("static Lifecycle.* no-ops when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* started("absent")
      expect(true).toBe(true)
    }),
  )

  it.effect("facet-only layer supports writes without the monolith tag", () =>
    Effect.gen(function* () {
      yield* started("facet-only")
      const lifecycle = yield* ProcessLifecycleStore
      const rows = yield* lifecycle.lifecycle("facet-only")
      expect(rows.map((row) => row.lifecycle.tag)).toEqual(["Started"])
    }).pipe(Effect.provide(ProcessLifecycleStore.layer)),
  )
})
