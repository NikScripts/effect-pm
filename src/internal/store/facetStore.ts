/**
 * Shared registration helpers for resource-kind store facets (queue, process, …).
 *
 * @module internal/store/facetStore
 * @internal
 */

import {
  mergeStoreContracts,
  type ExtendCustom,
  type StoreContractValue,
  type StoreShapes,
  type ShapeHandles,
} from "./contractDef";
import {
  makeRegistration,
  type RegisteredWithContract,
  type ScopeKeyOf,
  type StoreRegistration,
  type StoreScopeTag,
} from "./registration";

/** @internal */
export function facetStoreRegistration<
  const Tag extends StoreScopeTag,
  const BuiltIn extends StoreContractValue,
>(
  tag: Tag,
  builtIn: BuiltIn,
): RegisteredWithContract<ScopeKeyOf<Tag>, BuiltIn["spec"], BuiltIn, Tag>;

/** @internal */
export function facetStoreRegistration<
  const Tag extends StoreScopeTag,
  const BuiltIn extends StoreContractValue,
  const Extended extends StoreShapes,
>(
  tag: Tag,
  builtIn: BuiltIn,
  extended: Extended,
): RegisteredWithContract<
  ScopeKeyOf<Tag>,
  BuiltIn["spec"],
  StoreContractValue<BuiltIn["shapes"] & Extended, BuiltIn["custom"]>,
  Tag
>;

/** @internal */
export function facetStoreRegistration<
  const Tag extends StoreScopeTag,
  const BuiltIn extends StoreContractValue,
  const Extended extends StoreShapes,
  const Added extends Readonly<Record<string, unknown>>,
>(
  tag: Tag,
  builtIn: BuiltIn,
  extended: Extended,
  methods: (handles: ShapeHandles<BuiltIn["shapes"] & Extended>) => Added,
): RegisteredWithContract<
  ScopeKeyOf<Tag>,
  BuiltIn["spec"],
  StoreContractValue<
    BuiltIn["shapes"] & Extended,
    ExtendCustom<BuiltIn, Added>
  >,
  Tag
>;

/** @internal */
export function facetStoreRegistration(
  tag: StoreScopeTag,
  builtIn: StoreContractValue,
  extended?: StoreShapes,
  methods?: (handles: ShapeHandles<StoreShapes>) => Readonly<Record<string, unknown>>,
): StoreRegistration {
  const contract =
    extended === undefined
      ? builtIn
      : methods === undefined
        ? mergeStoreContracts(builtIn, extended)
        : mergeStoreContracts(builtIn, extended, methods);
  return makeRegistration(tag, contract);
}
