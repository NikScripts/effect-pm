import { describe, expect, it } from "@effect/vitest"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import { Clock, DateTime, Effect, FileSystem, Layer, Option, Path, pipe } from "effect"
import {
  Occurred,
  OrderBy,
  ProcessId,
  ProcessStore,
  ProcessStoreQueueResource,
  ProcessStoreDuplicateRecordError,
  RuntimeStorage,
  Select,
  SubjectId,
  Where,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleChangedEvent,
  type ProcessStoreInterface,
  type QueueItemCompletedEvent,
  type QueueLifecycleChangedEvent,
  type RuntimeStateChangedEvent,
} from "../src"
import { utcDateFromIso } from "../src/utcDate.js";

describe("ProcessStore.memory", () => {
  it.live("maps RuntimeStorage duplicate writes to ProcessStore errors", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore.memory
      const event: ProcessLifecycleChangedEvent = {
        id: "duplicate-store-event",
        type: "process.lifecycle.changed",
        occurredAt: utcDateFromIso("2026-01-01T00:00:00.000Z").getTime(),
        entityType: "process",
        entityId: "p-duplicate",
        lifecycle: { tag: "Started" },
      }

      yield* store.append(event)
      const duplicate = yield* Effect.flip(store.append(event))

      expect(duplicate).toBeInstanceOf(ProcessStoreDuplicateRecordError)
      expect(duplicate.id).toBe("duplicate-store-event")
    }),
  )

  it.live("appends and queries process execution events with ordering and query opts", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore.memory

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
    }),
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
    }).pipe(Effect.provide(ProcessStore.layer)),
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
    }).pipe(Effect.provide(ProcessStore.layer)),
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
      const runtimeFacts = yield* ProcessStore.runtime.facts({
        ref: { kind: "run-resource", id: "@test/RunGate" },
        types: ["run-resource.run.completed"],
        opts: { limit: 1 },
      })
      const runHistory = yield* ProcessStore.runResource.history("@test/RunGate")

      expect(rows.map((row) => row.id)).toEqual(["runtime-completed"])
      expect(runtimeFacts.map((fact) => fact.id)).toEqual(["run-1/completed"])
      expect(runHistory.map((fact) => fact.id)).toEqual([
        "run-1/completed",
        "run-1/start",
      ])
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("projects appended events through generic runtime records", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore
      const t1 = utcDateFromIso("2026-01-01T03:30:00.000Z").getTime()
      const t2 = utcDateFromIso("2026-01-01T03:40:00.000Z").getTime()

      yield* store.appendBatch([
        {
          id: "record-process-started",
          type: "process.lifecycle.changed",
          occurredAt: t1,
          entityType: "process",
          entityId: "@test/RecordProcess",
          lifecycle: { tag: "Started" },
        },
        {
          id: "record-process-stopped",
          type: "process.lifecycle.changed",
          occurredAt: t2,
          entityType: "process",
          entityId: "@test/RecordProcess",
          lifecycle: { tag: "Stopped" },
        },
      ])

      const rows = yield* store.records({
        predicate: ProcessId.equals("@test/RecordProcess"),
      })
      const projectedEvents = yield* store.events({
        entityType: "process",
        entityId: "@test/RecordProcess",
        types: ["process.lifecycle.changed"],
      })
      const source: Effect.Effect<ProcessStoreInterface, never, never> = Effect.succeed(store)
      const pipedRows = yield* pipe(
        source,
        Where(
          ProcessId.equals("@test/RecordProcess"),
          Occurred.after(DateTime.makeUnsafe("2026-01-01T03:35:00.000Z")),
        ),
        OrderBy.occurredAt,
        Select,
      )

      expect(rows.map((row) => row.id)).toEqual([
        "record-process-stopped",
        "record-process-started",
      ])
      expect(rows[0]?.processType).toBe("process")
      expect(rows[0]?.processId).toBe("@test/RecordProcess")
      expect(rows[0]?.runId).toContain("run-")
      expect(rows[0]?.payload).toEqual({ tag: "Stopped" })
      expect(projectedEvents.map((row) => row.id)).toEqual([
        "record-process-stopped",
        "record-process-started",
      ])
      expect(pipedRows.map((row) => row.id)).toEqual(["record-process-stopped"])
      expect(yield* store.records({ predicate: SubjectId.isNull })).toHaveLength(2)
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("records queue resource facts with ambient context", () =>
    Effect.gen(function* () {
      const first = DateTime.makeUnsafe("2026-01-01T03:50:00.000Z")
      const second = DateTime.makeUnsafe("2026-01-01T03:51:00.000Z")

      yield* ProcessStoreQueueResource.withQueue(
        "email-queue",
        ProcessStoreQueueResource.withBatch(
          "batch-1",
          Effect.all(
            [
              ProcessStoreQueueResource.withEntry(
                "entry-1",
                ProcessStoreQueueResource.entryEnqueued({
                  key: "delivery-1",
                  priority: "high",
                  occurredAt: first,
                }),
              ),
              ProcessStoreQueueResource.withEntry(
                "entry-1",
                ProcessStoreQueueResource.entryCompleted({
                  key: "delivery-1",
                  priority: "high",
                  attempts: 1,
                  durationMs: 8,
                  occurredAt: second,
                }),
              ),
              ProcessStoreQueueResource.withDedupeKey(
                "delivery-1",
                ProcessStoreQueueResource.dedupeKeyAdded({ occurredAt: first }),
              ),
            ],
            { discard: true },
          ),
        ),
      )

      const entries = yield* ProcessStoreQueueResource.entries("email-queue")
      const byKey = yield* ProcessStoreQueueResource.entriesByKey("delivery-1")
      const entry = yield* ProcessStoreQueueResource.entry("entry-1")
      const dedupeKeys = yield* ProcessStoreQueueResource.dedupeKeys("email-queue")

      expect(entries.map((row) => row.type)).toEqual([
        "queue.entry.completed",
        "queue.entry.enqueued",
      ])
      expect(entries[0]?.processType).toBe("queue-resource")
      expect(entries[0]?.processId).toBe("email-queue")
      expect(entries[0]?.subjectType).toBe("queue-entry")
      expect(entries[0]?.subjectId).toBe("entry-1")
      expect(entries[0]?.key).toBe("delivery-1")
      expect(entries[0]?.indexA).toBe("batch-1")
      expect(entries[0]?.indexNames).toEqual(["batchId", "releaseId"])
      expect(entries[0]?.payload).toEqual({
        status: "completed",
        priority: "high",
        attempts: 1,
        durationMs: 8,
      })
      expect(byKey).toHaveLength(2)
      expect(Option.isSome(entry)).toBe(true)
      expect(dedupeKeys.map((row) => row.type)).toEqual(["queue.dedupe-key.added"])
      expect(dedupeKeys[0]?.key).toBe("delivery-1")
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("can be backed by an injected RuntimeStorage layer", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore
      yield* store.append({
        id: "runtime-backed-started",
        type: "process.lifecycle.changed",
        occurredAt: utcDateFromIso("2026-01-01T03:55:00.000Z").getTime(),
        entityType: "process",
        entityId: "@test/RuntimeBackedProcess",
        lifecycle: { tag: "Started" },
      })

      const records = yield* store.records({
        predicate: ProcessId.equals("@test/RuntimeBackedProcess"),
      })
      const events = yield* store.events({
        entityType: "process",
        entityId: "@test/RuntimeBackedProcess",
      })

      expect(records.map((row) => row.id)).toEqual(["runtime-backed-started"])
      expect(events.map((event) => event.id)).toEqual(["runtime-backed-started"])
    }).pipe(Effect.provide(Layer.provide(ProcessStore.layerRuntimeStorage, RuntimeStorage.layer))),
  )

  it.live("queries queue completion and lifecycle events", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore
      const t1 = utcDateFromIso("2026-01-01T04:00:00.000Z").getTime()
      const t2 = utcDateFromIso("2026-01-01T04:05:00.000Z").getTime()
      const t3 = utcDateFromIso("2026-01-01T04:10:00.000Z").getTime()

      const completed: QueueItemCompletedEvent = {
        id: "queue-item-completed",
        type: "queue.item.completed",
        occurredAt: t1,
        entityType: "queue",
        entityId: "email-queue",
        item: {
          status: "completed",
          priority: "normal",
          durationMs: 10,
          attempts: 1,
        },
      }
      const failed: QueueItemCompletedEvent = {
        id: "queue-item-failed",
        type: "queue.item.completed",
        occurredAt: t3,
        entityType: "queue",
        entityId: "email-queue",
        item: {
          status: "failed",
          priority: "high",
          durationMs: 20,
          attempts: 2,
          error: "smtp down",
        },
      }
      const paused: QueueLifecycleChangedEvent = {
        id: "queue-paused",
        type: "queue.lifecycle.changed",
        occurredAt: t2,
        entityType: "queue",
        entityId: "email-queue",
        lifecycle: { tag: "Paused" },
      }

      yield* store.appendBatch([
        completed,
        failed,
        paused,
        {
          ...completed,
          id: "other-queue-item",
          entityId: "sms-queue",
        },
      ])

      const completions = yield* store.getQueueItemCompletions("email-queue")
      expect(completions.map((row) => row.id)).toEqual([
        "queue-item-failed",
        "queue-item-completed",
      ])

      const limited = yield* store.getQueueItemCompletions("email-queue", {
        before: t3,
        limit: 1,
      })
      expect(limited.map((row) => row.id)).toEqual(["queue-item-completed"])

      const lifecycle = yield* store.getQueueLifecycle("email-queue")
      expect(lifecycle.map((row) => row.lifecycle.tag)).toEqual(["Paused"])
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("projects runtime state history and latest state", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore
      const t1 = utcDateFromIso("2026-01-01T04:20:00.000Z").getTime()
      const t2 = utcDateFromIso("2026-01-01T04:25:00.000Z").getTime()
      const ref = { kind: "run-resource", id: "@test/StateGate" }

      const first = {
        ref,
        observedAt: t1,
        configVersion: 1,
        waiting: 1,
      }
      const second = {
        ref,
        observedAt: t2,
        configVersion: 1,
        waiting: 0,
      }
      const changed: RuntimeStateChangedEvent = {
        id: "state-change-2",
        type: "runtime.state.changed",
        occurredAt: t2,
        entityType: "run-resource",
        entityId: "@test/StateGate",
        change: {
          id: "change-2",
          ref,
          changedAt: t2,
          reason: "run-resource.run.started",
          previous: first,
          current: second,
        },
      }

      yield* store.append(changed)

      const history = yield* ProcessStore.runtime.stateHistory({ ref })
      const latest = yield* ProcessStore.runtime.latestState(ref)

      expect(history.map((change) => change.id)).toEqual(["change-2"])
      expect(Option.getOrNull(latest)).toEqual(second)
    }).pipe(Effect.provide(ProcessStore.layer)),
  )
})

/** @deprecated legacy NDJSON adapter — kept for compatibility coverage only */
describe("ProcessStore.file (legacy)", () => {
  const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

  it.live("persists generic events across file store instances", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const fs = yield* FileSystem.FileSystem
      const now = yield* Clock.currentTimeMillis
      const directory = path.join(".tmp", `effect-pm-file-store-${now}`)
      const filePath = path.join(directory, "events.ndjson")

      const first = yield* ProcessStore.file(filePath)
      const occurredAt = utcDateFromIso("2026-01-01T05:00:00.000Z").getTime()
      const fileState = {
        ref: { kind: "run-resource", id: "@test/FileRunGate" },
        observedAt: occurredAt + 3,
        configVersion: 1,
        completed: 1,
      }

      yield* first.append({
        id: "file-runtime-started",
        type: "runtime.fact.recorded",
        occurredAt,
        entityType: "run-resource",
        entityId: "@test/FileRunGate",
        fact: {
          id: "file-run-1/start",
          ref: { kind: "run-resource", id: "@test/FileRunGate" },
          type: "run-resource.run.started",
          occurredAt,
          payload: { concurrency: 1 },
        },
      })

      yield* first.append({
        id: "file-queue-item-completed",
        type: "queue.item.completed",
        occurredAt: occurredAt + 1,
        entityType: "queue",
        entityId: "file-email-queue",
        item: {
          status: "completed",
          priority: "normal",
          durationMs: 3,
          attempts: 1,
        },
      })
      yield* first.append({
        id: "file-queue-cleared",
        type: "queue.lifecycle.changed",
        occurredAt: occurredAt + 2,
        entityType: "queue",
        entityId: "file-email-queue",
        lifecycle: { tag: "Cleared", itemsCleared: 1 },
      })
      yield* first.append({
        id: "file-state-change",
        type: "runtime.state.changed",
        occurredAt: occurredAt + 3,
        entityType: "run-resource",
        entityId: "@test/FileRunGate",
        change: {
          id: "file-state-change/inner",
          ref: { kind: "run-resource", id: "@test/FileRunGate" },
          changedAt: occurredAt + 3,
          reason: "run-resource.run.completed",
          previous: null,
          current: fileState,
        },
      })

      yield* fs.writeFileString(filePath, "not json\n", { flag: "a" })

      const second = yield* ProcessStore.file(filePath)
      const rows = yield* second.events({
        entityType: "run-resource",
        entityId: "@test/FileRunGate",
        types: ["runtime.fact.recorded"],
      })
      const runtimeFacts = yield* ProcessStore.runtime.facts({
        ref: { kind: "run-resource", id: "@test/FileRunGate" },
      }).pipe(Effect.provideService(ProcessStore, second))

      expect(rows.map((row) => row.id)).toEqual(["file-runtime-started"])
      expect(runtimeFacts.map((fact) => fact.id)).toEqual(["file-run-1/start"])

      const completions = yield* second.getQueueItemCompletions("file-email-queue")
      expect(completions.map((row) => row.id)).toEqual([
        "file-queue-item-completed",
      ])

      const lifecycle = yield* second.getQueueLifecycle("file-email-queue")
      expect(lifecycle.map((row) => row.lifecycle.tag)).toEqual(["Cleared"])

      const stateHistory = yield* ProcessStore.runtime.stateHistory({
        ref: { kind: "run-resource", id: "@test/FileRunGate" },
      }).pipe(Effect.provideService(ProcessStore, second))
      expect(stateHistory.map((change) => change.reason)).toEqual([
        "run-resource.run.completed",
      ])

      yield* fs.remove(directory, { recursive: true }).pipe(Effect.catch(() => Effect.void))
    }).pipe(Effect.provide(platform)),
  )
})
