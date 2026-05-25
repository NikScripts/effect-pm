/**
 * Conformance suite for the {@link ProcessStoreQueueResource} facet.
 *
 * Verifies (a) the no-op vs persist semantics of the static optional
 * emitters built by `ProcessStore.Service`, (b) the built-in
 * failure-isolation `catchCause + logWarning` wrap, (c) entry / lifecycle
 * / dedupe-key read projections including pushable predicates
 * (`queueId`, `entryId`, `batchId`, `releaseId`, `key`), and (d) the
 * phantom type accessors `.Type` / `.EmitType`.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Logger } from "effect";
import { ProcessStorage } from "../src/ProcessStorage";
import { ProcessStoreReadonlyRecordError } from "../src/ProcessStoreEvent";
import {
  ProcessStoreQueueResource,
  type QueueDedupeKeyChange,
  type QueueEntryFact,
  type QueueLifecycleChange,
} from "../src/store/queueResource";

const enqueued = (
  queueId: string,
  entryId: string,
  occurredAt: number,
  overrides?: Partial<QueueEntryFact>,
): QueueEntryFact => ({
  id: `${queueId}/${entryId}/enqueued`,
  queueId,
  entryId,
  type: "queue.entry.enqueued",
  occurredAt,
  enqueuedAt: occurredAt,
  priority: "normal",
  attempts: 1,
  ...(overrides as Record<string, never>),
});

const completed = (
  queueId: string,
  entryId: string,
  occurredAt: number,
  startedAt: number,
  durationMs: number,
  overrides?: Partial<QueueEntryFact>,
): QueueEntryFact => ({
  id: `${queueId}/${entryId}/completed`,
  queueId,
  entryId,
  type: "queue.entry.completed",
  occurredAt,
  startedAt,
  durationMs,
  priority: "normal",
  attempts: 1,
  ...(overrides as Record<string, never>),
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
  type: "queue.entry.failed",
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
  type: "queue.lifecycle.started",
  changedAt,
});

const lifecycleCleared = (
  queueId: string,
  changedAt: number,
  itemsCleared: number,
): QueueLifecycleChange => ({
  id: `${queueId}/lifecycle/cleared/${String(changedAt)}`,
  queueId,
  type: "queue.lifecycle.cleared",
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
  type: "queue.dedupe-key.added",
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
  type: "queue.dedupe-key.released",
  changedAt,
});

describe("ProcessStoreQueueResource — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* ProcessStoreQueueResource.recordEntry(
        enqueued("@test/Absent", "@test/Absent/entry/1", 1_700_000_000_000),
      );
      yield* ProcessStoreQueueResource.recordLifecycle(
        lifecycleStarted("@test/Absent", 1_700_000_000_000),
      );
      yield* ProcessStoreQueueResource.recordDedupeKey(
        dedupeAdded("@test/Absent", "k1", 1_700_000_000_000),
      );
      expect(true).toBe(true);
    }),
  );

  it.live("persists through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      const queueId = "@test/Persist";
      yield* ProcessStoreQueueResource.recordEntry(
        enqueued(queueId, `${queueId}/entry/1`, 1_700_000_000_000),
      );
      yield* ProcessStoreQueueResource.recordEntry(
        completed(
          queueId,
          `${queueId}/entry/1`,
          1_700_000_000_010,
          1_700_000_000_000,
          10,
        ),
      );
      const facet = yield* ProcessStoreQueueResource;
      const rows = yield* facet.entries({ queueId });
      expect(rows.map((row) => row.type).sort()).toEqual([
        "queue.entry.completed",
        "queue.entry.enqueued",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("isolates write failures behind a warning log", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    const failingFacet: ProcessStoreQueueResource.Type = {
      recordEntry: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-entry" }),
        ),
      recordEntryBatch: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-entry-batch" }),
        ),
      recordLifecycle: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-lifecycle" }),
        ),
      recordLifecycleBatch: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({
            id: "blocked-lifecycle-batch",
          }),
        ),
      recordDedupeKey: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-dedupe" }),
        ),
      recordDedupeKeyBatch: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({
            id: "blocked-dedupe-batch",
          }),
        ),
      entries: () => Effect.succeed([]),
      entriesByKey: () => Effect.succeed([]),
      lifecycle: () => Effect.succeed([]),
      dedupeKeys: () => Effect.succeed([]),
    };
    return ProcessStoreQueueResource.recordEntry(
      enqueued("@test/Failing", "@test/Failing/entry/1", 1),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ProcessStoreQueueResource, failingFacet),
          Logger.layer([captureLogger], { mergeWithExisting: false }),
        ),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          expect(
            captured.some((m) => m.includes("write failed for recordEntry")),
          ).toBe(true);
        }),
      ),
    );
  });
});

describe("ProcessStoreQueueResource — entry projections", () => {
  const queueA = "@test/QueueA";
  const queueB = "@test/QueueB";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    const facet = yield* ProcessStoreQueueResource;
    yield* facet.recordEntry(
      enqueued(queueA, `${queueA}/entry/1`, t(0), {
        key: "job-1",
        batchId: "batch-1",
      }),
    );
    yield* facet.recordEntry(
      completed(queueA, `${queueA}/entry/1`, t(50), t(0), 50, {
        key: "job-1",
      }),
    );
    yield* facet.recordEntry(
      failed(queueA, `${queueA}/entry/2`, t(120), t(60), 60, "boom"),
    );
    yield* facet.recordEntry({
      id: `${queueA}/entry/3/released`,
      queueId: queueA,
      entryId: `${queueA}/entry/3`,
      type: "queue.entry.released",
      occurredAt: t(200),
      releaseId: "release-9",
      priority: "high",
      attempts: 1,
    });
    yield* facet.recordEntry(
      enqueued(queueB, `${queueB}/entry/1`, t(75), { key: "job-1" }),
    );
  });

  it.live("entries({ queueId }) returns rows for the requested queue", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* ProcessStoreQueueResource;
      const rows = yield* facet.entries({ queueId: queueA });
      expect(rows.every((row) => row.queueId === queueA)).toBe(true);
      expect(rows.map((row) => row.type).sort()).toEqual([
        "queue.entry.completed",
        "queue.entry.enqueued",
        "queue.entry.failed",
        "queue.entry.released",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entries({ queueId, types }) filters by status", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* ProcessStoreQueueResource;
      const rows = yield* facet.entries({
        queueId: queueA,
        types: ["queue.entry.failed"],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("queue.entry.failed");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entries({ queueId, entryId }) filters by entry id", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* ProcessStoreQueueResource;
      const rows = yield* facet.entries({
        queueId: queueA,
        entryId: `${queueA}/entry/1`,
      });
      expect(rows.every((row) => row.entryId === `${queueA}/entry/1`)).toBe(
        true,
      );
      expect(rows.map((row) => row.type).sort()).toEqual([
        "queue.entry.completed",
        "queue.entry.enqueued",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entries({ batchId }) and entries({ releaseId }) push indexed predicates", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* ProcessStoreQueueResource;
      const byBatch = yield* facet.entries({ batchId: "batch-1" });
      expect(
        byBatch.every(
          (row) =>
            row.type !== "queue.entry.enqueued" || row.batchId === "batch-1",
        ),
      ).toBe(true);

      const byRelease = yield* facet.entries({ releaseId: "release-9" });
      expect(byRelease).toHaveLength(1);
      const first = byRelease[0];
      if (first?.type !== "queue.entry.released") {
        throw new Error("expected released fact");
      }
      expect(first.releaseId).toBe("release-9");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entriesByKey returns rows across queues for a shared key", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* ProcessStoreQueueResource;
      const rows = yield* facet.entriesByKey("job-1");
      expect(rows.every((row) => row.key === "job-1")).toBe(true);
      const queues = new Set(rows.map((row) => row.queueId));
      expect(queues.has(queueA)).toBe(true);
      expect(queues.has(queueB)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("entries respects opts.limit after post-filtering", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* ProcessStoreQueueResource;
      const rows = yield* facet.entries({
        queueId: queueA,
        opts: { limit: 1 },
      });
      expect(rows).toHaveLength(1);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessStoreQueueResource — lifecycle and dedupe-key projections", () => {
  const queueId = "@test/Lifecycle";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  const fixtures = Effect.gen(function* () {
    const facet = yield* ProcessStoreQueueResource;
    yield* facet.recordLifecycle(lifecycleStarted(queueId, t(0)));
    yield* facet.recordLifecycle(lifecycleCleared(queueId, t(100), 3));
    yield* facet.recordDedupeKey(dedupeAdded(queueId, "k1", t(10)));
    yield* facet.recordDedupeKey(dedupeReleased(queueId, "k1", t(50)));
    yield* facet.recordDedupeKey(dedupeAdded(queueId, "k2", t(20)));
  });

  it.live("lifecycle({ queueId }) returns ordered lifecycle changes", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* ProcessStoreQueueResource;
      const rows = yield* facet.lifecycle({ queueId });
      expect(rows.map((row) => row.type)).toEqual([
        "queue.lifecycle.cleared",
        "queue.lifecycle.started",
      ]);
      const cleared = rows.find((row) => row.type === "queue.lifecycle.cleared");
      if (cleared?.type !== "queue.lifecycle.cleared") {
        throw new Error("expected cleared change");
      }
      expect(cleared.itemsCleared).toBe(3);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("lifecycle filters by type", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* ProcessStoreQueueResource;
      const rows = yield* facet.lifecycle({
        queueId,
        types: ["queue.lifecycle.started"],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("queue.lifecycle.started");
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("dedupeKeys({ queueId }) returns all changes for the queue", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* ProcessStoreQueueResource;
      const rows = yield* facet.dedupeKeys({ queueId });
      expect(rows.every((row) => row.queueId === queueId)).toBe(true);
      expect(rows.map((row) => row.type).sort()).toEqual([
        "queue.dedupe-key.added",
        "queue.dedupe-key.added",
        "queue.dedupe-key.released",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("dedupeKeys filters by key", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* ProcessStoreQueueResource;
      const rows = yield* facet.dedupeKeys({ queueId, key: "k1" });
      expect(rows.every((row) => row.key === "k1")).toBe(true);
      expect(rows.map((row) => row.type).sort()).toEqual([
        "queue.dedupe-key.added",
        "queue.dedupe-key.released",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessStoreQueueResource — phantom type accessors", () => {
  it.live(".Type and .EmitType expose the structural shapes", () =>
    Effect.gen(function* () {
      const fullShape: ProcessStoreQueueResource.Type = {
        recordEntry: () => Effect.void,
        recordEntryBatch: () => Effect.void,
        recordLifecycle: () => Effect.void,
        recordLifecycleBatch: () => Effect.void,
        recordDedupeKey: () => Effect.void,
        recordDedupeKeyBatch: () => Effect.void,
        entries: () => Effect.succeed([]),
        entriesByKey: () => Effect.succeed([]),
        lifecycle: () => Effect.succeed([]),
        dedupeKeys: () => Effect.succeed([]),
      };
      const emitShape: ProcessStoreQueueResource.EmitType = {
        recordEntry: fullShape.recordEntry,
        recordEntryBatch: fullShape.recordEntryBatch,
        recordLifecycle: fullShape.recordLifecycle,
        recordLifecycleBatch: fullShape.recordLifecycleBatch,
        recordDedupeKey: fullShape.recordDedupeKey,
        recordDedupeKeyBatch: fullShape.recordDedupeKeyBatch,
      };
      expect(typeof fullShape.recordEntry).toBe("function");
      expect(typeof emitShape.recordLifecycle).toBe("function");
    }),
  );
});
