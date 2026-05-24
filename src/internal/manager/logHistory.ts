import { Effect, Option, Scope } from "effect";
import type { ProcessManagerLogScope } from "./logScope";
import { logScopeGroupId } from "./logScope";
import {
  buildProcessManagerLogQuery,
  ProcessManagerLogQueryError,
  replayLogQueryResults,
} from "./logQuery";
import { ProcessStoreGroupLog } from "../store/groupLog";
import { groupLogSqlitePath, resolveChildLaunchPaths } from "./childLaunch";
import { layerProcessStore } from "../../storage/sqlite/index";
import type { ProcessManagerLogEntry } from "../../LogEntry";

// @effect-diagnostics strictEffectProvide:off — pm logs opens per-group sqlite stores from resolved disk paths.

type GroupCatalogEntry = {
  readonly id: string;
};

const storeMissingMessage = (filePath: string): string =>
  `No log history at ${filePath}. Start the group child (pm start <group>) and emit logs before running pm logs.`;

/**
 * Run `pm logs` against on-disk group log stores under the child log directory.
 *
 * @public
 */
export const queryGroupLogsForCatalog = (
  groups: ReadonlyArray<GroupCatalogEntry>,
  scope: ProcessManagerLogScope,
  input: {
    readonly from: Option.Option<string>;
    readonly to: Option.Option<string>;
    readonly after: Option.Option<string>;
    readonly before: Option.Option<string>;
    readonly limit: number;
    readonly sort: "asc" | "desc";
  },
): Effect.Effect<
  void,
  ProcessManagerLogQueryError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const paths = yield* resolveChildLaunchPaths().pipe(
      Effect.mapError(
        (error) =>
          new ProcessManagerLogQueryError({
            reason: `Unable to resolve child launch paths: ${String(error)}`,
          }),
      ),
    );
    const query = yield* buildProcessManagerLogQuery({
      scope,
      from: input.from,
      to: input.to,
      after: input.after,
      before: input.before,
      limit: input.limit,
      sort: input.sort,
    });

    if (scope._tag === "all") {
      const perGroupLimit = Math.min(
        10_000,
        Math.max(input.limit, input.limit * Math.max(groups.length, 1)),
      );
      const merged: ProcessManagerLogEntry[] = [];
      for (const group of groups) {
        const sqliteFilename = groupLogSqlitePath(paths.logDirectory, group.id);
        const groupQuery = { ...query, groupId: group.id, limit: perGroupLimit };
        const loaded = yield* ProcessStoreGroupLog.load(groupQuery).pipe(
          Effect.provide(layerProcessStore({ filename: sqliteFilename })),
          Effect.scoped,
          Effect.option,
        );
        if (Option.isSome(loaded)) {
          merged.push(...loaded.value);
        }
      }
      if (merged.length === 0) {
        return yield* new ProcessManagerLogQueryError({
          reason: `No log history found under ${paths.logDirectory}. ${storeMissingMessage("(group)/logs.sqlite")}`,
        });
      }
      const sorted = [...merged].sort((left, right) => {
        const leftMs = Date.parse(left.date);
        const rightMs = Date.parse(right.date);
        return input.sort === "asc" ? leftMs - rightMs : rightMs - leftMs;
      });
      const limited = sorted.slice(0, input.limit);
      yield* replayLogQueryResults(limited, input.sort);
      return;
    }

    const groupId = logScopeGroupId(scope);
    if (groupId === undefined) {
      return yield* new ProcessManagerLogQueryError({
        reason: "Log history query requires a resolved group scope",
      });
    }
    const sqliteFilename = groupLogSqlitePath(paths.logDirectory, groupId);
    yield* ProcessStoreGroupLog.query(query).pipe(
      Effect.provide(layerProcessStore({ filename: sqliteFilename })),
      Effect.scoped,
    );
  });
