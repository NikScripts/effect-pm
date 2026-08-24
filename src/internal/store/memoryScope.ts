/**
 * Store scope handles backed by {@link EventJournal} (`effect/unstable/eventlog`).
 *
 * @module internal/store/memoryScope
 * @internal
 */

import { Effect, Schema, Stream } from "effect";
import type { Scope } from "effect/Scope";
import * as EventJournal from "effect/unstable/eventlog/EventJournal";
import { StoreScopeNotRegistered, StoreWriteError } from "./errors";
import { retype } from "../nodeServerCommon";
import {
  isStoreContractValue,
  materializeContractHandle,
  type StoreContractValue,
} from "./contractDef";
import { applyQueryOpts, isRecord, limitOpts, queryOptsFromReadPayload, windowOpts } from "./helpers";
import type { StoreChangeEvent, StoreJournalDecodeError } from "./errors";
import { StoreChangeEvent as StoreChangeEventClass } from "./errors";
import { decodeJournalPayload, encodeJournalPayload } from "./journalCodec";
import { trimScopeRetention } from "./journalRetention";
import { APPEND_TAG, QUERY_TAG, type FlatStoreHandleOf, type StoreHandleOf, type StoreSpec } from "./spec";
import { filterRowsByWhere } from "./where";

const encodeCodecJson = <S extends Schema.Schema<unknown>>(
  schema: S,
  value: unknown,
): Effect.Effect<unknown, never, never> =>
  retype(Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(value) as never);

const decodeUnknownSchema = <S extends Schema.Schema<unknown>>(
  schema: S,
  value: unknown,
): Effect.Effect<Schema.Schema.Type<S>, never, never> =>
  retype(Schema.decodeUnknownEffect(schema)(value) as never);

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
          const inputs = Array.isArray(payload) ? payload : [payload];
          for (const one of inputs) {
            // `append` receives DECODED domain values. `Schema.toCodecJson` is Effect's own
            // schema→JSON codec — it serializes rich types (`DateTime`, `Exit`, `Cause`, `Duration`)
            // to a JSON-safe form and decodes them back, which the naive object walk cannot.
            //
            // An encode/serialization failure here means the value does not fit the declared shape —
            // a programming bug, not a runtime condition — so it `orDie`s as a defect (surfacing the
            // bug) rather than becoming a catchable failure. The `journal.write` below is left as a
            // normal failure: a journal/IO write error stays in the cause and remains catchable.
            const wire = yield* Effect.orDie(
              encodeCodecJson(entry.schema, one),
            );
            const encoded = yield* Effect.orDie(encodeJournalPayload(wire));
            // The journal/IO write is the genuine catchable write failure — surface it as
            // `StoreWriteError` (the encode above already `orDie`s a schema mismatch as a defect).
            yield* sideEffects.journal
              .write({
                event: name,
                primaryKey: sideEffects.scopeKey,
                payload: encoded,
                effect: () => Effect.void,
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new StoreWriteError({
                      cause,
                      detail: `append to scope "${sideEffects.scopeKey}" (event "${name}")`,
                    }),
                ),
              );
            if (sideEffects.maxRows !== undefined) {
              // Retention trim is part of the same write path — a trim IO failure is a write hiccup,
              // not a bug, so it too becomes a catchable `StoreWriteError` (swallowed by the guard).
              yield* trimScopeRetention(sideEffects.scopeKey, sideEffects.maxRows).pipe(
                Effect.mapError(
                  (cause) =>
                    new StoreWriteError({
                      cause,
                      detail: `retention trim on scope "${sideEffects.scopeKey}"`,
                    }),
                ),
              );
            }
          }
        });
    } else if (entry._tag === QUERY_TAG) {
      const sourceKeys = querySourceKeys(spec, entry);
      (handle as Record<string, unknown>)[name] = (payload: unknown) =>
        Effect.gen(function* () {
          const decodedPayload = yield* decodeUnknownSchema(entry.payload, payload);
          const entries = yield* sideEffects.journal.entries;
          const rows = yield* rowsForScope(entries, sideEffects.scopeKey, sourceKeys);
          const capped = capRetention(
            [...rows].sort((a, b) => a.occurredAtMillis - b.occurredAtMillis),
            sideEffects.maxRows,
          );
          const where =
            isRecord(decodedPayload) && "where" in decodedPayload
              ? decodedPayload.where
              : undefined;
          // Window first, then field filters, then limit — so `limit` counts matching rows.
          const queryOpts = queryOptsFromReadPayload(decodedPayload);
          const windowed = applyQueryOpts(
            capped,
            windowOpts(queryOpts),
            (row) => row.occurredAtMillis,
          );
          const filtered = filterRowsByWhere(windowed, where, (row) => row.payload);
          const matched = applyQueryOpts(
            filtered,
            limitOpts(queryOpts),
            (row) => row.occurredAtMillis,
          ).map((row) => row.payload);
          return yield* decodeUnknownSchema(Schema.toCodecJson(entry.result), matched);
        });
    }
  }

  return handle as FlatStoreHandleOf<S>;
};

/** @internal */
export const materializeStoreHandle = <Input extends StoreSpec | StoreContractValue>(
  input: Input,
  sideEffects: AppendSideEffects,
): StoreHandleOf<Input> => {
  // Handles are built by dynamic property assignment, so this is the one boundary between runtime
  // construction and the static type. Tightening `Input` here makes the whole resolution chain
  // (`bridge.at` → `Tag.store`) precise, removing the casts consumers/tests otherwise carry.
  if (isStoreContractValue(input)) {
    return materializeContractHandle(input, sideEffects) as StoreHandleOf<Input>;
  }
  return makeScopeHandle(input, sideEffects) as StoreHandleOf<Input>;
};

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
