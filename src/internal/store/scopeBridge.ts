/**
 * Scope bridge helpers — connect scope materialization to {@link StorageApi}.
 *
 * @module internal/store/scopeBridge
 * @internal
 */

import * as EventJournal from "effect/unstable/eventlog/EventJournal";
import { Effect, Stream } from "effect";
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

/** Per-scope cache of materialized handles, keyed by the input (spec/contract) reference. @internal */
type AtCache = Map<string, WeakMap<object, unknown>>;

/**
 * Materialize a scope handle at most once per `(scopeKey, input reference)`. The handle is **stable per
 * scope** — its append/read close over the stable journal — so it is write-once, no invalidation; a racy
 * double-build is fine because materialization is pure/idempotent. Non-object inputs (which the types
 * forbid, but guarded defensively) bypass the cache. @internal
 */
const materializeMemoized = <Input extends StoreSpec | StoreContractValue>(
  cache: AtCache,
  scopeKey: string,
  input: Input,
  build: (input: Input) => StoreHandleOf<Input>,
): StoreHandleOf<Input> => {
  if (typeof input !== "object") {
    return build(input);
  }
  let perScope = cache.get(scopeKey);
  if (perScope === undefined) {
    perScope = new WeakMap<object, unknown>();
    cache.set(scopeKey, perScope);
  }
  const cached = perScope.get(input);
  if (cached !== undefined) {
    // Boundary: the cache is heterogeneous (`Input` varies per entry), but each `input` reference always
    // maps to its own `StoreHandleOf<Input>` — the same dynamic-construction boundary as
    // `materializeStoreHandle`'s own assertion.
    return cached as StoreHandleOf<Input>;
  }
  const handle = build(input);
  perScope.set(input, handle);
  return handle;
};

/** @internal */
export const buildScopeBridge = (
  scopes: ReadonlyMap<string, ScopeState>,
  journal: EventJournal.EventJournal["Service"],
): StorageApi => {
  const atCache: AtCache = new Map();
  return {
    at: (scopeKey, input) => {
      const scope = scopes.get(scopeKey);
      return scope === undefined
        ? Effect.fail(new StoreScopeNotRegistered({ key: scopeKey }))
        : Effect.succeed(
            materializeMemoized(atCache, scopeKey, input, (resolvedInput) =>
              materializeStoreHandle(resolvedInput, {
                journal,
                scopeKey,
                maxRows: scope.maxRows,
              }),
            ),
          );
    },
    changes: (scopeKey) =>
      changesFromScopes(scopes, scopeKey).pipe(
        Effect.provideService(EventJournal.EventJournal, journal),
      ),
  };
};

/**
 * Default bridge — materializes **any** requested scope on demand against a single journal,
 * with no registration check (never `StoreScopeNotRegistered`). Backs the baked-in in-memory
 * store default: every resource always has a store, so consumers append unconditionally (no
 * serviceOption). Scopes are separated by `primaryKey === scopeKey`, exactly like {@link buildScopeBridge}.
 *
 * @internal
 */
export const buildDefaultScopeBridge = (
  journal: EventJournal.EventJournal["Service"],
  maxRows?: number,
): StorageApi => {
  const atCache: AtCache = new Map();
  return {
    at: (scopeKey, input) =>
      Effect.succeed(
        materializeMemoized(atCache, scopeKey, input, (resolvedInput) =>
          materializeStoreHandle(resolvedInput, {
            journal,
            scopeKey,
            maxRows,
          }),
        ),
      ),
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
