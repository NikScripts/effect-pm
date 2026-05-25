import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { ProcessStore } from "../src/ProcessStore"
import { ProcessStoreProcessLifecycle } from "../src/store/processLifecycle"

describe("ProcessStoreProcessLifecycle", () => {
  it.effect("lifecycleChanged + lifecycle round-trip via ProcessStore.layer", () =>
    Effect.gen(function* () {
      const lifecycle = yield* ProcessStoreProcessLifecycle
      yield* lifecycle.lifecycleChanged({ processId: "billing/sync", tag: "Started" })
      yield* lifecycle.lifecycleChanged({ processId: "billing/sync", tag: "Stopped" })

      const rows = yield* lifecycle.lifecycle("billing/sync")
      expect(rows.map((row) => row.lifecycle.tag)).toEqual(["Stopped", "Started"])

      const store = yield* ProcessStore
      const viaMonolith = yield* store.getProcessLifecycle("billing/sync")
      expect(viaMonolith.map((row) => row.lifecycle.tag)).toEqual(["Stopped", "Started"])
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.effect("lifecycleByGroup filters attributes.groupId", () =>
    Effect.gen(function* () {
      const lifecycle = yield* ProcessStoreProcessLifecycle
      yield* lifecycle.lifecycleChanged({
        processId: "p-a",
        tag: "Started",
        groupId: "@test/BillingGroup",
      })
      yield* lifecycle.lifecycleChanged({
        processId: "p-b",
        tag: "Started",
        groupId: "@test/OtherGroup",
      })

      const billing = yield* lifecycle.lifecycleByGroup("@test/BillingGroup")
      expect(billing.map((row) => row.entityId)).toEqual(["p-a"])
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.effect("latestLifecycleByProcess returns newest tag per process id", () =>
    Effect.gen(function* () {
      const lifecycle = yield* ProcessStoreProcessLifecycle
      yield* lifecycle.lifecycleChanged({ processId: "p1", tag: "Started" })
      yield* lifecycle.lifecycleChanged({ processId: "p1", tag: "Stopped" })
      yield* lifecycle.lifecycleChanged({ processId: "p2", tag: "Started" })

      const latest = yield* lifecycle.latestLifecycleByProcess(["p1", "p2", "missing"])
      expect(latest.get("p1")).toBe("Stopped")
      expect(latest.get("p2")).toBe("Started")
      expect(latest.has("missing")).toBe(false)
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.effect("is a no-op when the facet layer is absent", () =>
    Effect.gen(function* () {
      const lifecycleOption = yield* Effect.serviceOption(ProcessStoreProcessLifecycle);
      expect(lifecycleOption._tag).toBe("None");
    }),
  )

  it.effect("facet-only layer supports writes without the monolith tag", () =>
    Effect.gen(function* () {
      const lifecycleOption = yield* Effect.serviceOption(ProcessStoreProcessLifecycle);
      if (Option.isNone(lifecycleOption)) {
        return yield* Effect.die("expected facet layer");
      }
      yield* lifecycleOption.value.lifecycleChanged({ processId: "facet-only", tag: "Started" });
      const rows = yield* lifecycleOption.value.lifecycle("facet-only");
      expect(rows.map((row) => row.lifecycle.tag)).toEqual(["Started"]);

      const monolith = yield* Effect.serviceOption(ProcessStore);
      expect(monolith._tag).toBe("None");
    }).pipe(Effect.provide(ProcessStoreProcessLifecycle.layer)),
  )
})
