/**
 * Shared registration helpers for resource-kind store facets (queue, process, …).
 *
 * @module internal/store/facetStore
 * @internal
 */

import { makeRegistration, type StoreRegistration, type StoreScopeTag } from "./registration";
import { mergeSpecs, type MergeSpecs } from "./specMerge";
import type { StoreSpec } from "./spec";

/** @internal */
export function facetStoreRegistration<
  const Tag extends StoreScopeTag,
  const BuiltIn extends StoreSpec,
>(
  tag: Tag,
  builtIn: BuiltIn,
): StoreRegistration<Tag["key"], BuiltIn>;

/** @internal */
export function facetStoreRegistration<
  const Tag extends StoreScopeTag,
  const BuiltIn extends StoreSpec,
  const Extended extends StoreSpec,
>(
  tag: Tag,
  builtIn: BuiltIn,
  extended: Extended,
): StoreRegistration<Tag["key"], MergeSpecs<BuiltIn, Extended>>;

/** @internal */
export function facetStoreRegistration(
  tag: StoreScopeTag,
  builtIn: StoreSpec,
  extended?: StoreSpec,
): StoreRegistration {
  return makeRegistration(
    tag,
    extended === undefined ? builtIn : mergeSpecs(builtIn, extended),
  );
}
