/**
 * Conformance suite for the {@link QueueResourceStore} facet.
 *
 * Verifies (a) the no-op vs persist semantics of scoped emit helpers
 * (`emitEntryFact`, …) and static telemetry, (b) explicit
 * failure-isolation through `ProcessStore.catchErrorAndLog`, (c) entry / lifecycle
 * / dedupe-key read projections including pushable predicates
 * (`queueId`, `entryId`, `batchId`, `releaseId`, `key`), and (d) the
 * phantom type accessors `.Type` / `.EmitType`.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Logger } from "effect";
import { ProcessStore } from "../src/ProcessStore";
import { ProcessStorage } from "../src/ProcessStorage";
import { ProcessStoreReadonlyRecordError } from "../src/ProcessStoreEvent";
import {
  emitDedupeKeyChange,
  emitEntryFact,
  emitLifecycleChange,
  QueueResourceStore,
  type QueueDedupeKeyChange,
  type QueueEntryCompletedFact,
  type QueueEntryEnqueuedFact,
  type QueueEntryFact,
  type QueueEntryReleasedFact,
  type QueueLifecycleChange,
} from "../src/store/queueResource";

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

const lifecycleStarted = (
  queueId: string,
  changedAt: number,
): QueueLifecycleChange => ({
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

const dedupeAdded = (
  queueId: string,
  key: string,
  changedAt: number,
): QueueDedupeKeyChange => ({
  id: `${queueId}/${key}/added`,
  queueId,
  key,
  type: "Queue.DedupeKey.Added",
  changedAt,
});

const dedupeReleased = (
  queueId: string,
  key: string,
  changedAt: number,
): QueueDedupeKeyChange => ({
  id: `${queueId}/${key}/released`,
  queueId,
  key,
  type: "Queue.DedupeKey.Released",
  changedAt,
});

describe("QueueResourceStore — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* emitEntryFact(
        enqueued("@test/Absent", "@test/Absent/entry/1", 1_700_000_000_000),
      );
      yield* emitLifecycleChange(
        lifecycleStarted("@test/Absent", 1_700_000_000_000),
      );
      yield* emitDedupeKeyChange(
        dedupeAdded("@test/Absent", "k1", 1_700_000_000_000),
      );
      expect(true).toBe(true);
    }),
  );

  it.live("persists through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      const queueId = "@test/Persist";
      yield* emitEntryFact(
        enqueued(queueId, `${queueId}/entry/1`, 1_700_000_000_000),
      );
      yield* emitEntryFact(
        completed(
          queueId,
          `${queueId}/entry/1`,
          1_700_000_000_010,
          1_700_000_000_000,
          10,
        ),
      );
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.entries({ queueId });
      expect(rows.map((row) => row.type).sort()).toEqual([
        "Queue.Entry.Completed",
        "Queue.Entry.Enqueued",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("surfaces write failures unless explicitly caught and logged", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    const blocked = Effect.fail(
      new ProcessStoreReadonlyRecordError({ id: "blocked-entry" }),
    );
    const blockedEmit = Object.assign((_input: unknown) => blocked, { batch: (_inputs: ReadonlyArray<unknown>) => blocked });
    const noopEmit = Object.assign(
      (_input: unknown) => Effect.void,
      { batch: (_inputs: ReadonlyArray<unknown>) => Effect.void },
    );
    const failingFacet = {
      Entry: {
        Enqueued: blockedEmit,
        Started: noopEmit,
        Completed: noopEmit,
        Failed: noopEmit,
        Retried: noopEmit,
        Exhausted: noopEmit,
        Released: noopEmit,
        DeadLettered: noopEmit,
        Dropped: noopEmit,
      },
      Lifecycle: {
        Started: noopEmit,
        Paused: noopEmit,
        Resumed: noopEmit,
        Shutdown: noopEmit,
        Cleared: noopEmit,
        Drained: noopEmit,
      },
      DedupeKey: {
        Added: noopEmit,
        Released: noopEmit,
        Hydrated: noopEmit,
      },
      RateLimit: {
        Exceeded: noopEmit,
      },
      entries: () => Effect.succeed([]),
      entriesByKey: () => Effect.succeed([]),
      lifecycle: () => Effect.succeed([]),
      dedupeKeys: () => Effect.succeed([]),
      rateLimits: () => Effect.succeed([]),
    };
    const fact = enqueued("@test/Failing", "@test/Failing/entry/1", 1);
    const write = emitEntryFact(fact);
    return Effect.gen(function* () {
      const error = yield* Effect.flip(write);
      expect(error).toBeInstanceOf(ProcessStoreReadonlyRecordError);
      yield* write.pipe(
        ProcessStore.catchErrorAndLog({
          message: "test queue write failed",
          annotations: { test: "queue-emit" },
        }),
      );
      expect(captured.some((m) => m.includes("test queue write failed"))).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          // @ts-expect-error — intentional test double: instance emitters are typed
          // Effect<void, never, never> (logWarning absorbed), but blockedEmit fails at
          // runtime to exercise the static-emitter error path through optionalFacetEmit.
          Layer.succeed(QueueResourceStore, failingFacet),
          Logger.layer([captureLogger], { mergeWithExisting: false }),
        ),
      ),
    );
  });
});

describe("QueueResourceStore — released roundtrip", () => {
  it.live("writes and reads Queue.Entry.Released", () =>
    Effect.gen(function* () {
      const queueId = "@test/ReleasedOnly";
      yield* emitEntryFact(
        released(queueId, `${queueId}/e1`, 1_700_000_000_200, "release-9"),
      );
      yield* emitEntryFact(
        enqueued(queueId, `${queueId}/e2`, 1_700_000_000_100),
      );
      const facet = yield* QueueResourceStore;
      const all = yield* facet.entries({ queueId });
      expect(all.map((row) => row.type)).toContain("Queue.Entry.Enqueued");
      expect(all.map((row) => row.type)).toContain("Queue.Entry.Released");
      const rows = yield* facet.entries({
        queueId,
        types: ["Queue.Entry.Released"],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("Queue.Entry.Released");
      if (rows[0]?.type === "Queue.Entry.Released") {
        expect(rows[0].releaseId).toBe("release-9");
      }
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("QueueResourceStore — entry projections", () => {
  const queueA = "@test/QueueA";
  const queueB = "@test/QueueB";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    yield* emitEntryFact(
      enqueued(queueA, `${queueA}/entry/1`, t(0), {
        key: "job-1",
        batchId: "batch-1",
      }),
    );
    yield* emitEntryFact(
      completed(queueA, `${queueA}/entry/1`, t(50), t(0), 50, {
        key: "job-1",
      }),
    );
    yield* emitEntryFact(
      failed(queueA, `${queueA}/entry/2`, t(120), t(60), 60, "boom"),
    );
    yield* emitEntryFact(
      released(queueA, `${queueA}/entry/3`, t(200), "release-9"),
    );
    yield* emitEntryFact(
      enqueued(queueB, `${queueB}/entry/1`, t(75), { key: "job-1" }),
    );
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
      const rows = yield* facet.entries({
        queueId: queueA,
        types: ["Queue.Entry.Failed"],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("Queue.Entry.Failed");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entries({ queueId, entryId }) filters by entry id", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* QueueResourceStore;
      const rows = yield* facet.entries({
        queueId: queueA,
        entryId: `${queueA}/entry/1`,
      });
      expect(rows.every((row) => row.entryId === `${queueA}/entry/1`)).toBe(
        true,
      );
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
          (row) =>
            row.type !== "Queue.Entry.Enqueued" || row.batchId === "batch-1",
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
      const rows = yield* facet.entries({
        queueId: queueA,
        opts: { limit: 1 },
      });
      expect(rows).toHaveLength(1);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live(
    "entriesByKey isolates the requested key when many keys share storage",
    () =>
      Effect.gen(function* () {
        // Establishes that `entriesByKey(target)` is a pushed Key.equals,
        // not a post-filter — the result MUST contain only "target" rows
        // even when storage holds many rows for unrelated keys, with any
        // `limit` applied to the per-key projection.
        const facet = yield* QueueResourceStore;
        const baseT = 1_700_000_000_000;
        for (let i = 0; i < 5; i++) {
          yield* emitEntryFact(
            enqueued("@test/Bulk", `entry/noise-${String(i)}`, baseT + i, {
              key: "noise",
            }),
          );
        }
        for (let i = 0; i < 3; i++) {
          yield* emitEntryFact(
            enqueued("@test/Bulk", `entry/target-${String(i)}`, baseT + 100 + i, {
              key: "target",
            }),
          );
        }
        const all = yield* facet.entriesByKey("target");
        expect(all).toHaveLength(3);
        expect(all.every((row) => row.key === "target")).toBe(true);
        const limited = yield* facet.entriesByKey("target", {
          opts: { limit: 2 },
        });
        expect(limited).toHaveLength(2);
        expect(limited.every((row) => row.key === "target")).toBe(true);
      }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("QueueResourceStore — lifecycle and dedupe-key projections", () => {
  const queueId = "@test/Lifecycle";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    yield* emitLifecycleChange(lifecycleStarted(queueId, t(0)));
    yield* emitLifecycleChange(lifecycleCleared(queueId, t(100), 3));
    yield* emitDedupeKeyChange(dedupeAdded(queueId, "k1", t(10)));
    yield* emitDedupeKeyChange(dedupeReleased(queueId, "k1", t(50)));
    yield* emitDedupeKeyChange(dedupeAdded(queueId, "k2", t(20)));
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
      const rows = yield* facet.lifecycle({
        queueId,
        types: ["Queue.Lifecycle.Started"],
      });
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

describe("QueueResourceStore — for(queueId) bound API", () => {
  const queueA = "@test/ForA";
  const queueB = "@test/ForB";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    yield* emitEntryFact(
      enqueued(queueA, `${queueA}/entry/1`, t(0), { key: "shared" }),
    );
    yield* emitEntryFact(
      enqueued(queueB, `${queueB}/entry/1`, t(0), { key: "shared" }),
    );
    yield* emitLifecycleChange(lifecycleStarted(queueA, t(5)));
    yield* emitLifecycleChange(lifecycleStarted(queueB, t(5)));
    yield* emitDedupeKeyChange(dedupeAdded(queueA, "k1", t(10)));
    yield* emitDedupeKeyChange(dedupeAdded(queueB, "k1", t(10)));
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
});

describe("QueueResourceStore — phantom type accessors", () => {
  it.live(".Type and .EmitType expose the structural shapes", () =>
    Effect.sync(() => {
      const noopEmit = Object.assign(
        (_input: unknown) => Effect.void,
        {
          batch: (_inputs: ReadonlyArray<unknown>) => Effect.void,
        },
      );
      const emitShape: QueueResourceStore.EmitType = {
        Entry: {
          Enqueued: noopEmit,
          Started: noopEmit,
          Completed: noopEmit,
          Failed: noopEmit,
          Retried: noopEmit,
          Exhausted: noopEmit,
          Released: noopEmit,
          DeadLettered: noopEmit,
          Dropped: noopEmit,
        },
        Lifecycle: {
          Started: noopEmit,
          Paused: noopEmit,
          Resumed: noopEmit,
          Shutdown: noopEmit,
          Cleared: noopEmit,
          Drained: noopEmit,
        },
        DedupeKey: {
          Added: noopEmit,
          Released: noopEmit,
          Hydrated: noopEmit,
        },
        RateLimit: {
          Exceeded: noopEmit,
        },
      };
      const fullShape: QueueResourceStore.Type = {
        ...emitShape,
        entries: () => Effect.succeed([]),
        entriesByKey: () => Effect.succeed([]),
        lifecycle: () => Effect.succeed([]),
        dedupeKeys: () => Effect.succeed([]),
        rateLimits: () => Effect.succeed([]),
      };
      const boundShape: QueueResourceStore.IdentifierType = {
        entries: () => Effect.succeed([]),
        entriesByKey: () => Effect.succeed([]),
        lifecycle: () => Effect.succeed([]),
        dedupeKeys: () => Effect.succeed([]),
        rateLimits: () => Effect.succeed([]),
      };
      expect(typeof fullShape.Entry.Enqueued).toBe("function");
      expect(typeof emitShape.Lifecycle.Started).toBe("function");
      expect(typeof boundShape.entries).toBe("function");
    }),
  );
});
