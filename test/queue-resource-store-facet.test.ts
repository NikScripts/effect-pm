/**
 * Conformance suite for the {@link QueueResourceStore} facet.
 *
 * Covers:
 * - No-op vs persist semantics for static telemetry emitters
 * - Failure isolation through `Telemetry.logWarning` (write errors go to log)
 * - Entry / lifecycle / dedupe-key read projections including all pushable
 *   predicates (`queueId`, `entryId`, `batchId`, `releaseId`, `key`)
 * - New projection methods: `entryHistory`, `latestEntryFact`, `byBatch`,
 *   `latestLifecycleEvent`
 * - `for(queueId)` identifier-bound API
 * - Phantom type accessors `.Type` / `.EmitType` / `.IdentifierType`
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Logger, Option } from "effect";
import { ProcessStore } from "../src/ProcessStore";
import { ProcessStorage } from "../src/ProcessStorage";
import { ProcessStoreReadonlyRecordError } from "../src/ProcessStoreEvent";
import {
  RuntimeStorage,
  RuntimeStorageConnectionError,
  type RuntimeStorageService,
} from "../src/RuntimeStorage";
import {
  QueueDedupeKeyScope,
  QueueEntryScope,
  QueueResourceScope,
} from "../src/QueueResourceScope";
import {
  QueueResourceStore,
  type QueueDedupeKeyChange,
  type QueueEntryCompletedFact,
  type QueueEntryEnqueuedFact,
  type QueueEntryFact,
  type QueueEntryReleasedFact,
  type QueueLifecycleChange,
} from "../src/store/queueResource";

// ============================================================================
// Local emit helpers — mirror QueueResource's internal emit pattern
// ============================================================================

const emitEntry = (fact: QueueEntryFact): Effect.Effect<void> =>
  QueueResourceScope.run(
    { queueId: fact.queueId },
    QueueEntryScope.run(
      { entryId: fact.entryId },
      Effect.gen(function* () {
        const common = {
          id: fact.id,
          entryId: fact.entryId,
          occurredAt: fact.occurredAt,
          ...(fact.key !== undefined ? { key: fact.key } : {}),
          ...(fact.priority !== undefined ? { priority: fact.priority } : {}),
          ...(fact.attempts !== undefined ? { attempts: fact.attempts } : {}),
          ...(fact.batchId !== undefined ? { batchId: fact.batchId } : {}),
        };
        switch (fact.type) {
          case "Queue.Entry.Enqueued":
            yield* QueueResourceStore.Entry.Enqueued({
              ...common,
              enqueuedAt: fact.enqueuedAt,
              ...(fact.payload !== undefined ? { payload: fact.payload } : {}),
            });
            return;
          case "Queue.Entry.Started":
            yield* QueueResourceStore.Entry.Started({ ...common, startedAt: fact.startedAt });
            return;
          case "Queue.Entry.Completed":
            yield* QueueResourceStore.Entry.Completed({ ...common, startedAt: fact.startedAt, durationMs: fact.durationMs });
            return;
          case "Queue.Entry.Failed":
            yield* QueueResourceStore.Entry.Failed({
              ...common,
              startedAt: fact.startedAt,
              durationMs: fact.durationMs,
              ...(fact.error !== undefined ? { error: fact.error } : {}),
            });
            return;
          case "Queue.Entry.Retried":
            yield* QueueResourceStore.Entry.Retried({ ...common, ...(fact.error !== undefined ? { error: fact.error } : {}) });
            return;
          case "Queue.Entry.Exhausted":
            yield* QueueResourceStore.Entry.Exhausted({ ...common, ...(fact.error !== undefined ? { error: fact.error } : {}) });
            return;
          case "Queue.Entry.Released":
            yield* QueueResourceStore.Entry.Released({
              ...common,
              releaseId: fact.releaseId,
              ...(fact.interruptedAt !== undefined ? { interruptedAt: fact.interruptedAt } : {}),
            });
            return;
          case "Queue.Entry.DeadLettered":
            yield* QueueResourceStore.Entry.DeadLettered({
              ...common,
              ...(fact.reason !== undefined ? { reason: fact.reason } : {}),
              ...(fact.error !== undefined ? { error: fact.error } : {}),
            });
            return;
          case "Queue.Entry.Dropped":
            yield* QueueResourceStore.Entry.Dropped({ ...common, ...(fact.reason !== undefined ? { reason: fact.reason } : {}) });
            return;
        }
      }),
    ),
  );

const emitLifecycle = (change: QueueLifecycleChange): Effect.Effect<void> =>
  QueueResourceScope.run(
    { queueId: change.queueId },
    Effect.gen(function* () {
      const base = { id: change.id, changedAt: change.changedAt };
      switch (change.type) {
        case "Queue.Lifecycle.Started":  yield* QueueResourceStore.Lifecycle.Started(base);  return;
        case "Queue.Lifecycle.Paused":   yield* QueueResourceStore.Lifecycle.Paused(base);   return;
        case "Queue.Lifecycle.Resumed":  yield* QueueResourceStore.Lifecycle.Resumed(base);  return;
        case "Queue.Lifecycle.Shutdown": yield* QueueResourceStore.Lifecycle.Shutdown(base); return;
        case "Queue.Lifecycle.Cleared":  yield* QueueResourceStore.Lifecycle.Cleared({ ...base, itemsCleared: change.itemsCleared }); return;
        case "Queue.Lifecycle.Drained":  yield* QueueResourceStore.Lifecycle.Drained(base);  return;
      }
    }),
  );

const emitDedupeKey = (change: QueueDedupeKeyChange): Effect.Effect<void> =>
  QueueResourceScope.run(
    { queueId: change.queueId },
    QueueDedupeKeyScope.run(
      { key: change.key },
      Effect.gen(function* () {
        const base = { id: change.id, changedAt: change.changedAt };
        switch (change.type) {
          case "Queue.DedupeKey.Added":    yield* QueueResourceStore.DedupeKey.Added(base);    return;
          case "Queue.DedupeKey.Released": yield* QueueResourceStore.DedupeKey.Released(base); return;
          case "Queue.DedupeKey.Hydrated": yield* QueueResourceStore.DedupeKey.Hydrated(base); return;
        }
      }),
    ),
  );

// ============================================================================
// Fixture builders
// ============================================================================

const enqueued = (
  queueId: string,
  entryId: string,
  occurredAt: number,
  overrides?: Partial<QueueEntryEnqueuedFact>,
): QueueEntryEnqueuedFact => ({
  id: `${queueId}/${entryId}/enqueued`,
  queueId,
  entryId,
  type: "Queue.Entry.Enqueued",
  occurredAt,
  enqueuedAt: occurredAt,
  priority: "normal",
  attempts: 1,
  ...overrides,
});

const completed = (
  queueId: string,
  entryId: string,
  occurredAt: number,
  startedAt: number,
  durationMs: number,
  overrides?: Partial<QueueEntryCompletedFact>,
): QueueEntryCompletedFact => ({
  id: `${queueId}/${entryId}/completed`,
  queueId,
  entryId,
  type: "Queue.Entry.Completed",
  occurredAt,
  startedAt,
  durationMs,
  priority: "normal",
  attempts: 1,
  ...overrides,
});

const released = (
  queueId: string,
  entryId: string,
  occurredAt: number,
  releaseId: string,
  overrides?: Partial<QueueEntryReleasedFact>,
): QueueEntryReleasedFact => ({
  id: `${queueId}/${entryId}/released`,
  queueId,
  entryId,
  type: "Queue.Entry.Released",
  occurredAt,
  releaseId,
  ...overrides,
});

const failed = (
  queueId: string,
  entryId: string,
  occurredAt: number,
  startedAt: number,
  durationMs: number,
  error: string,
): QueueEntryFact => ({
  id: `${queueId}/${entryId}/failed`,
  queueId,
  entryId,
  type: "Queue.Entry.Failed",
  occurredAt,
  startedAt,
  durationMs,
  error,
  priority: "normal",
  attempts: 2,
});

const lifecycleStarted = (queueId: string, changedAt: number): QueueLifecycleChange => ({
  id: `${queueId}/lifecycle/started`,
  queueId,
  type: "Queue.Lifecycle.Started",
  changedAt,
});

const lifecycleCleared = (
  queueId: string,
  changedAt: number,
  itemsCleared: number,
): QueueLifecycleChange => ({
  id: `${queueId}/lifecycle/cleared/${String(changedAt)}`,
  queueId,
  type: "Queue.Lifecycle.Cleared",
  changedAt,
  itemsCleared,
});

const dedupeAdded = (queueId: string, key: string, changedAt: number): QueueDedupeKeyChange => ({
  id: `${queueId}/${key}/added`,
  queueId,
  key,
  type: "Queue.DedupeKey.Added",
  changedAt,
});

const dedupeReleased = (queueId: string, key: string, changedAt: number): QueueDedupeKeyChange => ({
  id: `${queueId}/${key}/released`,
  queueId,
  key,
  type: "Queue.DedupeKey.Released",
  changedAt,
});

// ============================================================================
// Static optional emitters
// ============================================================================

describe("QueueResourceStore — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* emitEntry(enqueued("@test/Absent", "@test/Absent/entry/1", 1_700_000_000_000));
      yield* emitLifecycle(lifecycleStarted("@test/Absent", 1_700_000_000_000));
      yield* emitDedupeKey(dedupeAdded("@test/Absent", "k1", 1_700_000_000_000));
      expect(true).toBe(true);
    }),
  );

  it.live("persists through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      const queueId = "@test/Persist";
      yield* emitEntry(enqueued(queueId, `${queueId}/entry/1`, 1_700_000_000_000));
      yield* emitEntry(
        completed(queueId, `${queueId}/entry/1`, 1_700_000_000_010, 1_700_000_000_000, 10),
      );
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.entries({ queueId });
      expect(rows.map((row) => row.type).sort()).toEqual([
        "Queue.Entry.Completed",
        "Queue.Entry.Enqueued",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("Telemetry.logWarning swallows write failures into the log stream", () => {
    // logWarning runs via schemaEventStore, not on a fake facet. Use a
    // failing RuntimeStorage so the first emit fails — logWarning catches it,
    // the emit succeeds, and the warning appears in the captured log stream.
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text = typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    const failingStorage: RuntimeStorageService = {
      create: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "create", cause: "test" })),
      read: () => Effect.succeed([]),
      upsert: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "upsert" })),
      update: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "update" })),
      delete: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "delete" })),
      transaction: (effect) => Effect.provideService(effect, RuntimeStorage, failingStorage),
    };
    const fact = enqueued("@test/LogWarning", "@test/LogWarning/entry/1", 1);
    return Effect.gen(function* () {
      const result = yield* Effect.exit(emitEntry(fact));
      expect(result._tag).toBe("Success");
      expect(
        captured.some((m) => m.includes("QueueResourceStore write failed for Entry.Enqueued")),
      ).toBe(true);
      // ProcessStore.catchErrorAndLog is for explicit best-effort writes too
      yield* Effect.fail(new ProcessStoreReadonlyRecordError({ id: "test-only" })).pipe(
        ProcessStore.catchErrorAndLog({
          message: "explicit catch-and-log test",
          annotations: { test: "queue-emit" },
        }),
      );
      expect(captured.some((m) => m.includes("explicit catch-and-log test"))).toBe(true);
    }).pipe(
      Effect.provide(QueueResourceStore.layerRuntimeStorage),
      Effect.provideService(RuntimeStorage, failingStorage),
      Effect.provide(Logger.layer([captureLogger], { mergeWithExisting: false })),
    );
  });
});

// ============================================================================
// Released roundtrip
// ============================================================================

describe("QueueResourceStore — released roundtrip", () => {
  it.live("writes and reads Queue.Entry.Released", () =>
    Effect.gen(function* () {
      const queueId = "@test/ReleasedOnly";
      yield* emitEntry(released(queueId, `${queueId}/e1`, 1_700_000_000_200, "release-9"));
      yield* emitEntry(enqueued(queueId, `${queueId}/e2`, 1_700_000_000_100));
      const facet = yield* QueueResourceStore;
      const all = yield* facet.entries({ queueId });
      expect(all.map((row) => row.type)).toContain("Queue.Entry.Enqueued");
      expect(all.map((row) => row.type)).toContain("Queue.Entry.Released");
      const rows = yield* facet.entries({ queueId, types: ["Queue.Entry.Released"] });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("Queue.Entry.Released");
      if (rows[0]?.type === "Queue.Entry.Released") {
        expect(rows[0].releaseId).toBe("release-9");
      }
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

// ============================================================================
// Entry projections
// ============================================================================

describe("QueueResourceStore — entry projections", () => {
  const queueA = "@test/QueueA";
  const queueB = "@test/QueueB";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    yield* emitEntry(enqueued(queueA, `${queueA}/entry/1`, t(0), { key: "job-1", batchId: "batch-1" }));
    yield* emitEntry(completed(queueA, `${queueA}/entry/1`, t(50), t(0), 50, { key: "job-1" }));
    yield* emitEntry(failed(queueA, `${queueA}/entry/2`, t(120), t(60), 60, "boom"));
    yield* emitEntry(released(queueA, `${queueA}/entry/3`, t(200), "release-9"));
    yield* emitEntry(enqueued(queueB, `${queueB}/entry/1`, t(75), { key: "job-1" }));
  });

  it.live("entries({ queueId }) returns rows for the requested queue", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.entries({ queueId: queueA });
      expect(rows.every((row) => row.queueId === queueA)).toBe(true);
      expect(rows.map((row) => row.type).sort()).toEqual([
        "Queue.Entry.Completed",
        "Queue.Entry.Enqueued",
        "Queue.Entry.Failed",
        "Queue.Entry.Released",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entries({ queueId, types }) filters by status", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.entries({ queueId: queueA, types: ["Queue.Entry.Failed"] });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("Queue.Entry.Failed");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entries({ queueId, entryId }) filters by entry id", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.entries({ queueId: queueA, entryId: `${queueA}/entry/1` });
      expect(rows.every((row) => row.entryId === `${queueA}/entry/1`)).toBe(true);
      expect(rows.map((row) => row.type).sort()).toEqual([
        "Queue.Entry.Completed",
        "Queue.Entry.Enqueued",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entries({ batchId }) and entries({ releaseId }) push indexed predicates", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const byBatch = yield* facet.entries({ batchId: "batch-1" });
      expect(
        byBatch.every(
          (row) => row.type !== "Queue.Entry.Enqueued" || row.batchId === "batch-1",
        ),
      ).toBe(true);
      const byRelease = yield* facet.entries({ releaseId: "release-9" });
      expect(byRelease).toHaveLength(1);
      const first = byRelease[0];
      if (first?.type !== "Queue.Entry.Released") {
        throw new Error("expected released fact");
      }
      expect(first.releaseId).toBe("release-9");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entriesByKey returns rows across queues for a shared key", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.entriesByKey("job-1");
      expect(rows.every((row) => row.key === "job-1")).toBe(true);
      const queues = new Set(rows.map((row) => row.queueId));
      expect(queues.has(queueA)).toBe(true);
      expect(queues.has(queueB)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entries({ queueId, opts: { limit } }) caps the result", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.entries({ queueId: queueA, opts: { limit: 1 } });
      expect(rows).toHaveLength(1);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entriesByKey isolates the requested key when many keys share storage", () =>
    Effect.gen(function* () {
      const facet = yield* QueueResourceStore;
      const baseT = 1_700_000_000_000;
      for (let i = 0; i < 5; i++) {
        yield* emitEntry(
          enqueued("@test/Bulk", `entry/noise-${String(i)}`, baseT + i, { key: "noise" }),
        );
      }
      for (let i = 0; i < 3; i++) {
        yield* emitEntry(
          enqueued("@test/Bulk", `entry/target-${String(i)}`, baseT + 100 + i, { key: "target" }),
        );
      }
      const all = yield* facet.entriesByKey("target");
      expect(all).toHaveLength(3);
      expect(all.every((row) => row.key === "target")).toBe(true);
      const limited = yield* facet.entriesByKey("target", { opts: { limit: 2 } });
      expect(limited).toHaveLength(2);
      expect(limited.every((row) => row.key === "target")).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

// ============================================================================
// New projection methods
// ============================================================================

describe("QueueResourceStore — entryHistory and latestEntryFact", () => {
  const queueId = "@test/EntryProj";
  const entryId = `${queueId}/entry/42`;
  const otherEntryId = `${queueId}/entry/99`;
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    yield* emitEntry(enqueued(queueId, entryId, t(0)));
    yield* emitEntry(completed(queueId, entryId, t(100), t(0), 100));
    yield* emitEntry(enqueued(queueId, otherEntryId, t(50)));
  });

  it.live("entryHistory returns all facts for the given entry ordered desc", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.entryHistory(entryId, { queueId });
      expect(rows.every((row) => row.entryId === entryId)).toBe(true);
      expect(rows.map((row) => row.type)).toEqual([
        "Queue.Entry.Completed",
        "Queue.Entry.Enqueued",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entryHistory does not include facts from other entries", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.entryHistory(entryId);
      expect(rows.every((row) => row.entryId === entryId)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("latestEntryFact returns the most recent fact as Option.some", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const result = yield* facet.latestEntryFact(entryId, queueId);
      expect(Option.isSome(result)).toBe(true);
      if (Option.isSome(result)) {
        // Completed was emitted at t(100), later than Enqueued at t(0)
        expect(result.value.type).toBe("Queue.Entry.Completed");
      }
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("latestEntryFact returns Option.none for unknown entry", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const result = yield* facet.latestEntryFact("no-such-entry", queueId);
      expect(Option.isNone(result)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("QueueResourceStore — byBatch", () => {
  const queueId = "@test/BatchProj";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    yield* emitEntry(enqueued(queueId, `${queueId}/e1`, t(0), { batchId: "batch-X" }));
    yield* emitEntry(enqueued(queueId, `${queueId}/e2`, t(10), { batchId: "batch-X" }));
    yield* emitEntry(completed(queueId, `${queueId}/e1`, t(50), t(0), 50, { batchId: "batch-X" }));
    yield* emitEntry(enqueued(queueId, `${queueId}/e3`, t(20), { batchId: "batch-Y" }));
    yield* emitEntry(enqueued(queueId, `${queueId}/e4`, t(30)));
  });

  it.live("byBatch returns all entry facts belonging to the batch", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.byBatch("batch-X", { queueId });
      // e1 (enqueued + completed) + e2 (enqueued) = 3 rows
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.batchId === "batch-X" || row.type === "Queue.Entry.Completed")).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("byBatch excludes facts from other batches and unbatched entries", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.byBatch("batch-X", { queueId });
      const types = rows.map((r) => `${r.entryId}:${r.type}`);
      expect(types).not.toContain(`${queueId}/e3:Queue.Entry.Enqueued`);
      expect(types).not.toContain(`${queueId}/e4:Queue.Entry.Enqueued`);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("QueueResourceStore — latestLifecycleEvent", () => {
  const queueId = "@test/LifecycleProj";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    yield* emitLifecycle(lifecycleStarted(queueId, t(0)));
    yield* emitLifecycle(lifecycleCleared(queueId, t(100), 5));
    yield* emitLifecycle({ id: `${queueId}/lc/drained`, queueId, type: "Queue.Lifecycle.Drained", changedAt: t(200) });
  });

  it.live("returns the most recent lifecycle event as Option.some", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const result = yield* facet.latestLifecycleEvent(queueId);
      expect(Option.isSome(result)).toBe(true);
      if (Option.isSome(result)) {
        // Drained at t(200) is latest
        expect(result.value.type).toBe("Queue.Lifecycle.Drained");
      }
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("returns Option.none when no events exist for the queue", () =>
    Effect.gen(function* () {
      const facet = yield* QueueResourceStore;
      const result = yield* facet.latestLifecycleEvent("@test/NoLifecycle");
      expect(Option.isNone(result)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("can filter by lifecycle type", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const result = yield* facet.latestLifecycleEvent(queueId, { types: ["Queue.Lifecycle.Cleared"] });
      expect(Option.isSome(result)).toBe(true);
      if (Option.isSome(result)) {
        expect(result.value.type).toBe("Queue.Lifecycle.Cleared");
        if (result.value.type === "Queue.Lifecycle.Cleared") {
          expect(result.value.itemsCleared).toBe(5);
        }
      }
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

// ============================================================================
// Lifecycle and dedupe-key projections
// ============================================================================

describe("QueueResourceStore — lifecycle and dedupe-key projections", () => {
  const queueId = "@test/Lifecycle";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    yield* emitLifecycle(lifecycleStarted(queueId, t(0)));
    yield* emitLifecycle(lifecycleCleared(queueId, t(100), 3));
    yield* emitDedupeKey(dedupeAdded(queueId, "k1", t(10)));
    yield* emitDedupeKey(dedupeReleased(queueId, "k1", t(50)));
    yield* emitDedupeKey(dedupeAdded(queueId, "k2", t(20)));
  });

  it.live("lifecycle({ queueId }) returns ordered lifecycle changes", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.lifecycle({ queueId });
      expect(rows.map((row) => row.type)).toEqual([
        "Queue.Lifecycle.Cleared",
        "Queue.Lifecycle.Started",
      ]);
      const cleared = rows.find((row) => row.type === "Queue.Lifecycle.Cleared");
      if (cleared?.type !== "Queue.Lifecycle.Cleared") {
        throw new Error("expected cleared change");
      }
      expect(cleared.itemsCleared).toBe(3);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("lifecycle filters by type", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.lifecycle({ queueId, types: ["Queue.Lifecycle.Started"] });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("Queue.Lifecycle.Started");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("dedupeKeys({ queueId }) returns all changes for the queue", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.dedupeKeys({ queueId });
      expect(rows.every((row) => row.queueId === queueId)).toBe(true);
      expect(rows.map((row) => row.type).sort()).toEqual([
        "Queue.DedupeKey.Added",
        "Queue.DedupeKey.Added",
        "Queue.DedupeKey.Released",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("dedupeKeys filters by key", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.dedupeKeys({ queueId, key: "k1" });
      expect(rows.every((row) => row.key === "k1")).toBe(true);
      expect(rows.map((row) => row.type).sort()).toEqual([
        "Queue.DedupeKey.Added",
        "Queue.DedupeKey.Released",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

// ============================================================================
// for(queueId) bound API
// ============================================================================

describe("QueueResourceStore — for(queueId) bound API", () => {
  const queueA = "@test/ForA";
  const queueB = "@test/ForB";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    yield* emitEntry(enqueued(queueA, `${queueA}/entry/1`, t(0), { key: "shared" }));
    yield* emitEntry(enqueued(queueB, `${queueB}/entry/1`, t(0), { key: "shared" }));
    yield* emitLifecycle(lifecycleStarted(queueA, t(5)));
    yield* emitLifecycle(lifecycleStarted(queueB, t(5)));
    yield* emitDedupeKey(dedupeAdded(queueA, "k1", t(10)));
    yield* emitDedupeKey(dedupeAdded(queueB, "k1", t(10)));
  });

  it.live("entries() narrows to the bound queueId", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const bound = yield* QueueResourceStore.for(queueA);
      const rows = yield* bound.entries();
      expect(rows.every((row) => row.queueId === queueA)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entriesByKey() narrows to bound queueId AND requested key", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const bound = yield* QueueResourceStore.for(queueA);
      const rows = yield* bound.entriesByKey("shared");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.queueId).toBe(queueA);
      expect(rows[0]?.key).toBe("shared");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("lifecycle() / dedupeKeys() narrow to the bound queue", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const bound = yield* QueueResourceStore.for(queueA);
      const lifecycle = yield* bound.lifecycle();
      const dedupe = yield* bound.dedupeKeys();
      expect(lifecycle.every((row) => row.queueId === queueA)).toBe(true);
      expect(dedupe.every((row) => row.queueId === queueA)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entryHistory() narrows to bound queueId and given entryId", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const bound = yield* QueueResourceStore.for(queueA);
      const rows = yield* bound.entryHistory(`${queueA}/entry/1`);
      expect(rows.every((row) => row.queueId === queueA)).toBe(true);
      expect(rows.every((row) => row.entryId === `${queueA}/entry/1`)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("latestEntryFact() returns latest fact within the bound queue", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const bound = yield* QueueResourceStore.for(queueA);
      const result = yield* bound.latestEntryFact(`${queueA}/entry/1`);
      expect(Option.isSome(result)).toBe(true);
      if (Option.isSome(result)) {
        expect(result.value.queueId).toBe(queueA);
      }
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("latestLifecycleEvent() returns latest event for the bound queue", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const bound = yield* QueueResourceStore.for(queueA);
      const result = yield* bound.latestLifecycleEvent();
      expect(Option.isSome(result)).toBe(true);
      if (Option.isSome(result)) {
        expect(result.value.queueId).toBe(queueA);
      }
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("byBatch() narrows to the bound queue", () =>
    Effect.gen(function* () {
      yield* emitEntry(enqueued(queueA, `${queueA}/batch/1`, t(0), { batchId: "shared-batch" }));
      yield* emitEntry(enqueued(queueB, `${queueB}/batch/1`, t(0), { batchId: "shared-batch" }));
      const bound = yield* QueueResourceStore.for(queueA);
      const rows = yield* bound.byBatch("shared-batch");
      expect(rows.every((row) => row.queueId === queueA)).toBe(true);
      expect(rows).toHaveLength(1);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

// ============================================================================
// Phantom type accessors
// ============================================================================

describe("QueueResourceStore — phantom type accessors", () => {
  it.live(".Type and .EmitType expose the structural shapes", () =>
    Effect.sync(() => {
      const noopEmit = Object.assign(
        (_input: unknown) => Effect.void,
        { batch: (_inputs: ReadonlyArray<unknown>) => Effect.void },
      );
      const emitShape: ProcessStore.Type.Emit<typeof QueueResourceStore> = {
        Entry: {
          Enqueued: noopEmit, Started: noopEmit, Completed: noopEmit, Failed: noopEmit,
          Retried: noopEmit, Exhausted: noopEmit, Released: noopEmit, DeadLettered: noopEmit, Dropped: noopEmit,
        },
        Lifecycle: { Started: noopEmit, Paused: noopEmit, Resumed: noopEmit, Shutdown: noopEmit, Cleared: noopEmit, Drained: noopEmit },
        DedupeKey: { Added: noopEmit, Released: noopEmit, Hydrated: noopEmit },
        RateLimit: { Exceeded: noopEmit },
      };
      // Typed noops that satisfy the shape without complex generics
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anySucceed = (..._args: any[]) => Effect.succeed([] as any) as any;
      const anyOption = (..._args: any[]) => Effect.succeed(Option.none()) as any;
      const fullShape = {
        ...emitShape,
        entries: anySucceed,
        entriesByKey: anySucceed,
        lifecycle: anySucceed,
        dedupeKeys: anySucceed,
        rateLimits: anySucceed,
        entryHistory: anySucceed,
        latestEntryFact: anyOption,
        byBatch: anySucceed,
        latestLifecycleEvent: anyOption,
      } as unknown as ProcessStore.Type.Shape<typeof QueueResourceStore>;
      const boundShape = {
        entries: anySucceed,
        entriesByKey: anySucceed,
        lifecycle: anySucceed,
        dedupeKeys: anySucceed,
        rateLimits: anySucceed,
        entryHistory: anySucceed,
        latestEntryFact: anyOption,
        byBatch: anySucceed,
        latestLifecycleEvent: anyOption,
      } as unknown as ProcessStore.Type.Identifier<typeof QueueResourceStore>;
      expect(typeof fullShape.Entry.Enqueued).toBe("function");
      expect(typeof emitShape.Lifecycle.Started).toBe("function");
      expect(typeof boundShape.entries).toBe("function");
      expect(typeof boundShape.latestEntryFact).toBe("function");
    }),
  );
});
