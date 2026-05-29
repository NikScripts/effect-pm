import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Scope } from "effect";
import {
  RuntimeStorage,
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
  RuntimeStorageTransactionError,
  type RuntimeRecord,
  type RuntimeStorageService,
} from "../src";
import { And, Key, ProcessId, Readonly } from "../src/Query";

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

    it.live("transaction commits on success and rolls back on failure", () =>
      Effect.gen(function* () {
        const storage = yield* makeStorage;
        yield* storage.create(runtimeStorageRecord("seed"));

        yield* storage.transaction(
          Effect.gen(function* () {
            const tx = yield* RuntimeStorage;
            yield* tx.create(runtimeStorageRecord("committed"));
          }),
        );

        const afterCommit = yield* storage.read({
          predicate: ProcessId.equals("queue-contract"),
        });
        expect(afterCommit.map((row) => row.id).sort()).toEqual(
          ["committed", "seed"].sort(),
        );

        const failure = yield* storage.transaction(
          Effect.gen(function* () {
            const tx = yield* RuntimeStorage;
            yield* tx.create(runtimeStorageRecord("rolled-back"));
            return yield* Effect.fail("rollback");
          }),
        ).pipe(Effect.flip);

        if (failure instanceof RuntimeStorageTransactionError) {
          expect(failure.cause).toBe("rollback");
        } else {
          expect(failure).toBe("rollback");
        }

        const afterRollback = yield* storage.read({
          predicate: ProcessId.equals("queue-contract"),
        });
        expect(afterRollback.map((row) => row.id).sort()).toEqual(
          ["committed", "seed"].sort(),
        );
      }),
    );

    it.live("treats an empty And predicate as no-match", () =>
      Effect.gen(function* () {
        const storage = yield* makeStorage;
        yield* storage.create(runtimeStorageRecord("empty-and"));

        const rows = yield* storage.read({ predicate: And([]) });
        const update = yield* storage.update({ predicate: And([]) }, { payload: { ignored: true } });
        const deleted = yield* storage.delete({ predicate: And([]) });

        expect(rows).toEqual([]);
        expect(update).toEqual({ matched: 0, updated: 0 });
        expect(deleted).toEqual({ deleted: 0 });
      }),
    );
  });
