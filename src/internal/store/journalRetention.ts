/**
 * Per-scope retention on the SQL {@link EventJournal} table.
 *
 * @module internal/store/journalRetention
 * @internal
 */

import { Effect, Option } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { StoreJournalQueryError } from "./errors";

const ENTRY_TABLE = "effect_event_journal" as const;

/** Delete oldest journal rows for a scope when count exceeds `maxRows`. @internal */
export const trimScopeRetention = (
  scopeKey: string,
  maxRows: number,
): Effect.Effect<void, StoreJournalQueryError> =>
  Effect.gen(function* () {
    const sqlOption = yield* Effect.serviceOption(SqlClient);
    if (Option.isNone(sqlOption)) {
      return;
    }
    const sql = sqlOption.value;
    const counted = yield* sql<{ readonly total: number }>`
      SELECT COUNT(*) AS total
      FROM ${sql(ENTRY_TABLE)}
      WHERE primary_key = ${scopeKey}
    `.pipe(
      Effect.mapError(
        (cause) =>
          new StoreJournalQueryError({
            operation: "retention",
            scopeKey,
            cause,
          }),
      ),
    );
    const total = counted[0]?.total ?? 0;
    const excess = total - maxRows;
    if (excess <= 0) {
      return;
    }
    yield* sql`
      DELETE FROM ${sql(ENTRY_TABLE)}
      WHERE id IN (
        SELECT id FROM ${sql(ENTRY_TABLE)}
        WHERE primary_key = ${scopeKey}
        ORDER BY timestamp ASC
        LIMIT ${excess}
      )
    `.pipe(
      Effect.mapError(
        (cause) =>
          new StoreJournalQueryError({
            operation: "retention",
            scopeKey,
            cause,
          }),
      ),
    );
  });
