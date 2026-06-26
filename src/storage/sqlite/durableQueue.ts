/**
 * **SQLite backend for {@link DurableQueueStore}** — the priority-native durability plane over a
 * single table. Single-writer SQLite serializes, so `take` leases inside a transaction (no
 * `SKIP LOCKED` needed). Lifts `PersistedQueue`'s lease / `attempts` / expiry-recovery blueprint
 * onto a priority-native schema (dedup, escalation, sizes are first-class).
 *
 * Off the core entry — import from `@nikscripts/effect-pm/storage/sqlite`.
 *
 * @module storage/sqlite/durableQueue
 */
import { Clock, Context, Effect, Layer, Option, Schema, Scope } from "effect";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import type { SqliteClientConfig } from "@effect/sql-sqlite-node/SqliteClient";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import {
  DurableQueueError,
  DurableQueueStore,
  durablePriorityRank,
} from "../../DurableQueueStore";
import type {
  DurableEntry,
  DurablePriority,
  DurableQueueStoreShape,
  DurableSizes,
} from "../../DurableQueueStore";

const TABLE = "durable_queue";

// Opaque payload ⇄ JSON column (Schema-based, not raw JSON.parse/stringify). The payload is
// already-encoded JSON owned by the caller, so the sync round-trip can't fail on our own data.
const encodePayload = Schema.encodeSync(Schema.UnknownFromJsonString);
const decodePayload = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);

const ddl: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS ${TABLE} (
     id TEXT PRIMARY KEY NOT NULL,
     queue_id TEXT NOT NULL,
     dedup_key TEXT,
     priority TEXT NOT NULL,
     priority_rank INTEGER NOT NULL,
     seq INTEGER NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     locked_until_ms INTEGER,
     status TEXT NOT NULL DEFAULT 'pending',
     schema_version INTEGER NOT NULL DEFAULT 0,
     payload_json TEXT NOT NULL,
     enqueued_at_ms INTEGER NOT NULL
   )`,
  // dedup is among *live* entries only — a dead row with the same key never blocks a re-offer
  `CREATE UNIQUE INDEX IF NOT EXISTS ${TABLE}_dedup_idx ON ${TABLE}(queue_id, dedup_key) WHERE dedup_key IS NOT NULL AND status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS ${TABLE}_take_idx ON ${TABLE}(queue_id, status, priority_rank, seq)`,
];

/** Narrow an unknown SELECT row to a property bag without unsafe casts. */
const asRecord = (row: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (typeof row === "object" && row !== null) {
    for (const [key, value] of Object.entries(row)) out[key] = value;
  }
  return out;
};

const isPriority = (value: string): value is DurablePriority =>
  value === "high" || value === "normal" || value === "low";

const rowToEntry = (row: unknown): DurableEntry => {
  const r = asRecord(row);
  const priority = String(r["priority"]);
  return {
    id: String(r["id"]),
    queueId: String(r["queue_id"]),
    dedupKey:
      r["dedup_key"] === null || r["dedup_key"] === undefined
        ? null
        : String(r["dedup_key"]),
    priority: isPriority(priority) ? priority : "normal",
    sequence: Number(r["seq"]),
    attempts: Number(r["attempts"]),
    payload: decodePayload(String(r["payload_json"])),
    schemaVersion: Number(r["schema_version"]),
    enqueuedAtMillis: Number(r["enqueued_at_ms"]),
  };
};

const install = (sql: SqlClient): Effect.Effect<void, DurableQueueError> =>
  Effect.forEach(ddl, (stmt) => Effect.asVoid(sql.unsafe(stmt).unprepared), {
    discard: true,
  }).pipe(
    Effect.mapError((cause) => new DurableQueueError({ operation: "install", cause })),
  );

const makeService = (sql: SqlClient): DurableQueueStoreShape => {
  const fail = (operation: string) => (cause: unknown) =>
    new DurableQueueError({ operation, cause });

  return {
    offer: (entry) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const rank = durablePriorityRank[entry.priority];
            if (entry.dedupKey !== undefined) {
              const existing = yield* sql`SELECT id, priority_rank FROM ${sql(TABLE)} WHERE queue_id = ${entry.queueId} AND dedup_key = ${entry.dedupKey} AND status = 'pending' LIMIT 1`;
              const live = existing[0];
              if (live !== undefined) {
                const rec = asRecord(live);
                if (Number(rec["priority_rank"]) > rank) {
                  yield* sql`UPDATE ${sql(TABLE)} SET priority = ${entry.priority}, priority_rank = ${rank} WHERE id = ${String(rec["id"])}`;
                  return "escalated" as const;
                }
                return "deduplicated" as const;
              }
            }
            const maxSeq = yield* sql`SELECT IFNULL(MAX(seq), 0) AS m FROM ${sql(TABLE)}`;
            const seq = Number(asRecord(maxSeq[0])["m"]) + 1;
            const insertRow: Record<string, unknown> = {
              id: entry.id,
              queue_id: entry.queueId,
              dedup_key: entry.dedupKey ?? null,
              priority: entry.priority,
              priority_rank: rank,
              seq,
              attempts: 0,
              locked_until_ms: null,
              status: "pending",
              schema_version: entry.schemaVersion ?? 0,
              payload_json: encodePayload(entry.payload),
              enqueued_at_ms: now,
            };
            yield* sql`INSERT INTO ${sql(TABLE)} ${sql.insert(insertRow)}`;
            return "inserted" as const;
          }),
        )
        .pipe(Effect.mapError(fail("offer"))),

    take: ({ queueId, leaseMillis }) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const rows = yield* sql`SELECT * FROM ${sql(TABLE)} WHERE queue_id = ${queueId} AND status = 'pending' AND (locked_until_ms IS NULL OR locked_until_ms < ${now}) ORDER BY priority_rank ASC, seq ASC LIMIT 1`;
            const row = rows[0];
            if (row === undefined) return Option.none<DurableEntry>();
            const rec = asRecord(row);
            const attempts = Number(rec["attempts"]) + 1;
            yield* sql`UPDATE ${sql(TABLE)} SET locked_until_ms = ${now + leaseMillis}, attempts = ${attempts} WHERE id = ${String(rec["id"])}`;
            return Option.some(rowToEntry({ ...rec, attempts }));
          }),
        )
        .pipe(Effect.mapError(fail("take"))),

    complete: (id) =>
      sql`DELETE FROM ${sql(TABLE)} WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError(fail("complete")),
      ),

    fail: (id, { maxAttempts }) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* sql`SELECT attempts FROM ${sql(TABLE)} WHERE id = ${id} LIMIT 1`;
            const row = rows[0];
            if (row === undefined) return "requeued" as const;
            const attempts = Number(asRecord(row)["attempts"]);
            if (attempts >= maxAttempts) {
              yield* sql`UPDATE ${sql(TABLE)} SET status = 'dead', locked_until_ms = NULL WHERE id = ${id}`;
              return "deadLettered" as const;
            }
            yield* sql`UPDATE ${sql(TABLE)} SET locked_until_ms = NULL WHERE id = ${id}`;
            return "requeued" as const;
          }),
        )
        .pipe(Effect.mapError(fail("fail"))),

    sizes: (queueId) =>
      sql`SELECT priority, COUNT(*) AS c FROM ${sql(TABLE)} WHERE queue_id = ${queueId} AND status = 'pending' GROUP BY priority`.pipe(
        Effect.map((rows) => {
          const sizes = { high: 0, normal: 0, low: 0 };
          for (const row of rows) {
            const rec = asRecord(row);
            const priority = String(rec["priority"]);
            if (isPriority(priority)) sizes[priority] = Number(rec["c"]);
          }
          return sizes satisfies DurableSizes;
        }),
        Effect.mapError(fail("sizes")),
      ),

    recover: (queueId) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const counted = yield* sql`SELECT COUNT(*) AS c FROM ${sql(TABLE)} WHERE queue_id = ${queueId} AND status = 'pending' AND locked_until_ms IS NOT NULL`;
            const count = Number(asRecord(counted[0])["c"]);
            yield* sql`UPDATE ${sql(TABLE)} SET locked_until_ms = NULL WHERE queue_id = ${queueId} AND status = 'pending' AND locked_until_ms IS NOT NULL`;
            return count;
          }),
        )
        .pipe(Effect.mapError(fail("recover"))),

    clear: (queueId) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const counted = yield* sql`SELECT COUNT(*) AS c FROM ${sql(TABLE)} WHERE queue_id = ${queueId} AND status = 'pending'`;
            const count = Number(asRecord(counted[0])["c"]);
            yield* sql`DELETE FROM ${sql(TABLE)} WHERE queue_id = ${queueId} AND status = 'pending'`;
            return count;
          }),
        )
        .pipe(Effect.mapError(fail("clear"))),

    drain: (queueId, match) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            // available backlog (not leased), optionally narrowed to one id / key
            let where = sql`queue_id = ${queueId} AND status = 'pending' AND (locked_until_ms IS NULL OR locked_until_ms < ${now})`;
            if (match.id !== undefined) {
              where = sql`${where} AND id = ${match.id}`;
            } else if (match.key !== undefined) {
              where = sql`${where} AND dedup_key = ${match.key}`;
            }
            const rows = yield* sql`SELECT * FROM ${sql(TABLE)} WHERE ${where} ORDER BY priority_rank ASC, seq ASC`;
            const entries = rows.map(rowToEntry);
            if (entries.length > 0) {
              yield* sql`DELETE FROM ${sql(TABLE)} WHERE ${where}`;
            }
            return entries;
          }),
        )
        .pipe(Effect.mapError(fail("drain"))),
  };
};

/**
 * Install the schema on an existing {@link SqlClient} and return the {@link DurableQueueStore} port
 * — for tests (`:memory:`) or a shared client.
 *
 * @public
 */
export const fromSqlClient = (
  sql: SqlClient,
): Effect.Effect<DurableQueueStoreShape, DurableQueueError> =>
  Effect.map(install(sql), () => makeService(sql));

/**
 * `Layer` providing {@link DurableQueueStore} backed by SQLite (scoped `SqliteClient` lifecycle).
 *
 * @public
 */
export const layer = (
  config: SqliteClientConfig,
): Layer.Layer<DurableQueueStore, DurableQueueError, Scope.Scope> =>
  Layer.effect(
    DurableQueueStore,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const context = yield* Layer.buildWithScope(
        SqliteClient.layer(config),
        scope,
      ).pipe(Effect.mapError((cause) => new DurableQueueError({ operation: "connect", cause })));
      const sql = Context.get(context, SqlClient);
      yield* install(sql);
      return makeService(sql);
    }),
  );

/**
 * SQLite {@link DurableQueueStore} backend.
 *
 * @public
 */
export const SQLiteDurableQueueStore = {
  layer,
  fromSqlClient,
} as const;
