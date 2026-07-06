/**
 * In-memory store scope handles built from a {@link StoreSpec}.
 *
 * @module internal/store/memoryScope
 * @internal
 */

import { Effect, Ref, Schema } from "effect";
import { StoreScopeNotRegistered } from "./defineStore";
import {
  isStoreContractValue,
  materializeContractHandle,
  type StoreContractValue,
} from "./contractDef";
import { applyQueryOpts, queryOptsFromReadPayload } from "./helpers";
import { APPEND_TAG, QUERY_TAG, type FlatStoreHandleOf, type StoreHandleOf, type StoreSpec } from "./spec";

/** @internal */
export interface StoredRow {
  readonly method: string;
  readonly payload: unknown;
}

/** @internal */
export interface ScopeState {
  readonly spec: StoreSpec;
  readonly contract?: StoreContractValue;
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
): FlatStoreHandleOf<S> => {
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
          const decodedPayload = yield* Schema.decodeUnknownEffect(entry.payload)(payload);
          const current = yield* Ref.get(rows);
          const matched = applyQueryOpts(
            current
              .filter((row) => sourceKeys.has(row.method))
              .map((row) => row.payload),
            queryOptsFromReadPayload(decodedPayload),
            () => 0,
          );
          return yield* Schema.decodeUnknownEffect(entry.result)(matched);
        });
    }
  }

  return handle as FlatStoreHandleOf<S>;
};

/** @internal */
export const materializeStoreHandle = (
  input: StoreSpec | StoreContractValue,
  rows: Ref.Ref<ReadonlyArray<StoredRow>>,
): StoreHandleOf<StoreSpec | StoreContractValue> => {
  if (isStoreContractValue(input)) {
    return materializeContractHandle(input, rows) as StoreHandleOf<StoreContractValue>;
  }
  return makeScopeHandle(input, rows) as StoreHandleOf<StoreSpec>;
};

/** @internal */
export const acquireFromScopes = <Input extends StoreSpec | StoreContractValue>(
  scopes: ReadonlyMap<string, ScopeState>,
  key: string,
  input: Input,
): Effect.Effect<StoreHandleOf<Input>, StoreScopeNotRegistered> => {
  const scope = scopes.get(key);
  if (scope === undefined) {
    return Effect.fail(new StoreScopeNotRegistered({ key }));
  }
  return Effect.succeed(materializeStoreHandle(input, scope.rows) as StoreHandleOf<Input>);
};
