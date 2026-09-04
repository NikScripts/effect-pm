/**
 * Scope bridge helpers — connect scope materialization to {@link StorageApi}.
 *
 * @module internal/store/scopeBridge
 * @internal
 */

import * as EventJournal from "effect/unstable/eventlog/EventJournal";
import { Effect, Function, Stream } from "effect";
import {
  changesFromScopes,
  materializeStoreHandle,
  type ScopeState,
} from "./memoryScope";
import type { StorageApi } from "./bridge";
import type { StoreContractValue } from "./contractDef";
import type { StoreHandleOf, StoreSpec } from "./spec";
import { decodeJournalPayload } from "./journalCodec";
import { StoreChangeEvent, StoreScopeNotRegistered } from "./errors";

/**
 * Reference-keyed, per-scope handle cache. For each `scopeKey`, {@link Function.memoize} (Effect's
 * `WeakMap` memoizer) memoizes handle construction on the input (spec/contract) **reference**. The handle
 * is **stable per scope** — its append/read close over the stable journal — so this is write-once, no
 * invalidation; a racy double-build is harmless because materialization is pure/idempotent. @internal
 */
const memoizedAt = (
  materialize: (scopeKey: string, input: StoreSpec | StoreContractValue) => unknown,
) => {
  const perScope = new Map<string, (input: StoreSpec | StoreContractValue) => unknown>();
  return <Input extends StoreSpec | StoreContractValue>(
    scopeKey: string,
    input: Input,
  ): StoreHandleOf<Input> => {
    let memo = perScope.get(scopeKey);
    if (memo === undefined) {
      memo = Function.memoize((one: StoreSpec | StoreContractValue) => materialize(scopeKey, one));
      perScope.set(scopeKey, memo);
    }
    // Heterogeneous boundary: each input reference maps to its own `StoreHandleOf<Input>` — the same
    // dynamic-construction boundary as `materializeStoreHandle`'s own assertion.
    return memo(input) as StoreHandleOf<Input>;
  };
};

/** @internal */
export const buildScopeBridge = (
  scopes: ReadonlyMap<string, ScopeState>,
  journal: EventJournal.EventJournal["Service"],
): StorageApi => {
  const at = memoizedAt((scopeKey, input) =>
    materializeStoreHandle(input, {
      journal,
      scopeKey,
      maxRows: scopes.get(scopeKey)?.maxRows,
    }),
  );
  return {
    at: (scopeKey, input) =>
      scopes.has(scopeKey)
        ? Effect.succeed(at(scopeKey, input))
        : Effect.fail(new StoreScopeNotRegistered({ key: scopeKey })),
    changes: (scopeKey) =>
      changesFromScopes(scopes, scopeKey).pipe(
        Effect.provideService(EventJournal.EventJournal, journal),
      ),
  };
};

/**
 * Default bridge — materializes **any** requested scope on demand against a single journal,
 * with no registration check (never `StoreScopeNotRegistered`). Backs the baked-in in-memory
 * store default: every HyperService always has a store, so consumers append unconditionally (no
 * serviceOption). Scopes are separated by `primaryKey === scopeKey`, exactly like {@link buildScopeBridge}.
 *
 * @internal
 */
export const buildDefaultScopeBridge = (
  journal: EventJournal.EventJournal["Service"],
  maxRows?: number,
): StorageApi => {
  const at = memoizedAt((scopeKey, input) =>
    materializeStoreHandle(input, {
      journal,
      scopeKey,
      maxRows,
    }),
  );
  return {
    at: (scopeKey, input) => Effect.succeed(at(scopeKey, input)),
    changes: (scopeKey) =>
      Effect.map(journal.changes, (subscription) =>
        Stream.fromSubscription(subscription).pipe(
          Stream.filter((entry) => entry.primaryKey === scopeKey),
          Stream.mapEffect((entry) =>
            Effect.map(decodeJournalPayload(entry.payload), (payload) =>
              new StoreChangeEvent({
                scopeKey: entry.primaryKey,
                method: entry.event,
                payload,
              }),
            ),
          ),
        ),
      ),
  };
};
