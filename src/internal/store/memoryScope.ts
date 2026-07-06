/**
 * Store scope handles backed by {@link EventJournal} (`effect/unstable/eventlog`).
 *
 * @module internal/store/memoryScope
 * @internal
 */

import { Effect, Schema, Stream } from "effect";
import type { Scope } from "effect/Scope";
import * as EventJournal from "effect/unstable/eventlog/EventJournal";
import { StoreScopeNotRegistered } from "./errors";
import {
  isStoreContractValue,
  materializeContractHandle,
  type StoreContractValue,
} from "./contractDef";
import { applyQueryOpts, queryOptsFromReadPayload } from "./helpers";
import type { StoreChangeEvent, StoreJournalDecodeError } from "./errors";
import { StoreChangeEvent as StoreChangeEventClass } from "./errors";
import { decodeJournalPayload, encodeJournalPayload } from "./journalCodec";
import { trimScopeRetention } from "./journalRetention";
import { APPEND_TAG, QUERY_TAG, type FlatStoreHandleOf, type StoreHandleOf, type StoreSpec } from "./spec";

/** @internal */
export interface StoredRow {
  readonly method: string;
  readonly payload: unknown;
  readonly occurredAtMillis: number;
}

/** Journal side effects wired into each scope handle. @internal */
export interface AppendSideEffects {
  readonly journal: EventJournal.EventJournal["Service"];
  readonly scopeKey: string;
  readonly maxRows?: number;
}

/** @internal */
export interface ScopeState {
  readonly scopeKey: string;
  readonly spec: StoreSpec;
  readonly contract?: StoreContractValue;
  readonly maxRows?: number;
}

/** @internal */
export const buildScopeStateMap = (
  registrations: ReadonlyArray<{ readonly scopeKey: string; readonly spec: StoreSpec; readonly contract?: StoreContractValue; readonly maxRows?: number }>,
): Map<string, ScopeState> => {
  const scopeState = new Map<string, ScopeState>();
  for (const registration of registrations) {
    if (scopeState.has(registration.scopeKey)) {
      continue;
    }
    scopeState.set(registration.scopeKey, {
      scopeKey: registration.scopeKey,
      spec: registration.spec,
      contract: registration.contract,
      maxRows: registration.maxRows,
    });
  }
  return scopeState;
};

/** @internal */
const rowsForScope = (
  entries: ReadonlyArray<EventJournal.Entry>,
  scopeKey: string,
  sourceKeys: ReadonlySet<string>,
): Effect.Effect<ReadonlyArray<StoredRow>, StoreJournalDecodeError> =>
  Effect.forEach(
    entries.filter((entry) => entry.primaryKey === scopeKey && sourceKeys.has(entry.event)),
    (entry) =>
      Effect.map(decodeJournalPayload(entry.payload), (payload) => ({
        method: entry.event,
        payload,
        occurredAtMillis: entry.createdAtMillis,
      })),
    { concurrency: "unbounded" },
  );

/** @internal */
const capRetention = (
  rows: ReadonlyArray<StoredRow>,
  maxRows: number | undefined,
): ReadonlyArray<StoredRow> =>
  maxRows !== undefined && rows.length > maxRows ? rows.slice(rows.length - maxRows) : rows;

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
  sideEffects: AppendSideEffects,
): FlatStoreHandleOf<S> => {
  const handle = {} as StoreHandleOf<S>;

  for (const [name, entry] of Object.entries(spec)) {
    if (entry._tag === APPEND_TAG) {
      (handle as Record<string, unknown>)[name] = (payload: unknown) =>
        Effect.gen(function* () {
          const decoded = yield* Schema.decodeUnknownEffect(entry.schema)(payload);
          const inputs = Array.isArray(decoded) ? decoded : [decoded];
          for (const one of inputs) {
            const encoded = yield* encodeJournalPayload(one);
            yield* sideEffects.journal.write({
              event: name,
              primaryKey: sideEffects.scopeKey,
              payload: encoded,
              effect: () => Effect.void,
            });
            if (sideEffects.maxRows !== undefined) {
              yield* trimScopeRetention(sideEffects.scopeKey, sideEffects.maxRows);
            }
          }
        });
    } else if (entry._tag === QUERY_TAG) {
      const sourceKeys = querySourceKeys(spec, entry);
      (handle as Record<string, unknown>)[name] = (payload: unknown) =>
        Effect.gen(function* () {
          const decodedPayload = yield* Schema.decodeUnknownEffect(entry.payload)(payload);
          const entries = yield* sideEffects.journal.entries;
          const rows = yield* rowsForScope(entries, sideEffects.scopeKey, sourceKeys);
          const capped = capRetention(
            [...rows].sort((a, b) => a.occurredAtMillis - b.occurredAtMillis),
            sideEffects.maxRows,
          );
          const matched = applyQueryOpts(
            capped,
            queryOptsFromReadPayload(decodedPayload),
            (row) => row.occurredAtMillis,
          ).map((row) => row.payload);
          return yield* Schema.decodeUnknownEffect(entry.result)(matched);
        });
    }
  }

  return handle as FlatStoreHandleOf<S>;
};

/** @internal */
export const materializeStoreHandle = (
  input: StoreSpec | StoreContractValue,
  sideEffects: AppendSideEffects,
): StoreHandleOf<StoreSpec | StoreContractValue> => {
  if (isStoreContractValue(input)) {
    return materializeContractHandle(input, sideEffects) as StoreHandleOf<StoreContractValue>;
  }
  return makeScopeHandle(input, sideEffects) as StoreHandleOf<StoreSpec>;
};

/** @internal */
export const acquireFromScopes = <Input extends StoreSpec | StoreContractValue>(
  scopes: ReadonlyMap<string, ScopeState>,
  key: string,
  input: Input,
): Effect.Effect<StoreHandleOf<Input>, StoreScopeNotRegistered, EventJournal.EventJournal> =>
  Effect.gen(function* () {
    const scope = scopes.get(key);
    if (scope === undefined) {
      return yield* new StoreScopeNotRegistered({ key });
    }
    const journal = yield* EventJournal.EventJournal;
    const sideEffects: AppendSideEffects = {
      journal,
      scopeKey: key,
      maxRows: scope.maxRows,
    };
    return materializeStoreHandle(input, sideEffects) as StoreHandleOf<Input>;
  });

/** @internal */
export const changesFromScopes = (
  scopes: ReadonlyMap<string, ScopeState>,
  key: string,
): Effect.Effect<
  Stream.Stream<StoreChangeEvent, StoreJournalDecodeError>,
  StoreScopeNotRegistered,
  EventJournal.EventJournal | Scope
> =>
  Effect.gen(function* () {
    const scope = scopes.get(key);
    if (scope === undefined) {
      return yield* new StoreScopeNotRegistered({ key });
    }
    const journal = yield* EventJournal.EventJournal;
    const subscription = yield* journal.changes;
    return Stream.fromSubscription(subscription).pipe(
      Stream.filter((entry) => entry.primaryKey === key),
      Stream.mapEffect((entry) =>
        Effect.map(decodeJournalPayload(entry.payload), (payload) =>
          new StoreChangeEventClass({
            scopeKey: entry.primaryKey,
            method: entry.event,
            payload,
          }),
        ),
      ),
    );
  });
