/**
 * Read durable log rows from registration Storage or interim LogStore.
 *
 * @module internal/logs/durableRead
 * @internal
 */

import { Effect, Option } from "effect";
import type { LogEntry } from "../../LogEntry";
import { Storage } from "../../Store";
import { LogStore } from "../../store/log";
import { LogQueryError } from "../manager/logQuery";
import { withImplicitLogShape } from "../store/logShapes";
import { makeStoreContractValue } from "../store/contractDef";

const logOnlyContract = withImplicitLogShape(makeStoreContractValue({}));

/** @internal */
export const readScopeLog = (
  scopeKey: string,
  limit: number,
): Effect.Effect<Option.Option<ReadonlyArray<LogEntry>>, never, Storage> =>
  Effect.gen(function* () {
    const bridge = yield* Storage;
    const handleExit = yield* bridge.at(scopeKey, logOnlyContract).pipe(Effect.exit);
    if (handleExit._tag === "Failure") {
      return Option.none();
    }
    const rows = yield* handleExit.value.log.read({ limit });
    return Option.some(rows as ReadonlyArray<LogEntry>);
  });

/** @internal */
export const readLogStoreLineage = (
  tagKey: string,
  limit: number,
): Effect.Effect<ReadonlyArray<LogEntry>, never, LogStore> =>
  Effect.flatMap(LogStore, (store) =>
    store.load({
      lineageContains: tagKey,
      limit,
      sort: "desc",
    }),
  ).pipe(
    Effect.catchIf(
      (error): error is LogQueryError => error instanceof LogQueryError,
      () => Effect.succeed<ReadonlyArray<LogEntry>>([]),
    ),
    Effect.orDie,
  );

/**
 * Prefer `handle.log.read` for `scopeKey`, else interim LogStore lineage filter.
 *
 * @internal
 */
export const queryDurableScope = (
  scopeKey: string,
  options?: { readonly limit?: number },
): Effect.Effect<ReadonlyArray<LogEntry>> => {
  const limit = options?.limit ?? 200;
  return Effect.gen(function* () {
    const storage = yield* Effect.serviceOption(Storage);
    if (Option.isSome(storage)) {
      const fromStore = yield* readScopeLog(scopeKey, limit).pipe(
        Effect.provideService(Storage, storage.value),
      );
      if (Option.isSome(fromStore)) {
        return fromStore.value;
      }
    }
    const store = yield* Effect.serviceOption(LogStore);
    if (Option.isSome(store)) {
      return yield* readLogStoreLineage(scopeKey, limit).pipe(
        Effect.provideService(LogStore, store.value),
      );
    }
    return [];
  });
};

/**
 * Node journal via Storage (`Resource.store(node)`), else LogStore `groupId` bucket.
 *
 * @internal
 */
export const queryDurableNode = (
  nodeKey: string,
  options?: { readonly limit?: number },
): Effect.Effect<ReadonlyArray<LogEntry>> => {
  const limit = options?.limit ?? 200;
  return Effect.gen(function* () {
    const storage = yield* Effect.serviceOption(Storage);
    if (Option.isSome(storage)) {
      const fromStore = yield* readScopeLog(nodeKey, limit).pipe(
        Effect.provideService(Storage, storage.value),
      );
      if (Option.isSome(fromStore)) {
        return fromStore.value;
      }
    }
    const store = yield* Effect.serviceOption(LogStore);
    if (Option.isSome(store)) {
      return yield* store.value
        .load({ groupId: nodeKey, limit, sort: "desc" })
        .pipe(
          Effect.catchIf(
            (error): error is LogQueryError => error instanceof LogQueryError,
            () => Effect.succeed<ReadonlyArray<LogEntry>>([]),
          ),
          Effect.orDie,
        );
    }
    return [];
  });
};