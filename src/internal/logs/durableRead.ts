/**
 * Read durable log rows from registration Storage.
 *
 * @module internal/logs/durableRead
 * @internal
 */

import { Effect, Option } from "effect";
import type { LogEntry } from "../../LogEntry";
import { Storage } from "../../Store";
import { IMPLICIT_LOGS_SHAPE_KEY, withImplicitLogShape } from "../store/logShapes";
import { makeStoreContractValue } from "../store/contractDef";

const logOnlyContract = withImplicitLogShape(makeStoreContractValue({}));

/** Runtime handle fragment for the private `_logs` journal (omitted from public handle types). */
interface ImplicitLogsReadHandle {
  readonly [IMPLICIT_LOGS_SHAPE_KEY]: {
    readonly read: (
      payload?: { readonly limit?: number },
    ) => Effect.Effect<ReadonlyArray<LogEntry>>;
  };
}

const isImplicitLogsReadHandle = (handle: unknown): handle is ImplicitLogsReadHandle => {
  if (typeof handle !== "object" || handle === null) {
    return false;
  }
  if (!(IMPLICIT_LOGS_SHAPE_KEY in handle)) {
    return false;
  }
  const logs: unknown = handle[IMPLICIT_LOGS_SHAPE_KEY];
  if (typeof logs !== "object" || logs === null || !("read" in logs)) {
    return false;
  }
  return typeof logs.read === "function";
};

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
    if (!isImplicitLogsReadHandle(handleExit.value)) {
      return Option.none();
    }
    const rows = yield* handleExit.value[IMPLICIT_LOGS_SHAPE_KEY].read({ limit });
    return Option.some(rows);
  });

/**
 * Durable rows for a HyperService registration scope (private `_logs` shape), or `[]` when unregistered.
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
 * Node journal via Storage (`Hyperlink.store(node)` / `Node.logs`), or `[]` when unregistered.
 *
 * @internal
 */
export const queryDurableNode = (
  nodeKey: string,
  options?: { readonly limit?: number },
): Effect.Effect<ReadonlyArray<LogEntry>> =>
  queryDurableScope(nodeKey, options);
