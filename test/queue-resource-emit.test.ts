/**
 * Conformance suite for {@link QueueResourceStore} static-telemetry writes.
 *
 * Covers:
 * - No-op semantics when the facet layer is absent
 * - Persistence roundtrips for all 19 wire event types
 * - `Telemetry.logWarning` semantics: write failures are captured in the log
 *   stream, not propagated through the error channel
 * - Optional-field absence on read projections
 * - Indexed pushdown for `batchId` and `releaseId`
 *
 * Complements {@link ./queue-resource-store-facet.test.ts} (read projections,
 * `for()` API, and new projection methods) and
 * {@link ./queue-resource.test.ts} (worker integration).
 */

import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Logger } from "effect";
import { ProcessStorage } from "../src/ProcessStorage";
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
  type QueueEntryFact,
  type QueueLifecycleChange,
  type QueueRateLimitExceededFact,
} from "../src/store/queueResource";

// ============================================================================
// Test fixtures
// ============================================================================

const queueId = "@test/EmitConformance";
const entryId = `${queueId}/entry/1`;
const t = (ms: number) => 1_700_100_000_000 + ms;

const enqueued = (
  overrides?: Partial<Extract<QueueEntryFact, { type: "Queue.Entry.Enqueued" }>>,
): Extract<QueueEntryFact, { type: "Queue.Entry.Enqueued" }> => ({
  id: `${queueId}/${entryId}/enqueued`,
  queueId,
  entryId,
  type: "Queue.Entry.Enqueued",
  occurredAt: t(0),
  enqueuedAt: t(0),
  priority: "normal",
  attempts: 1,
  ...overrides,
});

const allEntryFacts = (): ReadonlyArray<QueueEntryFact> => [
  enqueued({ batchId: "batch-a", key: "job-key" }),
  {
    id: `${queueId}/${entryId}/started`,
    queueId,
    entryId,
    type: "Queue.Entry.Started",
    occurredAt: t(10),
    startedAt: t(0),
    priority: "normal",
    attempts: 1,
    batchId: "batch-a",
    key: "job-key",
  },
  {
    id: `${queueId}/${entryId}/completed`,
    queueId,
    entryId,
    type: "Queue.Entry.Completed",
    occurredAt: t(20),
    startedAt: t(0),
    durationMs: 20,
    priority: "normal",
    attempts: 1,
  },
  {
    id: `${queueId}/${entryId}/failed`,
    queueId,
    entryId,
    type: "Queue.Entry.Failed",
    occurredAt: t(30),
    startedAt: t(10),
    durationMs: 20,
    error: "boom",
    priority: "normal",
    attempts: 2,
  },
  {
    id: `${queueId}/${entryId}/retried`,
    queueId,
    entryId,
    type: "Queue.Entry.Retried",
    occurredAt: t(40),
    error: "retry",
    priority: "normal",
    attempts: 2,
  },
  {
    id: `${queueId}/${entryId}/exhausted`,
    queueId,
    entryId,
    type: "Queue.Entry.Exhausted",
    occurredAt: t(50),
    error: "exhausted",
    priority: "normal",
    attempts: 3,
  },
  {
    id: `${queueId}/${entryId}/released`,
    queueId,
    entryId,
    type: "Queue.Entry.Released",
    occurredAt: t(60),
    releaseId: "release-42",
    interruptedAt: t(55),
    priority: "normal",
    attempts: 1,
  },
  {
    id: `${queueId}/${entryId}/dead-lettered`,
    queueId,
    entryId,
    type: "Queue.Entry.DeadLettered",
    occurredAt: t(70),
    reason: "poison",
    error: "bad",
    priority: "normal",
    attempts: 3,
  },
  {
    id: `${queueId}/${entryId}/dropped`,
    queueId,
    entryId,
    type: "Queue.Entry.Dropped",
    occurredAt: t(80),
    reason: "cancelled",
    priority: "normal",
    attempts: 1,
  },
];

const allLifecycleChanges = (): ReadonlyArray<QueueLifecycleChange> => [
  { id: `${queueId}/lifecycle/started`, queueId, type: "Queue.Lifecycle.Started", changedAt: t(0) },
  { id: `${queueId}/lifecycle/paused`, queueId, type: "Queue.Lifecycle.Paused", changedAt: t(10) },
  { id: `${queueId}/lifecycle/resumed`, queueId, type: "Queue.Lifecycle.Resumed", changedAt: t(20) },
  { id: `${queueId}/lifecycle/shutdown`, queueId, type: "Queue.Lifecycle.Shutdown", changedAt: t(30) },
  { id: `${queueId}/lifecycle/cleared`, queueId, type: "Queue.Lifecycle.Cleared", changedAt: t(40), itemsCleared: 5 },
  { id: `${queueId}/lifecycle/drained`, queueId, type: "Queue.Lifecycle.Drained", changedAt: t(50) },
];

const allDedupeChanges = (): ReadonlyArray<QueueDedupeKeyChange> => [
  { id: `${queueId}/k1/added`, queueId, key: "k1", type: "Queue.DedupeKey.Added", changedAt: t(0) },
  { id: `${queueId}/k1/released`, queueId, key: "k1", type: "Queue.DedupeKey.Released", changedAt: t(10) },
  { id: `${queueId}/k2/hydrated`, queueId, key: "k2", type: "Queue.DedupeKey.Hydrated", changedAt: t(20) },
];

const rateLimitFact = (): QueueRateLimitExceededFact => ({
  id: `${queueId}/${entryId}/ratelimit`,
  queueId,
  entryId,
  type: "Queue.RateLimit.Exceeded",
  occurredAt: t(0),
  limitKey: "default",
  algorithm: "fixed-window",
  limit: 2,
  tokens: 0,
  windowMs: 1_000,
  outcome: "rejected",
  delayMs: 0,
  remaining: 0,
  resetAfterMs: 500,
  key: "job-key",
  priority: "high",
});

// ============================================================================
// Local emit helpers — mirror QueueResource's internal emit pattern.
// These exercise the static-telemetry path without needing QueueResource
// to actually run. Scopes are provided explicitly from the fact fields.
// ============================================================================

/**
 * Emits a single `QueueEntryFact` via the static telemetry on
 * `QueueResourceStore.Entry.*`, within the scopes the fact carries.
 * Follows the same scope structure that `QueueResource` uses internally.
 */
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

/** Emits a `QueueLifecycleChange` via static telemetry within the queue's scope. */
const emitLifecycle = (change: QueueLifecycleChange): Effect.Effect<void> =>
  QueueResourceScope.run(
    { queueId: change.queueId },
    Effect.gen(function* () {
      const base = { id: change.id, changedAt: change.changedAt };
      switch (change.type) {
        case "Queue.Lifecycle.Started":   yield* QueueResourceStore.Lifecycle.Started(base);   return;
        case "Queue.Lifecycle.Paused":    yield* QueueResourceStore.Lifecycle.Paused(base);    return;
        case "Queue.Lifecycle.Resumed":   yield* QueueResourceStore.Lifecycle.Resumed(base);   return;
        case "Queue.Lifecycle.Shutdown":  yield* QueueResourceStore.Lifecycle.Shutdown(base);  return;
        case "Queue.Lifecycle.Cleared":   yield* QueueResourceStore.Lifecycle.Cleared({ ...base, itemsCleared: change.itemsCleared }); return;
        case "Queue.Lifecycle.Drained":   yield* QueueResourceStore.Lifecycle.Drained(base);   return;
      }
    }),
  );

/** Emits a `QueueDedupeKeyChange` via static telemetry within the queue and dedupe scopes. */
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

/** Emits a `QueueRateLimitExceededFact` via static telemetry within the queue and entry scopes. */
const emitRateLimit = (fact: QueueRateLimitExceededFact): Effect.Effect<void> =>
  QueueResourceScope.run(
    { queueId: fact.queueId },
    QueueEntryScope.run(
      { entryId: fact.entryId },
      QueueResourceStore.RateLimit.Exceeded({
        id: fact.id,
        occurredAt: fact.occurredAt,
        limitKey: fact.limitKey,
        algorithm: fact.algorithm,
        limit: fact.limit,
        tokens: fact.tokens,
        windowMs: fact.windowMs,
        outcome: fact.outcome,
        delayMs: fact.delayMs,
        remaining: fact.remaining,
        resetAfterMs: fact.resetAfterMs,
        ...(fact.retryAfterMs !== undefined ? { retryAfterMs: fact.retryAfterMs } : {}),
        ...(fact.error !== undefined ? { error: fact.error } : {}),
        ...(fact.key !== undefined ? { key: fact.key } : {}),
        ...(fact.priority !== undefined ? { priority: fact.priority } : {}),
      }),
    ),
  );

// ============================================================================
// Tests
// ============================================================================

describe("QueueResourceStore static telemetry — silent without facet layer", () => {
  it.live("all emitters no-op when QueueResourceStore is not provided", () =>
    Effect.gen(function* () {
      yield* emitEntry(enqueued());
      yield* Effect.forEach(allEntryFacts(), emitEntry, { discard: true });
      yield* emitLifecycle(allLifecycleChanges()[0]!);
      yield* Effect.forEach(allLifecycleChanges(), emitLifecycle, { discard: true });
      yield* emitDedupeKey(allDedupeChanges()[0]!);
      yield* Effect.forEach(allDedupeChanges(), emitDedupeKey, { discard: true });
      yield* emitRateLimit(rateLimitFact());
      expect(true).toBe(true);
    }),
  );
});

describe("QueueResourceStore static telemetry — persistence", () => {
  const storageLayer = Layer.mergeAll(ProcessStorage.layer, RuntimeStorage.layer);

  it.live("writes every Entry wire type and roundtrips field values", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(allEntryFacts(), emitEntry, { discard: true });
      const store = yield* QueueResourceStore;
      const rows = yield* store.entries({ queueId });
      expect(rows.map((row) => row.type).sort()).toEqual(
        allEntryFacts().map((fact) => fact.type).sort(),
      );
      const released = rows.find((row) => row.type === "Queue.Entry.Released");
      expect(released?.type).toBe("Queue.Entry.Released");
      if (released?.type === "Queue.Entry.Released") {
        expect(released.releaseId).toBe("release-42");
        expect(released.interruptedAt).toBe(t(55));
      }
      const dead = rows.find((row) => row.type === "Queue.Entry.DeadLettered");
      expect(dead?.type).toBe("Queue.Entry.DeadLettered");
      if (dead?.type === "Queue.Entry.DeadLettered") {
        expect(dead.reason).toBe("poison");
        expect(dead.error).toBe("bad");
      }
    }).pipe(Effect.provide(storageLayer)),
  );

  it.live("writes every Lifecycle wire type and roundtrips itemsCleared", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(allLifecycleChanges(), emitLifecycle, { discard: true });
      const store = yield* QueueResourceStore;
      const rows = yield* store.lifecycle({ queueId });
      expect(rows.map((row) => row.type).sort()).toEqual(
        allLifecycleChanges().map((change) => change.type).sort(),
      );
      const cleared = rows.find((row) => row.type === "Queue.Lifecycle.Cleared");
      if (cleared?.type !== "Queue.Lifecycle.Cleared") {
        throw new Error("expected cleared lifecycle row");
      }
      expect(cleared.itemsCleared).toBe(5);
    }).pipe(Effect.provide(storageLayer)),
  );

  it.live("writes DedupeKey Added, Released, and Hydrated", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(allDedupeChanges(), emitDedupeKey, { discard: true });
      const store = yield* QueueResourceStore;
      const rows = yield* store.dedupeKeys({ queueId });
      expect(rows.map((row) => row.type).sort()).toEqual([
        "Queue.DedupeKey.Added",
        "Queue.DedupeKey.Hydrated",
        "Queue.DedupeKey.Released",
      ]);
    }).pipe(Effect.provide(storageLayer)),
  );

  it.live("writes RateLimit.Exceeded and roundtrips indexed limitKey", () =>
    Effect.gen(function* () {
      yield* emitRateLimit(rateLimitFact());
      const store = yield* QueueResourceStore;
      const rows = yield* store.rateLimits({ queueId });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("Queue.RateLimit.Exceeded");
      expect(rows[0]?.limitKey).toBe("default");
      expect(rows[0]?.priority).toBe("high");
      expect(rows[0]?.key).toBe("job-key");
    }).pipe(Effect.provide(storageLayer)),
  );

  it.live("omitted optional fields are absent on read projection", () =>
    Effect.gen(function* () {
      const minimalEntryId = `${queueId}/minimal/entry`;
      const minimal = enqueued({
        id: `${queueId}/${minimalEntryId}/enqueued`,
        entryId: minimalEntryId,
        key: undefined,
        priority: undefined,
        attempts: undefined,
        batchId: undefined,
      });
      yield* emitEntry(minimal);
      const store = yield* QueueResourceStore;
      const rows = yield* store.entries({
        queueId,
        entryId: minimalEntryId,
        types: ["Queue.Entry.Enqueued"],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.key).toBeUndefined();
      expect(rows[0]?.priority).toBeUndefined();
      expect(rows[0]?.batchId).toBeUndefined();
      expect(rows[0]?.attempts).toBeUndefined();
    }).pipe(Effect.provide(storageLayer)),
  );

  it.live("batchId and releaseId are queryable via indexed projections", () =>
    Effect.gen(function* () {
      const batchEntryId = `${queueId}/batch-index-entry`;
      const releasedEntryId = `${queueId}/released-index-entry`;
      yield* emitEntry(
        enqueued({
          entryId: batchEntryId,
          id: `${queueId}/${batchEntryId}/enqueued`,
          batchId: "batch-index",
          key: "key-index",
        }),
      );
      yield* emitEntry({
        id: `${queueId}/${releasedEntryId}/released`,
        queueId,
        entryId: releasedEntryId,
        type: "Queue.Entry.Released",
        occurredAt: t(90),
        releaseId: "rel-index",
        priority: "normal",
        attempts: 1,
      });
      const store = yield* QueueResourceStore;
      const byBatch = yield* store.entries({ queueId, batchId: "batch-index" });
      expect(byBatch).toHaveLength(1);
      expect(byBatch[0]?.key).toBe("key-index");
      const byRelease = yield* store.entries({
        queueId,
        releaseId: "rel-index",
        types: ["Queue.Entry.Released"],
      });
      expect(byRelease).toHaveLength(1);
      if (byRelease[0]?.type === "Queue.Entry.Released") {
        expect(byRelease[0].releaseId).toBe("rel-index");
      }
    }).pipe(Effect.provide(storageLayer)),
  );
});

// A RuntimeStorage that always fails on create — used to verify logWarning
// swallows write errors and routes them to the log stream, not the error channel.
const failingRuntimeStorage: RuntimeStorageService = {
  create: () =>
    Effect.fail(
      new RuntimeStorageConnectionError({
        adapter: "memory",
        operation: "create",
        cause: "expected queue emit test failure",
      }),
    ),
  read: () => Effect.succeed([]),
  upsert: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "upsert" })),
  update: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "update" })),
  delete: () => Effect.fail(new RuntimeStorageConnectionError({ adapter: "memory", operation: "delete" })),
  transaction: (effect) => Effect.provideService(effect, RuntimeStorage, failingRuntimeStorage),
};

describe("QueueResourceStore static telemetry — Telemetry.logWarning semantics", () => {
  // logWarning is applied within schemaEventStore (not on a fake facet). We verify
  // by using a failing RuntimeStorage — the emit succeeds (logWarning swallows the
  // error) and the warning message appears in the captured log stream.

  it.live("write failure is swallowed and routed to the log stream", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text = typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    const fact = enqueued();
    return Effect.gen(function* () {
      // failingRuntimeStorage.create always fails — but logWarning catches it
      const result = yield* Effect.exit(emitEntry(fact));
      expect(result._tag).toBe("Success");
      expect(
        captured.some((m) => m.includes("QueueResourceStore write failed for Entry.Enqueued")),
      ).toBe(true);
    }).pipe(
      Effect.provide(QueueResourceStore.layerRuntimeStorage),
      Effect.provideService(RuntimeStorage, failingRuntimeStorage),
      Effect.provide(Logger.layer([captureLogger], { mergeWithExisting: false })),
    );
  });
});

describe("QueueResourceStore static telemetry — legacy payload decode", () => {
  it.live("string 'undefined' decodes as absent optional fields (legacy compat)", () =>
    Effect.gen(function* () {
      const storage = yield* RuntimeStorage;
      const legacyId = `${queueId}/legacy/enqueued`;
      yield* storage.create({
        id: legacyId,
        type: "Queue.Entry.Enqueued",
        occurredAt: DateTime.makeUnsafe(t(0)),
        createdAt: DateTime.makeUnsafe(t(0)),
        runId: "legacy-decode-test",
        processType: "QueueResource",
        processId: queueId,
        subjectType: "QueueEntry",
        subjectId: entryId,
        payload: {
          id: legacyId,
          entryId,
          occurredAt: t(0),
          enqueuedAt: t(0),
          // old payloads sometimes stored the string "undefined" for optional fields
          priority: "undefined",
          key: "undefined",
          batchId: "undefined",
        },
      });
      const store = yield* QueueResourceStore;
      const rows = yield* store.entries({ queueId, types: ["Queue.Entry.Enqueued"] });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.priority).toBeUndefined();
      expect(rows[0]?.key).toBeUndefined();
      expect(rows[0]?.batchId).toBeUndefined();
    }).pipe(Effect.provide(Layer.mergeAll(ProcessStorage.layer, RuntimeStorage.layer))),
  );
});
