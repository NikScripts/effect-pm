import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { describe, expect, it } from "@effect/vitest";
import { Context, DateTime, Effect, Layer, Scope } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Key, ProcessId } from "../src";
import { RuntimeStorage } from "../src/RuntimeStorage";
import {
  SQLiteRuntimeStorage,
  layerRuntimeStorage,
  makeRuntimeStorage,
} from "../src/storage/sqlite";
import { describeRuntimeStorageContract, runtimeStorageRecord } from "./runtime-storage.conformance";

const inMemoryStorage = makeRuntimeStorage({ filename: ":memory:" }).pipe(Effect.orDie);

describeRuntimeStorageContract("SQLiteRuntimeStorage contract", inMemoryStorage);

describe("SQLiteRuntimeStorage persistence", () => {
  it.live("survives separate database connections on disk", () =>
    Effect.gen(function* () {
      const baseDir = join(tmpdir(), `effect-pm-sqlite-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        Effect.gen(function* () {
          yield* Effect.promise(() => mkdir(baseDir, { recursive: true }));
          return baseDir;
        }),
        (d) => Effect.promise(() => rm(d, { recursive: true, force: true })),
      );
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

describe("SQLiteRuntimeStorage extended", () => {
  it.live("read with no rows returns an empty array", () =>
    Effect.gen(function* () {
      const storage = yield* makeRuntimeStorage({ filename: ":memory:" }).pipe(Effect.orDie);
      const rows = yield* storage.read();
      expect(rows).toEqual([]);
    }),
  );

  it.live("layerRuntimeStorage exposes RuntimeStorage under Scope", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const context = yield* Layer.buildWithScope(layerRuntimeStorage({ filename: ":memory:" }), scope);
      const storage = Context.get(context, RuntimeStorage);
      yield* storage.create(runtimeStorageRecord("layer-smoke"));
      const rows = yield* storage.read({ predicate: ProcessId.equals("queue-contract") });
      expect(rows.some((r) => r.id === "layer-smoke")).toBe(true);
    }),
  );

  it.live("fromSqlClient can run schema install twice without failing", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const context = yield* Layer.buildWithScope(SqliteClient.layer({ filename: ":memory:" }), scope);
      const sql = Context.get(context, SqlClient);
      const storage1 = yield* SQLiteRuntimeStorage.fromSqlClient(sql).pipe(Effect.orDie);
      const storage2 = yield* SQLiteRuntimeStorage.fromSqlClient(sql).pipe(Effect.orDie);
      yield* storage1.create(runtimeStorageRecord("dup-schema"));
      const rows = yield* storage2.read({ predicate: ProcessId.equals("queue-contract") });
      expect(rows.map((r) => r.id)).toContain("dup-schema");
    }),
  );

  it.live("upsert replaces a mutable row by id", () =>
    Effect.gen(function* () {
      const storage = yield* makeRuntimeStorage({ filename: ":memory:" }).pipe(Effect.orDie);
      yield* storage.create(
        runtimeStorageRecord("mutable-upsert", {
          key: "before",
          payload: { v: 1 },
        }),
      );
      yield* storage.upsert(
        runtimeStorageRecord("mutable-upsert", {
          key: "after",
          payload: { v: 2 },
        }),
      );
      const rows = yield* storage.read({ predicate: ProcessId.equals("queue-contract") });
      const row = rows.find((r) => r.id === "mutable-upsert");
      expect(row?.key).toBe("after");
      expect(row?.payload).toEqual({ v: 2 });
    }),
  );

  it.live("pushes predicate, ordering, limit, and offset through read semantics", () =>
    Effect.gen(function* () {
      const storage = yield* makeRuntimeStorage({ filename: ":memory:" }).pipe(Effect.orDie);
      yield* storage.create(runtimeStorageRecord("a", {
        occurredAt: DateTime.makeUnsafe("2026-02-01T12:00:00.000Z"),
        key: "shared",
      }));
      yield* storage.create(runtimeStorageRecord("b", {
        occurredAt: DateTime.makeUnsafe("2026-02-01T12:01:00.000Z"),
        key: "shared",
      }));
      yield* storage.create(runtimeStorageRecord("c", {
        occurredAt: DateTime.makeUnsafe("2026-02-01T12:02:00.000Z"),
        key: "shared",
      }));

      const rows = yield* storage.read({
        predicate: Key.equals("shared"),
        orderBy: [{ field: "occurredAt", direction: "asc" }],
        limit: 1,
        offset: 1,
      });

      expect(rows.map((row) => row.id)).toEqual(["b"]);
    }),
  );

  it.live("update with no matches returns zero counts", () =>
    Effect.gen(function* () {
      const storage = yield* makeRuntimeStorage({ filename: ":memory:" }).pipe(Effect.orDie);
      const result = yield* storage.update(
        { predicate: ProcessId.equals("no-such-process") },
        { payload: { x: 1 } },
      );
      expect(result).toEqual({ matched: 0, updated: 0 });
    }),
  );

  it.live("delete with no matches returns zero deleted", () =>
    Effect.gen(function* () {
      const storage = yield* makeRuntimeStorage({ filename: ":memory:" }).pipe(Effect.orDie);
      const result = yield* storage.delete({ predicate: ProcessId.equals("no-such-process") });
      expect(result).toEqual({ deleted: 0 });
    }),
  );
});
