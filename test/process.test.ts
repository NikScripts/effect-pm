import { describe, expect, it } from "@effect/vitest"
import { Cron, Effect } from "effect"
import { Process, ProcessStore } from "../src"

describe("Process.make — ProcessStore integration", () => {
  it.live("records successful runImmediately executions when ProcessStore is provided", () => {
    const proc = Process.make({
      name: "test/process-store-success",
      crons: Cron.make({
        seconds: [0],
        minutes: [],
        hours: [],
        days: [],
        months: [],
        weekdays: [],
      }),
      effect: Effect.void,
    })

    return Effect.gen(function* () {
      yield* proc.runImmediately()
      const store = yield* ProcessStore
      const rows = yield* store.getProcessExecutions(proc.name)
      expect(rows.length).toBe(1)
      expect(rows[0]?.execution.status).toBe("completed")
    }).pipe(Effect.provide(ProcessStore.layer))
  })

  it.live("ProcessStore supports direct lifecycle and execution queries", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore
      const now = new Date("2026-01-01T00:00:00.000Z")

      yield* store.append({
        id: "lifecycle-1",
        type: "process.lifecycle.changed",
        occurredAt: now,
        entityType: "process",
        entityId: "p-direct",
        lifecycle: { tag: "Started" },
      })
      yield* store.append({
        id: "execution-1",
        type: "process.execution.completed",
        occurredAt: now,
        entityType: "process",
        entityId: "p-direct",
        execution: {
          scheduleKey: null,
          startedAt: now,
          completedAt: now,
          durationMs: 0,
          status: "completed",
          isStartupRun: true,
        },
      })

      const lifecycle = yield* store.getProcessLifecycle("p-direct")
      const executions = yield* store.getProcessExecutions("p-direct")
      expect(lifecycle.map((row) => row.lifecycle.tag)).toEqual(["Started"])
      expect(executions.map((row) => row.id)).toEqual(["execution-1"])
    }).pipe(Effect.provide(ProcessStore.layer)),
  )
})

