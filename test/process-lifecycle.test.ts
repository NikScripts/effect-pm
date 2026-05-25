import { ProcessStorage } from "../src/ProcessStorage";
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ProcessStoreProcessLifecycle } from "../src/store/processLifecycle"

describe("ProcessStoreProcessLifecycle", () => {
  it.effect("lifecycleChanged + lifecycle round-trip via ProcessStorage.layer", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessLifecycle.lifecycleChanged({
        processId: "billing/sync",
        tag: "Started",
      })
      yield* ProcessStoreProcessLifecycle.lifecycleChanged({
        processId: "billing/sync",
        tag: "Stopped",
      })

      const lifecycle = yield* ProcessStoreProcessLifecycle
      const rows = yield* lifecycle.lifecycle("billing/sync")
      expect(rows.map((row) => row.lifecycle.tag)).toEqual(["Stopped", "Started"])
    }).pipe(Effect.provide(ProcessStorage.layer)),
  )

  it.effect("latestLifecycleByProcess returns newest tag per process id", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessLifecycle.lifecycleChanged({ processId: "p1", tag: "Started" })
      yield* ProcessStoreProcessLifecycle.lifecycleChanged({ processId: "p1", tag: "Stopped" })
      yield* ProcessStoreProcessLifecycle.lifecycleChanged({ processId: "p2", tag: "Started" })

      const lifecycle = yield* ProcessStoreProcessLifecycle
      const latest = yield* lifecycle.latestLifecycleByProcess(["p1", "p2", "missing"])
      expect(latest.get("p1")).toBe("Stopped")
      expect(latest.get("p2")).toBe("Started")
      expect(latest.has("missing")).toBe(false)
    }).pipe(Effect.provide(ProcessStorage.layer)),
  )

  it.live("static lifecycleChanged no-ops when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessLifecycle.lifecycleChanged({
        processId: "absent",
        tag: "Started",
      })
      expect(true).toBe(true)
    }),
  )

  it.effect("facet-only layer supports writes without the monolith tag", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessLifecycle.lifecycleChanged({
        processId: "facet-only",
        tag: "Started",
      })
      const lifecycle = yield* ProcessStoreProcessLifecycle
      const rows = yield* lifecycle.lifecycle("facet-only")
      expect(rows.map((row) => row.lifecycle.tag)).toEqual(["Started"])
    }).pipe(Effect.provide(ProcessStoreProcessLifecycle.layer)),
  )
})
