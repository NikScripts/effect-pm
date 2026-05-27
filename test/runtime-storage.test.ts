import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, pipe } from "effect";
import {
  Attributes,
  Delete,
  IndexA,
  Insert,
  Key,
  Limit,
  Occurred,
  OrderBy,
  Payload,
  ProcessId,
  Readonly,
  RuntimeStorage,
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
  Select,
  SubjectType,
  Update,
  Upsert,
  Where,
  type RuntimeRecord,
  type RuntimeStorageService,
} from "../src";
import { describeRuntimeStorageContract } from "./runtime-storage.conformance";

const dt = (iso: string): DateTime.Utc => DateTime.makeUnsafe(iso);

const record = (
  id: string,
  overrides: Partial<RuntimeRecord> = {},
): RuntimeRecord => ({
  id,
  type: "queue.entry.enqueued",
  occurredAt: dt("2026-01-01T00:00:00.000Z"),
  createdAt: dt("2026-01-01T00:00:01.000Z"),
  runId: "run-a",
  processType: "queue",
  processId: "queue-a",
  ...overrides,
});

describeRuntimeStorageContract("RuntimeStorage.memory contract", RuntimeStorage.memory);

describe("RuntimeStorage.memory", () => {
  it.live("creates and reads records with query DSL filters and ordering", () =>
    Effect.gen(function* () {
      const storage = yield* RuntimeStorage.memory;
      const source: Effect.Effect<RuntimeStorageService, never, never> = Effect.succeed(storage);
      yield* pipe(
        source,
        Insert(record("r1", {
          occurredAt: dt("2026-01-01T00:00:00.000Z"),
          subjectType: "queue-entry",
          subjectId: "entry-1",
          key: "key-a",
          indexA: "batch-1",
        })),
      );
      yield* pipe(
        source,
        Insert(record("r2", {
          occurredAt: dt("2026-01-01T00:05:00.000Z"),
          subjectType: "queue-entry",
          subjectId: "entry-2",
          key: "key-b",
          indexA: "batch-1",
        })),
      );
      yield* pipe(
        source,
        Insert(record("r3", {
          occurredAt: dt("2026-01-01T00:10:00.000Z"),
          processId: "queue-b",
          subjectType: "queue-entry",
          subjectId: "entry-3",
          key: "key-a",
          indexA: "batch-2",
        })),
      );

      const rows = yield* pipe(
        source,
        Where(
          ProcessId.equals("queue-a"),
          SubjectType.equals("queue-entry"),
          IndexA.equals("batch-1"),
          Occurred.after(dt("2025-12-31T23:59:00.000Z")),
        ),
        OrderBy.occurredAt,
        Limit(1),
        Select,
      );

      expect(rows.map((row) => row.id)).toEqual(["r2"]);
    }),
  );

  it.live("supports duplicate create errors, upsert, update counts, and readonly delete opt-in", () =>
    Effect.gen(function* () {
      const storage = yield* RuntimeStorage.memory;
      const source: Effect.Effect<RuntimeStorageService, never, never> = Effect.succeed(storage);
      yield* pipe(source, Insert(record("mutable")));
      yield* pipe(source, Insert(record("locked", { readonly: true })));

      const duplicate = yield* pipe(
        source,
        Insert(record("mutable")),
        Effect.flip,
      );
      expect(duplicate).toBeInstanceOf(RuntimeStorageDuplicateRecordError);

      const updated = yield* pipe(
        source,
        Where(ProcessId.equals("queue-a")),
        Update(Payload.set({ status: "updated" }), Attributes.set({ source: "test" })),
      );
      expect(updated).toEqual({ matched: 2, updated: 1 });

      const afterUpdate = yield* pipe(
        source,
        Where(ProcessId.equals("queue-a")),
        OrderBy.occurredAt,
        Select,
      );
      expect(afterUpdate.find((row) => row.id === "mutable")?.payload).toEqual({
        status: "updated",
      });
      expect(afterUpdate.find((row) => row.id === "locked")?.payload).toBeUndefined();

      const readonlyUpsert = yield* pipe(
        source,
        Upsert(record("locked", { type: "changed", readonly: true })),
        Effect.flip,
      );
      expect(readonlyUpsert).toBeInstanceOf(RuntimeStorageReadonlyRecordError);

      const firstDelete = yield* pipe(
        source,
        Where(ProcessId.equals("queue-a")),
        Delete,
      );
      expect(firstDelete).toEqual({ deleted: 1 });

      const secondDelete = yield* pipe(
        source,
        Where(ProcessId.equals("queue-a"), Readonly.equals(true)),
        Delete,
      );
      expect(secondDelete).toEqual({ deleted: 1 });
    }),
  );

  it.live("supports object patches and unset assignments", () =>
    Effect.gen(function* () {
      const storage = yield* RuntimeStorage.memory;
      const source: Effect.Effect<RuntimeStorageService, never, never> = Effect.succeed(storage);
      yield* pipe(
        source,
        Insert(record("a", { key: "key-a", indexA: "batch-a" })),
      );
      yield* pipe(
        source,
        Insert(record("b", { key: "key-b", indexA: "batch-b" })),
      );

      const update = yield* pipe(
        source,
        Where(Key.equals("key-a")),
        Update({
          payload: { ok: true },
          indexA: null,
        }),
      );
      expect(update).toEqual({ matched: 1, updated: 1 });

      const rows = yield* pipe(
        source,
        Where(Key.equals("key-a"), IndexA.isNull),
        Select,
      );
      expect(rows.map((row) => row.id)).toEqual(["a"]);
      expect(rows[0]?.payload).toEqual({ ok: true });
    }),
  );
});
