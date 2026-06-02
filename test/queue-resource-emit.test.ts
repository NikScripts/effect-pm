/**
 * Conformance for scoped queue emit helpers and static telemetry wiring.
 *
 * Complements {@link ./queue-resource-store-facet.test.ts} (reads / `for`) and
 * {@link ./queue-resource.test.ts} (worker integration).
 */

import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";
import { ProcessStore } from "../src/ProcessStore";
import { ProcessStorage } from "../src/ProcessStorage";
import { RuntimeStorage } from "../src/RuntimeStorage";
import {
  emitDedupeKeyChange,
  emitDedupeKeyChanges,
  emitEntryFact,
  emitEntryFacts,
  emitLifecycleChange,
  emitLifecycleChanges,
  emitRateLimitExceededFact,
  QueueResourceStore,
  type QueueDedupeKeyChange,
  type QueueEntryFact,
  type QueueLifecycleChange,
  type QueueRateLimitExceededFact,
} from "../src/store/queueResource";

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
  {
    id: `${queueId}/lifecycle/started`,
    queueId,
    type: "Queue.Lifecycle.Started",
    changedAt: t(0),
  },
  {
    id: `${queueId}/lifecycle/paused`,
    queueId,
    type: "Queue.Lifecycle.Paused",
    changedAt: t(10),
  },
  {
    id: `${queueId}/lifecycle/resumed`,
    queueId,
    type: "Queue.Lifecycle.Resumed",
    changedAt: t(20),
  },
  {
    id: `${queueId}/lifecycle/shutdown`,
    queueId,
    type: "Queue.Lifecycle.Shutdown",
    changedAt: t(30),
  },
  {
    id: `${queueId}/lifecycle/cleared`,
    queueId,
    type: "Queue.Lifecycle.Cleared",
    changedAt: t(40),
    itemsCleared: 5,
  },
  {
    id: `${queueId}/lifecycle/drained`,
    queueId,
    type: "Queue.Lifecycle.Drained",
    changedAt: t(50),
  },
];

const allDedupeChanges = (): ReadonlyArray<QueueDedupeKeyChange> => [
  {
    id: `${queueId}/k1/added`,
    queueId,
    key: "k1",
    type: "Queue.DedupeKey.Added",
    changedAt: t(0),
  },
  {
    id: `${queueId}/k1/released`,
    queueId,
    key: "k1",
    type: "Queue.DedupeKey.Released",
    changedAt: t(10),
  },
  {
    id: `${queueId}/k2/hydrated`,
    queueId,
    key: "k2",
    type: "Queue.DedupeKey.Hydrated",
    changedAt: t(20),
  },
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

describe("queue emit helpers — silent without facet layer", () => {
  it.live("single and batch emitters no-op", () =>
    Effect.gen(function* () {
      yield* emitEntryFact(enqueued());
      yield* emitEntryFacts(allEntryFacts());
      yield* emitLifecycleChange(allLifecycleChanges()[0]!);
      yield* emitLifecycleChanges(allLifecycleChanges());
      yield* emitDedupeKeyChange(allDedupeChanges()[0]!);
      yield* emitDedupeKeyChanges([]);
      yield* emitDedupeKeyChanges(allDedupeChanges());
      yield* emitRateLimitExceededFact(rateLimitFact());
      expect(true).toBe(true);
    }),
  );
});

describe("queue emit helpers — persistence", () => {
  const storageLayer = Layer.mergeAll(
    ProcessStorage.layer,
    RuntimeStorage.layer,
  );

  it.live("emitEntryFacts writes every entry wire type", () =>
    Effect.gen(function* () {
      yield* emitEntryFacts(allEntryFacts());
      const store = yield* QueueResourceStore;
      const rows = yield* store.entries({ queueId });
      expect(rows.map((row) => row.type).sort()).toEqual(
        allEntryFacts()
          .map((fact) => fact.type)
          .sort(),
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

  it.live("emitLifecycleChanges writes every lifecycle wire type", () =>
    Effect.gen(function* () {
      yield* emitLifecycleChanges(allLifecycleChanges());
      const store = yield* QueueResourceStore;
      const rows = yield* store.lifecycle({ queueId });
      expect(rows.map((row) => row.type).sort()).toEqual(
        allLifecycleChanges()
          .map((change) => change.type)
          .sort(),
      );
      const cleared = rows.find((row) => row.type === "Queue.Lifecycle.Cleared");
      if (cleared?.type !== "Queue.Lifecycle.Cleared") {
        throw new Error("expected cleared lifecycle row");
      }
      expect(cleared.itemsCleared).toBe(5);
    }).pipe(Effect.provide(storageLayer)),
  );

  it.live("emitDedupeKeyChanges writes Added, Released, and Hydrated", () =>
    Effect.gen(function* () {
      yield* emitDedupeKeyChanges(allDedupeChanges());
      const store = yield* QueueResourceStore;
      const rows = yield* store.dedupeKeys({ queueId });
      expect(rows.map((row) => row.type).sort()).toEqual([
        "Queue.DedupeKey.Added",
        "Queue.DedupeKey.Hydrated",
        "Queue.DedupeKey.Released",
      ]);
    }).pipe(Effect.provide(storageLayer)),
  );

  it.live("emitRateLimitExceededFact roundtrips indexed limitKey", () =>
    Effect.gen(function* () {
      yield* emitRateLimitExceededFact(rateLimitFact());
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
      yield* emitEntryFact(minimal);
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

  it.live("legacy string undefined decodes as absent optional fields", () =>
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
    }).pipe(Effect.provide(storageLayer)),
  );

  it.live("batchId and releaseId are queryable via indexed projections", () =>
    Effect.gen(function* () {
      const batchEntryId = `${queueId}/batch-index-entry`;
      const releasedEntryId = `${queueId}/released-index-entry`;
      yield* emitEntryFact(
        enqueued({
          entryId: batchEntryId,
          id: `${queueId}/${batchEntryId}/enqueued`,
          batchId: "batch-index",
          key: "key-index",
        }),
      );
      yield* emitEntryFact({
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

describe("queue emit helpers — Telemetry.logWarning semantics", () => {
  it.live("duplicate create is swallowed (best-effort telemetry; no typed error)", () =>
    Effect.gen(function* () {
      const fact = enqueued({
        id: `${queueId}/duplicate/enqueued`,
        entryId: `${queueId}/duplicate/entry`,
      });
      yield* emitEntryFact(fact);
      const second = yield* Effect.exit(emitEntryFact(fact));
      expect(second._tag).toBe("Success");
      yield* emitEntryFact(fact).pipe(
        ProcessStore.catchErrorAndLog({
          message: "queue duplicate should not reach catchErrorAndLog",
        }),
      );
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("queue emit helpers — static telemetry parity", () => {
  it.live("emitEntryFact matches QueueResourceStore.Entry.Enqueued", () =>
    Effect.gen(function* () {
      const fact = enqueued({
        id: `${queueId}/parity/enqueued`,
        entryId: `${queueId}/parity/entry`,
        key: "parity-key",
        batchId: "parity-batch",
      });
      yield* emitEntryFact(fact);
      const store = yield* QueueResourceStore;
      const viaEmit = yield* store.entries({
        queueId,
        entryId: fact.entryId,
        types: ["Queue.Entry.Enqueued"],
      });
      expect(viaEmit).toHaveLength(1);
      expect(viaEmit[0]?.batchId).toBe("parity-batch");
      expect(viaEmit[0]?.key).toBe("parity-key");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});
