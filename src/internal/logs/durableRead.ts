/**
 * Read durable log rows from registration Storage.
 *
 * @module internal/logs/durableRead
 * @internal
 */

import { Effect, Option } from "effect";
import type { LogEntry } from "../../LogEntry";
import { Storage } from "../../Store";
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

/**
 * Durable rows for a resource registration scope (`handle.log.read`), or `[]` when unregistered.
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
    if (Option.isNone(storage)) {
      return [];
    }
    const fromStore = yield* readScopeLog(scopeKey, limit).pipe(
      Effect.provideService(Storage, storage.value),
    );
    return Option.isSome(fromStore) ? fromStore.value : [];
  });
};

/**
 * Node journal via Storage (`Resource.store(node)` / `Node.logs`), or `[]` when unregistered.
 *
 * @internal
 */
export const queryDurableNode = (
  nodeKey: string,
  options?: { readonly limit?: number },
): Effect.Effect<ReadonlyArray<LogEntry>> =>
  queryDurableScope(nodeKey, options);
