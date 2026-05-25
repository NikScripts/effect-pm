/**
 * **ProcessStore** — builder helpers for storage facets.
 *
 * @module ProcessStore
 */

import {
  defineProcessStoreFacet,
  processStoreRead,
  processStoreRecord,
  processStoreWithIdentifier,
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
} from "./ProcessStoreEvent";

/**
 * Declares a storage facet with one record section, one read section, and one
 * shared runtime-storage-backed implementation.
 *
 * @public
 */
export const ProcessStore = {
  Service: defineProcessStoreFacet,
  record: processStoreRecord,
  read: processStoreRead,
  withIdentifier: processStoreWithIdentifier,
} as const;

/**
 * Type-level helpers merged into the {@link ProcessStore} value via declaration
 * merging. Facet modules use these to expose `<Facet>.Type` and
 * `<Facet>.EmitType`.
 *
 * @public
 */
export declare namespace ProcessStore {
  export namespace Service {
    export type Type<T> = ProcessStoreFacetShape<T>;
    export type EmitType<T> = ProcessStoreFacetEmitShape<T>;
    export type IdentifierType<T> = ProcessStoreFacetIdentifierShape<T>;
  }
}
