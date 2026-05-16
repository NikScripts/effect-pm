import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  ProcessStore,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleChangedEvent,
} from "../src"
import { provideLayer } from "../src/provideLayer.js"
import { utcDateFromIso } from "../src/utcDate.js";

describe("ProcessStore.memory", () => {
  it.live("appends and queries process execution events with ordering and query opts", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore

      const t1 = utcDateFromIso("2026-01-01T00:00:00.000Z").getTime()
      const t2 = utcDateFromIso("2026-01-01T00:10:00.000Z").getTime()
      const t3 = utcDateFromIso("2026-01-01T00:20:00.000Z").getTime()

      const e1: ProcessExecutionCompletedEvent = {
        id: "e1",
        type: "process.execution.completed",
        occurredAt: t1,
        entityType: "process",
        entityId: "p1",
        execution: {
          scheduleKey: null,
          startedAt: t1,
          completedAt: t1,
          durationMs: 10,
          status: "completed",
          isStartupRun: true,
        },
      }
      const e2: ProcessExecutionCompletedEvent = {
        id: "e2",
        type: "process.execution.completed",
        occurredAt: t2,
        entityType: "process",
        entityId: "p1",
        execution: {
          scheduleKey: "live",
          startedAt: t2,
          completedAt: t2,
          durationMs: 11,
          status: "failed",
          error: "boom",
          isStartupRun: false,
        },
      }
      const e3: ProcessExecutionCompletedEvent = {
        id: "e3",
        type: "process.execution.completed",
        occurredAt: t3,
        entityType: "process",
        entityId: "p1",
        execution: {
          scheduleKey: "idle",
          startedAt: t3,
          completedAt: t3,
          durationMs: 12,
          status: "completed",
          isStartupRun: false,
        },
      }

      yield* store.appendBatch([e1, e2, e3])

      const all = yield* store.getProcessExecutions("p1")
      expect(all.map((row) => row.id)).toEqual(["e3", "e2", "e1"])

      const limited = yield* store.getProcessExecutions("p1", { limit: 2 })
      expect(limited.map((row) => row.id)).toEqual(["e3", "e2"])

      const before = yield* store.getProcessExecutions("p1", { before: t3 })
      expect(before.map((row) => row.id)).toEqual(["e2", "e1"])

      const after = yield* store.getProcessExecutions("p1", { after: t1 })
      expect(after.map((row) => row.id)).toEqual(["e3", "e2"])
    }).pipe(provideLayer(ProcessStore.layer)),
  )

  it.live("orders process executions by event occurrence time", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore

      const earlyStart = utcDateFromIso("2026-01-01T00:00:00.000Z").getTime()
      const lateStart = utcDateFromIso("2026-01-01T00:10:00.000Z").getTime()
      const earlyCompletion = utcDateFromIso("2026-01-01T00:11:00.000Z").getTime()
      const lateCompletion = utcDateFromIso("2026-01-01T00:12:00.000Z").getTime()

      yield* store.appendBatch([
        {
          id: "long-run",
          type: "process.execution.completed",
          occurredAt: lateCompletion,
          entityType: "process",
          entityId: "p-overlap",
          execution: {
            scheduleKey: "live",
            startedAt: earlyStart,
            completedAt: lateCompletion,
            durationMs: lateCompletion - earlyStart,
            status: "completed",
            isStartupRun: false,
          },
        },
        {
          id: "short-run",
          type: "process.execution.completed",
          occurredAt: earlyCompletion,
          entityType: "process",
          entityId: "p-overlap",
          execution: {
            scheduleKey: "live",
            startedAt: lateStart,
            completedAt: earlyCompletion,
            durationMs: earlyCompletion - lateStart,
            status: "completed",
            isStartupRun: false,
          },
        },
      ])

      const all = yield* store.getProcessExecutions("p-overlap")
      expect(all.map((row) => row.id)).toEqual(["long-run", "short-run"])

      const beforeLateCompletion = yield* store.getProcessExecutions("p-overlap", {
        before: lateCompletion,
      })
      expect(beforeLateCompletion.map((row) => row.id)).toEqual(["short-run"])
    }).pipe(provideLayer(ProcessStore.layer)),
  )

  it.live("appends and queries process lifecycle events", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore
      const t1 = utcDateFromIso("2026-01-01T01:00:00.000Z").getTime()
      const t2 = utcDateFromIso("2026-01-01T02:00:00.000Z").getTime()

      const started: ProcessLifecycleChangedEvent = {
        id: "l1",
        type: "process.lifecycle.changed",
        occurredAt: t1,
        entityType: "process",
        entityId: "p2",
        lifecycle: { tag: "Started" },
      }
      const stopped: ProcessLifecycleChangedEvent = {
        id: "l2",
        type: "process.lifecycle.changed",
        occurredAt: t2,
        entityType: "process",
        entityId: "p2",
        lifecycle: { tag: "Stopped" },
      }

      yield* store.append(started)
      yield* store.append(stopped)

      const rows = yield* store.getProcessLifecycle("p2")
      expect(rows.map((row) => row.lifecycle.tag)).toEqual(["Stopped", "Started"])

      const limited = yield* store.getProcessLifecycle("p2", { limit: 1 })
      expect(limited.length).toBe(1)
      expect(limited[0]?.lifecycle.tag).toBe("Stopped")
    }).pipe(provideLayer(ProcessStore.layer)),
  )

  it.live("queries generic events with type and entity filters", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore
      const t1 = utcDateFromIso("2026-01-01T03:00:00.000Z").getTime()
      const t2 = utcDateFromIso("2026-01-01T03:10:00.000Z").getTime()

      yield* store.appendBatch([
        {
          id: "runtime-started",
          type: "runtime.fact.recorded",
          occurredAt: t1,
          entityType: "run-resource",
          entityId: "@test/RunGate",
          fact: {
            id: "run-1/start",
            ref: { kind: "run-resource", id: "@test/RunGate" },
            type: "run-resource.run.started",
            occurredAt: t1,
            payload: { concurrency: 1 },
          },
        },
        {
          id: "runtime-completed",
          type: "runtime.fact.recorded",
          occurredAt: t2,
          entityType: "run-resource",
          entityId: "@test/RunGate",
          fact: {
            id: "run-1/completed",
            ref: { kind: "run-resource", id: "@test/RunGate" },
            type: "run-resource.run.completed",
            occurredAt: t2,
            payload: { durationMs: 10 },
          },
        },
      ])

      const rows = yield* store.events({
        entityType: "run-resource",
        entityId: "@test/RunGate",
        types: ["runtime.fact.recorded"],
        opts: { limit: 1 },
      })

      expect(rows.map((row) => row.id)).toEqual(["runtime-completed"])
    }).pipe(provideLayer(ProcessStore.layer)),
  )
})
