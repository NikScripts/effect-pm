import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Scope } from "effect";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProcessId } from "../src";
import { makeRuntimeStorage } from "../src/storage/sqlite";
import { describeRuntimeStorageContract, runtimeStorageRecord } from "./runtime-storage.conformance";

const inMemoryStorage = makeRuntimeStorage({ filename: ":memory:" }).pipe(Effect.orDie);

describeRuntimeStorageContract("SQLiteRuntimeStorage contract", inMemoryStorage);

describe("SQLiteRuntimeStorage persistence", () => {
  it.live("survives separate database connections on disk", () =>
    Effect.gen(function* () {
      const dir = join(tmpdir(), `effect-pm-sqlite-${randomUUID()}`);
      const scope = yield* Scope.Scope;
      yield* Scope.addFinalizer(
        scope,
        Effect.promise(() => rm(dir, { recursive: true, force: true })),
      );
      yield* Effect.promise(() => mkdir(dir, { recursive: true }));
      const filename = join(dir, "runtime.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const storage1 = yield* makeRuntimeStorage({ filename }).pipe(Effect.orDie);
          yield* storage1.create(
            runtimeStorageRecord("persisted", {
              occurredAt: DateTime.makeUnsafe("2026-02-01T12:00:00.000Z"),
              payload: { hello: "world" },
              indexNames: ["a", "b"],
            }),
          );
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const storage2 = yield* makeRuntimeStorage({ filename }).pipe(Effect.orDie);
          const rows = yield* storage2.read({ predicate: ProcessId.equals("queue-contract") });

          expect(rows.map((row) => row.id)).toEqual(["persisted"]);
          const row = rows[0];
          expect(row).toBeDefined();
          expect(row?.payload).toEqual({ hello: "world" });
          expect(row?.indexNames).toEqual(["a", "b"]);
          expect(DateTime.formatIso(row!.occurredAt)).toBe("2026-02-01T12:00:00.000Z");
        }),
      );
    }),
  );
});
