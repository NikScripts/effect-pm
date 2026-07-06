/**
 * Scope bridge helpers — connect {@link acquireFromScopes} to {@link StoreScopeBridge}.
 *
 * @module internal/store/scopeBridge
 * @internal
 */

import * as EventJournal from "effect/unstable/eventlog/EventJournal";
import { Effect } from "effect";
import { acquireFromScopes, changesFromScopes, type ScopeState } from "./memoryScope";
import type { StoreScopeBridge } from "./bridge";

/** @internal */
export const buildScopeBridge = (
  scopes: ReadonlyMap<string, ScopeState>,
  journal: EventJournal.EventJournal["Service"],
): StoreScopeBridge => ({
  at: (scopeKey, spec, contract) =>
    acquireFromScopes(scopes, scopeKey, contract ?? spec).pipe(
      Effect.provideService(EventJournal.EventJournal, journal),
    ),
  changes: (scopeKey) =>
    changesFromScopes(scopes, scopeKey).pipe(
      Effect.provideService(EventJournal.EventJournal, journal),
    ),
});
