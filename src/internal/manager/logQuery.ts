import { Data, Effect, Option } from "effect";
import { utcDateFromMillis } from "../utcDate";
import { ProcessStoreGroupLog } from "../store/groupLog";
import type { ProcessManagerLogScope } from "./logScope";
import type { ProcessManagerLogEntry } from "../../LogEntry";
import { replayLogEntry } from "./logCapture";

const defaultLogQueryLimit = 100;
const maxLogQueryLimit = 10_000;

/**
 * Sort order for {@link ProcessManagerLogQuery}.
 *
 * @public
 */
export type ProcessManagerLogSort = "asc" | "desc";

/**
 * Storage-backed log history query (operator `pm logs`).
 *
 * Flags map to predicates like a database query: optional group filter, optional
 * date bounds, cursor bounds, limit, and sort. With no filters, all stored rows
 * match subject to limit/sort.
 *
 * @public
 */
export interface ProcessManagerLogQuery {
  /** When set, restrict to this process group id. */
  readonly groupId?: string;
  /** When set, restrict to logs annotated with this process id. */
  readonly processId?: string;
  /** When set, restrict to logs annotated with this queue id. */
  readonly queueId?: string;
  readonly from?: Date;
  readonly to?: Date;
  /** Exclusive lower bound (`entryId` or ISO date per storage adapter). */
  readonly after?: string;
  /** Exclusive upper bound (`entryId` or ISO date per storage adapter). */
  readonly before?: string;
  readonly limit: number;
  readonly sort: ProcessManagerLogSort;
}

/**
 * @public
 */
export class ProcessManagerLogQueryError extends Data.TaggedError(
  "ProcessManagerLogQueryError",
)<{
  readonly reason: string;
}> {}

const parseIsoDate = (
  field: string,
  raw: string,
): Effect.Effect<Date, ProcessManagerLogQueryError> => {
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    return Effect.fail(
      new ProcessManagerLogQueryError({
        reason: `Invalid ${field} (expected ISO-8601 date): ${raw}`,
      }),
    );
  }
  return Effect.succeed(utcDateFromMillis(ms));
};

const parseOptionalIsoDate = (
  field: string,
  value: Option.Option<string>,
): Effect.Effect<Option.Option<Date>, ProcessManagerLogQueryError> =>
  Option.match(value, {
    onNone: () => Effect.succeed(Option.none()),
    onSome: (raw) =>
      parseIsoDate(field, raw).pipe(Effect.map(Option.some)),
  });

const clampLimit = (limit: number): number => {
  if (!Number.isFinite(limit) || limit < 1) {
    return defaultLogQueryLimit;
  }
  return limit > maxLogQueryLimit ? maxLogQueryLimit : Math.trunc(limit);
};

const validateRange = (
  from: Option.Option<Date>,
  to: Option.Option<Date>,
): Effect.Effect<void, ProcessManagerLogQueryError> => {
  if (Option.isSome(from) && Option.isSome(to) && from.value.getTime() > to.value.getTime()) {
    return Effect.fail(
      new ProcessManagerLogQueryError({
        reason: "`--from` must be before or equal to `--to`",
      }),
    );
  }
  return Effect.void;
};

/**
 * Build a {@link ProcessManagerLogQuery} from CLI flag values.
 *
 * @public
 */
const scopeToQueryFields = (
  scope: ProcessManagerLogScope,
): Pick<ProcessManagerLogQuery, "groupId" | "processId" | "queueId"> => {
  switch (scope._tag) {
    case "all":
      return {};
    case "group":
      return { groupId: scope.groupId };
    case "process":
      return { groupId: scope.groupId, processId: scope.processId };
    case "queue":
      return { groupId: scope.groupId, queueId: scope.queueId };
  }
};

export const buildProcessManagerLogQuery = (input: {
  readonly scope: ProcessManagerLogScope;
  readonly from: Option.Option<string>;
  readonly to: Option.Option<string>;
  readonly after: Option.Option<string>;
  readonly before: Option.Option<string>;
  readonly limit: number;
  readonly sort: ProcessManagerLogSort;
}): Effect.Effect<ProcessManagerLogQuery, ProcessManagerLogQueryError> =>
  Effect.gen(function* () {
    const from = yield* parseOptionalIsoDate("from", input.from);
    const to = yield* parseOptionalIsoDate("to", input.to);
    yield* validateRange(from, to);

    const after = Option.getOrUndefined(input.after);
    const before = Option.getOrUndefined(input.before);

    return {
      ...scopeToQueryFields(input.scope),
      from: Option.getOrUndefined(from),
      to: Option.getOrUndefined(to),
      after,
      before,
      limit: clampLimit(input.limit),
      sort: input.sort,
    };
  });

/**
 * Run a storage-backed log query and replay matching entries through the operator logger.
 *
 * @public
 */
export const queryGroupLogs = (
  query: ProcessManagerLogQuery,
): Effect.Effect<void, ProcessManagerLogQueryError, ProcessStoreGroupLog> =>
  ProcessStoreGroupLog.query(query);

/**
 * Replay log rows returned from a future storage adapter.
 *
 * @internal
 */
export const replayLogQueryResults = (
  entries: ReadonlyArray<ProcessManagerLogEntry>,
  sort: ProcessManagerLogSort,
): Effect.Effect<void> => {
  const ordered =
    sort === "asc" ? entries : [...entries].reverse();
  return Effect.gen(function* () {
    for (const entry of ordered) {
      yield* replayLogEntry(entry);
    }
  });
};
