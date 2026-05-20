import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Scope } from "effect";
import {
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
  type RuntimeRecord,
  type RuntimeStorageService,
} from "../src";
import { Key, ProcessId, Readonly } from "../src/Query";

const dt = (iso: string): DateTime.Utc => DateTime.makeUnsafe(iso);

export const runtimeStorageRecord = (
  id: string,
  overrides: Partial<RuntimeRecord> = {},
): RuntimeRecord => ({
  id,
  type: "queue.entry.enqueued",
  occurredAt: dt("2026-01-01T00:00:00.000Z"),
  createdAt: dt("2026-01-01T00:00:01.000Z"),
  runId: "run-contract",
  processType: "queue-resource",
  processId: "queue-contract",
  ...overrides,
});

export const describeRuntimeStorageContract = <R extends Scope.Scope>(
  name: string,
  makeStorage: Effect.Effect<RuntimeStorageService, never, R>,
) =>
  describe(name, () => {
    it.live("creates, reads, orders, and filters records", () =>
      Effect.gen(function* () {
        const storage = yield* makeStorage;
        yield* storage.create(runtimeStorageRecord("a", {
          occurredAt: dt("2026-01-01T00:00:00.000Z"),
          key: "key-a",
        }));
        yield* storage.create(runtimeStorageRecord("b", {
          occurredAt: dt("2026-01-01T00:05:00.000Z"),
          key: "key-b",
        }));

        const rows = yield* storage.read({
          predicate: ProcessId.equals("queue-contract"),
        });
        const byKey = yield* storage.read({
          predicate: Key.equals("key-a"),
        });

        expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
        expect(byKey.map((row) => row.id)).toEqual(["a"]);
      }),
    );

    it.live("fails duplicate creates and readonly upserts", () =>
      Effect.gen(function* () {
        const storage = yield* makeStorage;
        yield* storage.create(runtimeStorageRecord("a"));
        yield* storage.create(runtimeStorageRecord("locked", { readonly: true }));

        const duplicate = yield* Effect.flip(storage.create(runtimeStorageRecord("a")));
        const readonly = yield* Effect.flip(storage.upsert(runtimeStorageRecord("locked")));

        expect(duplicate).toBeInstanceOf(RuntimeStorageDuplicateRecordError);
        expect(readonly).toBeInstanceOf(RuntimeStorageReadonlyRecordError);
      }),
    );

    it.live("updates mutable records and deletes readonly records only by opt-in", () =>
      Effect.gen(function* () {
        const storage = yield* makeStorage;
        yield* storage.create(runtimeStorageRecord("mutable"));
        yield* storage.create(runtimeStorageRecord("locked", { readonly: true }));

        const update = yield* storage.update(
          { predicate: ProcessId.equals("queue-contract") },
          { payload: { status: "updated" } },
        );
        const firstDelete = yield* storage.delete({
          predicate: ProcessId.equals("queue-contract"),
        });
        const secondDelete = yield* storage.delete({
          predicate: Readonly.equals(true),
        });

        expect(update).toEqual({ matched: 2, updated: 1 });
        expect(firstDelete).toEqual({ deleted: 1 });
        expect(secondDelete).toEqual({ deleted: 1 });
      }),
    );
  });
