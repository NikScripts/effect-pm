import { describe, expect, it } from "@effect/vitest";
import Database from "better-sqlite3";
import { DateTime, Effect } from "effect";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProcessId } from "../src";
import { SQLiteRuntimeStorage } from "../src/storage/sqlite";
import { describeRuntimeStorageContract, runtimeStorageRecord } from "./runtime-storage.conformance";

describeRuntimeStorageContract(
  "SQLiteRuntimeStorage contract",
  Effect.sync(() => {
    const db = new Database(":memory:");
    return SQLiteRuntimeStorage.fromDatabase(db);
  }),
);

describe("SQLiteRuntimeStorage persistence", () => {
  it.live("survives separate database connections on disk", () =>
    Effect.gen(function* () {
      const dir = join(tmpdir(), `effect-pm-sqlite-${randomUUID()}`);
      yield* Effect.promise(() => mkdir(dir, { recursive: true }));
      const filename = join(dir, "runtime.db");
      try {
        const db1 = new Database(filename);
        const storage1 = SQLiteRuntimeStorage.fromDatabase(db1);
        yield* storage1.create(
          runtimeStorageRecord("persisted", {
            occurredAt: DateTime.makeUnsafe("2026-02-01T12:00:00.000Z"),
            payload: { hello: "world" },
            indexNames: ["a", "b"],
          }),
        );
        db1.close();

        const db2 = new Database(filename);
        const storage2 = SQLiteRuntimeStorage.fromDatabase(db2);
        const rows = yield* storage2.read({ predicate: ProcessId.equals("queue-contract") });
        db2.close();

        expect(rows.map((row) => row.id)).toEqual(["persisted"]);
        const row = rows[0];
        expect(row).toBeDefined();
        expect(row?.payload).toEqual({ hello: "world" });
        expect(row?.indexNames).toEqual(["a", "b"]);
        expect(DateTime.formatIso(row!.occurredAt)).toBe("2026-02-01T12:00:00.000Z");
      } finally {
        yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
      }
    }),
  );
});
