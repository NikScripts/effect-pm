/**
 * In-memory store scope handles built from a {@link StoreSpec}.
 *
 * @module internal/store/memoryScope
 * @internal
 */

import { Effect, Ref, Schema } from "effect";
import { StoreScopeNotRegistered } from "./aggregateService";
import { APPEND_TAG, QUERY_TAG, type StoreHandleOf, type StoreSpec } from "./spec";

/** @internal */
export interface StoredRow {
  readonly method: string;
  readonly payload: unknown;
}

/** @internal */
export interface ScopeState {
  readonly spec: StoreSpec;
  readonly rows: Ref.Ref<ReadonlyArray<StoredRow>>;
}

/** @internal */
const appendKeysForSpec = (spec: StoreSpec): ReadonlySet<string> =>
  new Set(
    Object.entries(spec)
      .filter(([, entry]) => entry._tag === APPEND_TAG)
      .map(([key]) => key),
  );

/** @internal */
const querySourceKeys = (
  spec: StoreSpec,
  entry: { readonly from?: string | ReadonlyArray<string> },
): ReadonlySet<string> => {
  if (entry.from !== undefined) {
    return new Set(Array.isArray(entry.from) ? entry.from : [entry.from]);
  }
  return appendKeysForSpec(spec);
};

/** @internal */
export const makeScopeHandle = <S extends StoreSpec>(
  spec: S,
  rows: Ref.Ref<ReadonlyArray<StoredRow>>,
): StoreHandleOf<S> => {
  const handle = {} as StoreHandleOf<S>;

  for (const [name, entry] of Object.entries(spec)) {
    if (entry._tag === APPEND_TAG) {
      (handle as Record<string, unknown>)[name] = (payload: unknown) =>
        Effect.gen(function* () {
          const decoded = yield* Schema.decodeUnknownEffect(entry.schema)(payload);
          yield* Ref.update(rows, (current) => [
            ...current,
            { method: name, payload: decoded },
          ]);
        });
    } else if (entry._tag === QUERY_TAG) {
      const sourceKeys = querySourceKeys(spec, entry);
      (handle as Record<string, unknown>)[name] = (payload: unknown) =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(entry.payload)(payload);
          const current = yield* Ref.get(rows);
          const matched = current
            .filter((row) => sourceKeys.has(row.method))
            .map((row) => row.payload);
          return yield* Schema.decodeUnknownEffect(entry.result)(matched);
        });
    }
  }

  return handle;
};

/** @internal */
export const acquireFromScopes = <S extends StoreSpec>(
  scopes: ReadonlyMap<string, ScopeState>,
  key: string,
  spec: S,
): Effect.Effect<StoreHandleOf<S>, StoreScopeNotRegistered> => {
  const scope = scopes.get(key);
  if (scope === undefined) {
    return Effect.fail(new StoreScopeNotRegistered({ key }));
  }
  return Effect.succeed(makeScopeHandle(spec, scope.rows) as StoreHandleOf<S>);
};
