/**
 * **ProcessStore** — builder helpers for declaring storage facets.
 *
 * @remarks
 * Per-domain storage facets in `src/store/*` (e.g.
 * {@link ProcessStoreQueueResource}, {@link ProcessStoreRunResource})
 * are declared with `ProcessStore.Service<Self>()(id, ...sections)`,
 * where each section is a partial of the facet:
 *
 * - {@link ProcessStore.record} — write API (becomes per-method static
 *   optional emitters AND instance methods).
 * - {@link ProcessStore.read} — instance read API (yield the facet).
 * - {@link ProcessStore.withIdentifier} — optional identifier-bound
 *   API exposed via `Facet.for(id)` / `Facet.withIdentifier(id)`.
 * - {@link ProcessStore.catchErrorAndLog} — explicit best-effort boundary
 *   for telemetry writes that should log storage failures instead of
 *   failing process / queue work.
 *
 * The builder produces a `Context.Service` class with two layers:
 * `layer` (in-memory storage, dev/tests) and `layerRuntimeStorage`
 * (composes against the injected {@link RuntimeStorage}).
 *
 * @example Minimal facet
 * ```ts
 * export class ProcessStoreThing extends ProcessStore.Service<ProcessStoreThing>()(
 *   "@nikscripts/effect-pm/store/thing/ProcessStoreThing",
 *   ProcessStore.record({
 *     recordThing: (s) => (fact: ThingFact) => s.create(makeThingRecord(fact)),
 *   }),
 *   ProcessStore.read((s) => ({
 *     things: (q?: ThingQuery) =>
 *       s.read(runtimeRecordQuery(thingPredicates(q), q?.opts))
 *        .pipe(Effect.map(decodeThings)),
 *   })),
 * ) {}
 *
 * export declare namespace ProcessStoreThing {
 *   export type Type = ProcessStore.Service.Type<typeof ProcessStoreThing>;
 *   export type EmitType = ProcessStore.Service.EmitType<typeof ProcessStoreThing>;
 * }
 * ```
 *
 * @example Best-effort storage emit
 * ```ts
 * yield* ProcessStoreThing.recordThing(fact).pipe(
 *   ProcessStore.catchErrorAndLog({
 *     message: "Thing storage write failed",
 *     annotations: { thingId: fact.id },
 *   }),
 * );
 * ```
 *
 * See `docs/STORAGE.md` for the full authoring guide.
 *
 * @module ProcessStore
 */

import {
  catchErrorAndLog,
  defineProcessStoreFacet,
  processStoreRead,
  processStoreRecord,
  processStoreWithIdentifier,
  type ProcessStoreCatchErrorAndLogOptions,
  type ProcessStoreFacetEmitShape,
  type ProcessStoreFacetIdentifierShape,
  type ProcessStoreFacetShape,
} from "./internal/store/service";

export type {
  AnalyticsEventBase,
  JsonValue,
  ProcessStoreWriteError,
  QueryOpts,
} from "./ProcessStoreEvent";

export {
  ProcessStoreDuplicateRecordError,
  ProcessStoreReadonlyRecordError,
  ProcessStoreStorageError,
} from "./ProcessStoreEvent";

/**
 * Builder DSL for storage facets.
 *
 * - `Service` — define a new facet (returns a `Context.Service` class).
 * - `record({ ... })` — declare write methods (factory map).
 * - `read((s) => ({ ... }))` — declare read methods.
 * - `withIdentifier((id, s) => ({ ... }))` — declare identifier-bound
 *   methods, surfaced as `Facet.for(id)` / `Facet.withIdentifier(id)`.
 * - `catchErrorAndLog(options)` — pipeable helper for explicit best-effort
 *   storage writes.
 *
 * @public
 */
export const ProcessStore = {
  Service: defineProcessStoreFacet,
  record: processStoreRecord,
  read: processStoreRead,
  withIdentifier: processStoreWithIdentifier,
  catchErrorAndLog,
} as const;

/**
 * Type-level helpers merged into the {@link ProcessStore} value via
 * declaration merging.
 *
 * Facet modules expose namespace aliases so callers can spell out a
 * structural mock or a dependency type without importing internal
 * symbols:
 *
 * - `Facet.Type` — full service shape (record + read merged).
 * - `Facet.EmitType` — record-section shape only.
 * - `Facet.IdentifierType` — bound shape returned by
 *   `Facet.for(id)`.
 *
 * @example
 * ```ts
 * const mock: ProcessStoreQueueResource.Type = { ... };
 * const bound: ProcessStoreQueueResource.IdentifierType = { ... };
 * ```
 *
 * @public
 */
export declare namespace ProcessStore {
  export namespace Service {
    export type Type<T> = ProcessStoreFacetShape<T>;
    export type EmitType<T> = ProcessStoreFacetEmitShape<T>;
    export type IdentifierType<T> = ProcessStoreFacetIdentifierShape<T>;
  }
  export type CatchErrorAndLogOptions = ProcessStoreCatchErrorAndLogOptions;
}
