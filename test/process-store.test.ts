import { describe, expect, it } from "@effect/vitest"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import { Clock, DateTime, Effect, FileSystem, Layer, Option, Path, pipe } from "effect"
import {
  Occurred,
  OrderBy,
  ProcessId,
  ProcessStore,
  ProcessStoreDuplicateRecordError,
  ProcessStoreRunResource,
  RuntimeStorage,
  Select,
  SubjectId,
  Where,
  type ProcessLifecycleChangedEvent,
  type ProcessStoreInterface,
  type QueueItemCompletedEvent,
  type QueueLifecycleChangedEvent,
  type RunResourceFact,
  type RunResourceStateChangedEvent,
} from "../src"
import { ProcessStoreProcessExecution } from "../src/store/processExecution"
import { ProcessStoreQueueResource } from "../src/store/queueResource"
import {
  runResourceFactsFromEvents,
  runResourceStateChangesFromEvents,
} from "../src/internal/store/spine"
import { utcDateFromIso } from "../src/internal/utcDate";

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
      const t1 = utcDateFromIso("2026-01-01T00:00:00.000Z").getTime()
      const t2 = utcDateFromIso("2026-01-01T00:10:00.000Z").getTime()
      const t3 = utcDateFromIso("2026-01-01T00:20:00.000Z").getTime()

      yield* ProcessStoreProcessExecution.recordCompleted({
        processId: "p1",
        scheduleKey: null,
        startedAt: t1,
        completedAt: t1,
        isStartupRun: true,
      })
      yield* ProcessStoreProcessExecution.recordFailed({
        processId: "p1",
        scheduleKey: "live",
        startedAt: t2,
        completedAt: t2,
        error: "boom",
        isStartupRun: false,
      })
      yield* ProcessStoreProcessExecution.recordCompleted({
        processId: "p1",
        scheduleKey: "idle",
        startedAt: t3,
        completedAt: t3,
        isStartupRun: false,
      })

      const all = yield* ProcessStoreProcessExecution.executions({ processId: "p1" })
      expect(all.map((row) => row.execution.status).sort()).toEqual([
        "completed",
        "completed",
        "failed",
      ])
      expect(all.length).toBe(3)

      const limited = yield* ProcessStoreProcessExecution.executions({
        processId: "p1",
        opts: { limit: 2 },
      })
      expect(limited).toHaveLength(2)

      const before = yield* ProcessStoreProcessExecution.executions({
        processId: "p1",
        opts: { before: t3 },
      })
      expect(before.every((row) => row.occurredAt < t3)).toBe(true)

      const after = yield* ProcessStoreProcessExecution.executions({
        processId: "p1",
        opts: { after: t1 },
      })
      expect(after.every((row) => row.occurredAt > t1)).toBe(true)
    }).pipe(Effect.provide(ProcessStore.layer)),
  )

  it.live("orders process executions by event occurrence time", () =>
    Effect.gen(function* () {
      const earlyStart = utcDateFromIso("2026-01-01T00:00:00.000Z").getTime()
      const lateStart = utcDateFromIso("2026-01-01T00:10:00.000Z").getTime()
      const earlyCompletion = utcDateFromIso("2026-01-01T00:11:00.000Z").getTime()
      const lateCompletion = utcDateFromIso("2026-01-01T00:12:00.000Z").getTime()

      yield* ProcessStoreProcessExecution.recordCompleted({
        processId: "p-overlap",
        scheduleKey: "live",
        startedAt: earlyStart,
        completedAt: lateCompletion,
        isStartupRun: false,
      })
      yield* ProcessStoreProcessExecution.recordCompleted({
        processId: "p-overlap",
        scheduleKey: "live",
        startedAt: lateStart,
        completedAt: earlyCompletion,
        isStartupRun: false,
      })

      const all = yield* ProcessStoreProcessExecution.executions({
        processId: "p-overlap",
      })
      expect(all.map((row) => row.occurredAt).sort((a, b) => b - a)).toEqual([
        lateCompletion,
        earlyCompletion,
      ])

      const beforeLateCompletion = yield* ProcessStoreProcessExecution.executions({
        processId: "p-overlap",
        opts: { before: lateCompletion },
      })
      expect(beforeLateCompletion).toHaveLength(1)
      expect(beforeLateCompletion[0]?.occurredAt).toBe(earlyCompletion)
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
          type: "run-resource.fact.recorded",
          occurredAt: t1,
          entityType: "run-resource",
          entityId: "@test/RunGate",
          fact: {
            id: "run-1/start",
            resourceId: "@test/RunGate",
            runId: "@test/RunGate/run/1",
            type: "run-resource.run.started",
            occurredAt: t1,
            payload: { concurrency: 1 },
          },
        },
        {
          id: "runtime-completed",
          type: "run-resource.fact.recorded",
          occurredAt: t2,
          entityType: "run-resource",
          entityId: "@test/RunGate",
          fact: {
            id: "run-1/completed",
            resourceId: "@test/RunGate",
            runId: "@test/RunGate/run/1",
            type: "run-resource.run.completed",
            occurredAt: t2,
            payload: { durationMs: 10 },
          },
        },
      ])

      const rows = yield* store.events({
        entityType: "run-resource",
        entityId: "@test/RunGate",
        types: ["run-resource.fact.recorded"],
        opts: { limit: 1 },
      })
      const runs = yield* ProcessStoreRunResource
      const runtimeFacts = yield* runs.facts({
        resourceId: "@test/RunGate",
        types: ["run-resource.run.completed"],
        opts: { limit: 1 },
      })
      const runHistory = yield* runs.facts({ resourceId: "@test/RunGate" })

      expect(rows.map((row) => row.id)).toEqual(["runtime-completed"])
      expect(runtimeFacts.map((fact) => fact.id)).toEqual(["run-1/completed"])
      expect(runHistory.map((fact: RunResourceFact) => fact.id)).toEqual([
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

      const queueResource = yield* ProcessStoreQueueResource

      yield* queueResource.withQueue(
        "email-queue",
        queueResource.withBatch(
          "batch-1",
          Effect.all(
            [
              queueResource.withEntry(
                "entry-1",
                queueResource.entryEnqueued({
                  key: "delivery-1",
                  priority: "high",
                  occurredAt: first,
                }),
              ),
              queueResource.withEntry(
                "entry-1",
                queueResource.entryCompleted({
                  key: "delivery-1",
                  priority: "high",
                  attempts: 1,
                  durationMs: 8,
                  occurredAt: second,
                }),
              ),
              queueResource.withDedupeKey(
                "delivery-1",
                queueResource.dedupeKeyAdded({ occurredAt: first }),
              ),
            ],
            { discard: true },
          ),
        ),
      )

      const entries = yield* queueResource.entries("email-queue")
      const byKey = yield* queueResource.entriesByKey("delivery-1")
      const entry = yield* queueResource.entry("entry-1")
      const dedupeKeys = yield* queueResource.dedupeKeys("email-queue")

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
      const resourceId = "@test/StateGate"

      const first = {
        resourceId,
        observedAt: t1,
        configVersion: 1,
        concurrency: 1,
        waiting: 1,
        inFlight: 0,
        completed: 0,
        failed: 0,
        interrupted: 0,
        totalDurationMs: 0,
      }
      const second = {
        ...first,
        observedAt: t2,
        waiting: 0,
        inFlight: 1,
      }
      const changed: RunResourceStateChangedEvent = {
        id: "state-change-2",
        type: "run-resource.state.changed",
        occurredAt: t2,
        entityType: "run-resource",
        entityId: resourceId,
        change: {
          id: "change-2",
          resourceId,
          changedAt: t2,
          reason: "run-resource.run.started",
          previous: first,
          current: second,
        },
      }

      yield* store.append(changed)

      const runs = yield* ProcessStoreRunResource
      const history = yield* runs.stateHistory({ resourceId })
      const latest = yield* runs.latestState(resourceId)

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
        resourceId: "@test/FileRunGate",
        observedAt: occurredAt + 3,
        configVersion: 1,
        concurrency: 1,
        waiting: 0,
        inFlight: 0,
        completed: 1,
        failed: 0,
        interrupted: 0,
        totalDurationMs: 0,
      }

      yield* first.append({
        id: "file-runtime-started",
        type: "run-resource.fact.recorded",
        occurredAt,
        entityType: "run-resource",
        entityId: "@test/FileRunGate",
        fact: {
          id: "file-run-1/start",
          resourceId: "@test/FileRunGate",
          runId: "@test/FileRunGate/run/1",
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
        type: "run-resource.state.changed",
        occurredAt: occurredAt + 3,
        entityType: "run-resource",
        entityId: "@test/FileRunGate",
        change: {
          id: "file-state-change/inner",
          resourceId: "@test/FileRunGate",
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
        types: ["run-resource.fact.recorded"],
      })
      const runtimeFacts = runResourceFactsFromEvents(rows, {
        resourceId: "@test/FileRunGate",
      })

      expect(rows.map((row) => row.id)).toEqual(["file-runtime-started"])
      expect(runtimeFacts.map((fact) => fact.id)).toEqual(["file-run-1/start"])

      const completions = yield* second.getQueueItemCompletions("file-email-queue")
      expect(completions.map((row) => row.id)).toEqual([
        "file-queue-item-completed",
      ])

      const lifecycle = yield* second.getQueueLifecycle("file-email-queue")
      expect(lifecycle.map((row) => row.lifecycle.tag)).toEqual(["Cleared"])

      const stateEvents = yield* second.events({
        entityType: "run-resource",
        entityId: "@test/FileRunGate",
        types: ["run-resource.state.changed"],
      })
      const stateHistory = runResourceStateChangesFromEvents(stateEvents)
      expect(stateHistory.map((change) => change.reason)).toEqual([
        "run-resource.run.completed",
      ])

      yield* fs.remove(directory, { recursive: true }).pipe(Effect.catch(() => Effect.void))
    }).pipe(Effect.provide(platform)),
  )
})
