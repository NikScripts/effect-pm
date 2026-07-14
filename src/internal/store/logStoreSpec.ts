/**
 * Built-in log store contract — durable {@link LogEntry} rows keyed by node bucket (`groupId`).
 *
 * @module internal/store/logStoreSpec
 * @internal
 */

import { Effect, Schema } from "effect";
import { LogAnnotationKeys } from "../../LogContext";
import type { LogEntry } from "../../LogEntry";
import { LogEntrySchema } from "../../LogEntry";
import type { LogQuery, LogSort } from "../manager/logQuery";
import { LogQueryError, replayLogQueryResults } from "../manager/logQuery";
import * as Store from "../../Store";

/** Persisted log row in the event journal. @internal */
export const logRowSchema = Schema.Struct({
  groupId: Schema.String,
  entryId: Schema.String,
  entry: LogEntrySchema,
});

/** Read/query payload for log history. @internal */
export const logQueryPayloadSchema = Schema.Struct({
  groupId: Schema.optional(Schema.String),
  processId: Schema.optional(Schema.String),
  queueId: Schema.optional(Schema.String),
  lineageContains: Schema.optional(Schema.String),
  from: Schema.optional(Schema.Number),
  to: Schema.optional(Schema.Number),
  after: Schema.optional(Schema.String),
  before: Schema.optional(Schema.String),
  limit: Schema.Number,
  sort: Schema.Literals(["asc", "desc"] as const),
});

type LogRow = typeof logRowSchema.Type;
type LogQueryPayload = typeof logQueryPayloadSchema.Type;

const parseCursorMillis = (cursor: string | undefined): number | undefined => {
  if (cursor === undefined) return undefined;
  const asNumber = Number(cursor);
  if (Number.isFinite(asNumber)) return asNumber;
  const parsed = Date.parse(cursor);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const lineageFromEntry = (entry: LogEntry): ReadonlyArray<string> => {
  const raw = entry.annotations[LogAnnotationKeys.lineage];
  if (raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed;
      }
    } catch {
      // fall through to legacy keys
    }
  }
  const legacy: string[] = [];
  const processId = entry.annotations[LogAnnotationKeys.processId];
  const queueId = entry.annotations[LogAnnotationKeys.queueId];
  if (processId !== undefined) legacy.push(processId);
  if (queueId !== undefined) legacy.push(queueId);
  return legacy;
};

const entryMatchesPayload = (entry: LogEntry, query: LogQueryPayload): boolean => {
  if (query.processId !== undefined) {
    const processId = entry.annotations[LogAnnotationKeys.processId];
    if (processId !== query.processId) return false;
  }
  if (query.queueId !== undefined) {
    const queueId = entry.annotations[LogAnnotationKeys.queueId];
    if (queueId !== query.queueId) return false;
  }
  if (query.lineageContains !== undefined) {
    if (!lineageFromEntry(entry).includes(query.lineageContains)) return false;
  }
  if (query.from !== undefined) {
    const ms = Date.parse(entry.date);
    if (Number.isNaN(ms) || ms < query.from) return false;
  }
  if (query.to !== undefined) {
    const ms = Date.parse(entry.date);
    if (Number.isNaN(ms) || ms > query.to) return false;
  }
  return true;
};

const sortEntries = (
  entries: ReadonlyArray<LogEntry>,
  sort: LogSort,
): ReadonlyArray<LogEntry> => {
  const rows = [...entries];
  rows.sort((left, right) => {
    const leftMs = Date.parse(left.date);
    const rightMs = Date.parse(right.date);
    return sort === "asc" ? leftMs - rightMs : rightMs - leftMs;
  });
  return rows;
};

const rowsToEntries = (
  rows: ReadonlyArray<LogRow>,
  query: LogQueryPayload,
): ReadonlyArray<LogEntry> => {
  const afterMs = parseCursorMillis(query.after);
  const beforeMs = parseCursorMillis(query.before);
  const out: LogEntry[] = [];
  for (const row of rows) {
    if (query.groupId !== undefined && row.groupId !== query.groupId) continue;
    if (query.after !== undefined && row.entryId <= query.after) continue;
    if (query.before !== undefined && row.entryId >= query.before) continue;
    if (afterMs !== undefined) {
      const ms = Date.parse(row.entry.date);
      if (!Number.isNaN(ms) && ms <= afterMs) continue;
    }
    if (beforeMs !== undefined) {
      const ms = Date.parse(row.entry.date);
      if (!Number.isNaN(ms) && ms >= beforeMs) continue;
    }
    if (!entryMatchesPayload(row.entry, query)) continue;
    out.push(row.entry);
  }
  return sortEntries(out, query.sort).slice(0, query.limit);
};

const prefetchLimit = (query: LogQuery): number =>
  query.processId !== undefined ||
  query.queueId !== undefined ||
  query.lineageContains !== undefined
    ? Math.min(query.limit * 8, 10_000)
    : query.limit;

const toPayload = (query: LogQuery): LogQueryPayload => ({
  ...(query.groupId === undefined ? {} : { groupId: query.groupId }),
  ...(query.processId === undefined ? {} : { processId: query.processId }),
  ...(query.queueId === undefined ? {} : { queueId: query.queueId }),
  ...(query.lineageContains === undefined ? {} : { lineageContains: query.lineageContains }),
  ...(query.from === undefined ? {} : { from: query.from.getTime() }),
  ...(query.to === undefined ? {} : { to: query.to.getTime() }),
  ...(query.after === undefined ? {} : { after: query.after }),
  ...(query.before === undefined ? {} : { before: query.before }),
  limit: prefetchLimit(query),
  sort: query.sort,
});

/**
 * Lean log store contract: append rows + load/query by {@link LogQuery}.
 *
 * @internal
 */
export const builtInLogStoreContract = () =>
  Store.contract(
    {
      log: Store.shape(logRowSchema),
    },
    ({ log }) => {
      const load = (query: LogQuery) =>
        Effect.gen(function* () {
          const payload = toPayload(query);
          const raw = yield* log.read({
            limit: payload.limit,
            ...(payload.from === undefined ? {} : { after: payload.from }),
            ...(payload.to === undefined ? {} : { before: payload.to }),
            ...(payload.groupId === undefined ? {} : { where: { groupId: payload.groupId } }),
          });
          const rows = Array.isArray(raw) ? (raw as ReadonlyArray<LogRow>) : [];
          const entries = rowsToEntries(rows, { ...payload, limit: query.limit });
          if (entries.length === 0) {
            return yield* new LogQueryError({
              reason: "No log entries matched the query",
            });
          }
          return entries;
        });

      return {
        record: (groupId: string, entryId: string, entry: LogEntry) =>
          log.append({ groupId, entryId, entry }),
        recordBatch: (
          groupId: string,
          rows: ReadonlyArray<{ readonly entryId: string; readonly entry: LogEntry }>,
        ) =>
          Effect.forEach(
            rows,
            (item) => log.append({ groupId, entryId: item.entryId, entry: item.entry }),
            { discard: true },
          ),
        load,
        query: (logQuery: LogQuery) =>
          Effect.gen(function* () {
            const entries = yield* load(logQuery);
            yield* replayLogQueryResults(entries, logQuery.sort);
          }),
      };
    },
  );

/** @internal */
export type LogStoreHandle = Store.HandleOf<ReturnType<typeof builtInLogStoreContract>>;

/** @internal */
export type LogStoreEmitHandle = Pick<LogStoreHandle, "record" | "recordBatch">;
