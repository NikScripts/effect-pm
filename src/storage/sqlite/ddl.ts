/**
 * Idempotent schema bootstrap for {@link RUNTIME_RECORDS_TABLE}.
 *
 * @remarks
 * `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` make this safe
 * to run on every connection, including short-lived test databases and
 * long-lived application pools that may reconnect after restarts.
 *
 * Statements are executed through {@link SqlClient} (one statement at a time)
 * so they never rely on multi-statement `Database#exec` behavior.
 *
 * Index coverage follows `docs/RUNTIME-STORAGE-ADAPTER-GUIDE.md`. The adapter
 * still evaluates predicates in TypeScript via {@link selectRuntimeRecords}; the
 * indexes exist so future query push-down or ad hoc SQL stays practical without
 * requiring another migration pass for the obvious access paths.
 *
 * @module storage/sqlite/ddl
 * @internal
 */

import { Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { RUNTIME_RECORDS_TABLE } from "./constants";

const runtimeRecordsDdlStatements = (table: string): ReadonlyArray<string> => [
  `CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      occurred_at_ms INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      process_type TEXT NOT NULL,
      process_id TEXT NOT NULL,
      subject_type TEXT,
      subject_id TEXT,
      key TEXT,
      index_a TEXT,
      index_b TEXT,
      index_c TEXT,
      index_d TEXT,
      index_e TEXT,
      index_f TEXT,
      index_g TEXT,
      index_h TEXT,
      index_names_json TEXT,
      payload_json TEXT,
      attributes_json TEXT,
      readonly_int INTEGER NOT NULL DEFAULT 0
    )`,
  `CREATE INDEX IF NOT EXISTS ${table}_run_id_idx ON ${table}(run_id)`,
  `CREATE INDEX IF NOT EXISTS ${table}_type_idx ON ${table}(type)`,
  `CREATE INDEX IF NOT EXISTS ${table}_process_idx ON ${table}(process_type, process_id)`,
  `CREATE INDEX IF NOT EXISTS ${table}_subject_idx ON ${table}(subject_type, subject_id)`,
  `CREATE INDEX IF NOT EXISTS ${table}_key_idx ON ${table}(key)`,
  `CREATE INDEX IF NOT EXISTS ${table}_occurred_idx ON ${table}(occurred_at_ms)`,
  `CREATE INDEX IF NOT EXISTS ${table}_created_idx ON ${table}(created_at_ms)`,
  `CREATE INDEX IF NOT EXISTS ${table}_index_a_idx ON ${table}(index_a)`,
  `CREATE INDEX IF NOT EXISTS ${table}_index_b_idx ON ${table}(index_b)`,
  `CREATE INDEX IF NOT EXISTS ${table}_index_c_idx ON ${table}(index_c)`,
  `CREATE INDEX IF NOT EXISTS ${table}_index_d_idx ON ${table}(index_d)`,
  `CREATE INDEX IF NOT EXISTS ${table}_index_e_idx ON ${table}(index_e)`,
  `CREATE INDEX IF NOT EXISTS ${table}_index_f_idx ON ${table}(index_f)`,
  `CREATE INDEX IF NOT EXISTS ${table}_index_g_idx ON ${table}(index_g)`,
  `CREATE INDEX IF NOT EXISTS ${table}_index_h_idx ON ${table}(index_h)`,
];

/**
 * Apply the runtime-records schema using the current {@link SqlClient}.
 */
export const installRuntimeRecordsSchema = (
  sql: SqlClient,
): Effect.Effect<void, SqlError> =>
  Effect.gen(function* () {
    for (const statement of runtimeRecordsDdlStatements(RUNTIME_RECORDS_TABLE)) {
      yield* Effect.asVoid(sql.unsafe(statement).unprepared);
    }
  });
