/**
 * **ProcessStore** — builder helpers for declaring storage facets.
 *
 * @remarks
 * Per-domain storage facets in `src/store/*` (e.g.
 * {@link QueueResourceStore}, {@link RunResourceStore})
 * are declared with `ProcessStore.Service<Self>()(id, ...sections)`,
 * where each section is a partial of the facet:
 *
 * - {@link ProcessStore.record} — flat write API (legacy facets; per-method
 *   static emitters).
 * - {@link ProcessStore.telemetry} — nested telemetry tree (tag/event DSL).
 * - {@link ProcessStore.query} — instance query API (yield the facet).
 * - {@link ProcessStore.for} — optional identifier-bound queries via
 *   `Facet.for(id)`.
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
 *   ProcessStore.query((s) => ({
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
  processStoreFor,
  processStoreQuery,
  processStoreRecord,
  processStoreTelemetry,
  type ProcessStoreCatchErrorAndLogOptions,
  type ProcessStoreFacetEmitShape,
  type ProcessStoreFacetIdentifierShape,
  type ProcessStoreFacetQueryShape,
  type ProcessStoreFacetShape,
} from "./internal/store/service";
import { Telemetry as TelemetryBuilders } from "./internal/store/telemetry";

/**
 * Telemetry event DSL — `namespace`, `tag`, `event`, `Schema`, `terminal`, pipes.
 *
 * @remarks
 * Pass builders to {@link ProcessStore.telemetry}. Import as `Telemetry`, not
 * `ProcessStore.Telemetry`.
 *
 * @public
 */
export const Telemetry = TelemetryBuilders;

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
 * @public
 */
export const ProcessStore = {
  Service: defineProcessStoreFacet,
  record: processStoreRecord,
  telemetry: processStoreTelemetry,
  query: processStoreQuery,
  for: processStoreFor,
  catchErrorAndLog,
} as const;

/**
 * Type-level helpers merged into the {@link ProcessStore} value via
 * declaration merging.
 *
 * @public
 */
export declare namespace ProcessStore {
  export namespace Service {
    export type Type<T> = ProcessStoreFacetShape<T>;
    export type Shape<T> = ProcessStoreFacetShape<T>;
    export type Emit<T> = ProcessStoreFacetEmitShape<T>;
    export type EmitType<T> = Emit<T>;
    export type Query<T> = ProcessStoreFacetQueryShape<T>;
    export type QueryType<T> = Query<T>;
    export type IdentifierType<T> = ProcessStoreFacetIdentifierShape<T>;
  }
  export type CatchErrorAndLogOptions = ProcessStoreCatchErrorAndLogOptions;
}
