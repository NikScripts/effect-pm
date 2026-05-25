/**
 * Facet service builders for {@link ProcessStore} storage modules.
 *
 * @module ProcessStoreBuilder
 */

import {
  defineProcessStoreService,
  processStoreRead,
  processStoreRecord,
  type ProcessStoreServiceEmitShape,
  type ProcessStoreServiceShape,
} from "./internal/store/service";

/**
 * Declares a storage facet (one `record` section, one `read` section, one
 * store build).
 *
 * Pattern:
 *
 * ```ts
 * export class ProcessStoreRunResource extends ProcessStoreBuilder.Service<
 *   ProcessStoreRunResource
 * >()(
 *   "@nikscripts/effect-pm/store/runResource/ProcessStoreRunResource",
 *   ProcessStoreBuilder.record((s) => ({ recordRunStarted: ... })),
 *   ProcessStoreBuilder.read((s) => ({ facts: ... })),
 * ) {}
 *
 * export declare namespace ProcessStoreRunResource {
 *   export type Type = ProcessStoreBuilder.Service.Type<typeof ProcessStoreRunResource>;
 *   export type EmitType = ProcessStoreBuilder.Service.EmitType<typeof ProcessStoreRunResource>;
 * }
 * ```
 *
 * @public
 */
export const ProcessStoreBuilder = {
  Service: defineProcessStoreService,
  record: processStoreRecord,
  read: processStoreRead,
} as const;

/**
 * Type-level helpers merged into the {@link ProcessStoreBuilder} value via
 * declaration merging. Used inside the sibling namespace block on each facet
 * class to expose `<Facet>.Type` (full service shape) and `<Facet>.EmitType`
 * (record-section emit shape).
 *
 * @public
 */
export declare namespace ProcessStoreBuilder {
  export namespace Service {
    export type Type<T> = ProcessStoreServiceShape<T>;
    export type EmitType<T> = ProcessStoreServiceEmitShape<T>;
  }
}
