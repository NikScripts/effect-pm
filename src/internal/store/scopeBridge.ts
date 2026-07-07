/**
 * Scope bridge helpers — connect {@link acquireFromScopes} to {@link StorageApi}.
 *
 * @module internal/store/scopeBridge
 * @internal
 */

import * as EventJournal from "effect/unstable/eventlog/EventJournal";
import { Effect, Stream } from "effect";
import {
  acquireFromScopes,
  changesFromScopes,
  materializeStoreHandle,
  type ScopeState,
} from "./memoryScope";
import type { StorageApi } from "./bridge";
import { decodeJournalPayload } from "./journalCodec";
import { StoreChangeEvent } from "./errors";

/** @internal */
export const buildScopeBridge = (
  scopes: ReadonlyMap<string, ScopeState>,
  journal: EventJournal.EventJournal["Service"],
): StorageApi => ({
  at: (scopeKey, input) =>
    acquireFromScopes(scopes, scopeKey, input).pipe(
      Effect.provideService(EventJournal.EventJournal, journal),
    ),
  changes: (scopeKey) =>
    changesFromScopes(scopes, scopeKey).pipe(
      Effect.provideService(EventJournal.EventJournal, journal),
    ),
});

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
): StorageApi => ({
  at: (scopeKey, input) =>
    Effect.succeed(
      materializeStoreHandle(input, { journal, scopeKey, maxRows }),
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
});
