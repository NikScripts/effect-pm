/**
 * Pipeable {@link Store.contract} shell — delegates to {@link contractDef}.
 *
 * @module internal/store/contract
 * @internal
 */

export {
  compileStoreContract,
  contractSpec,
  emptyPayloadSchema,
  isStoreContractValue,
  isStoreShapeDef,
  isStoreShapeInput,
  isStoreShapeMap,
  makeStoreContractValue,
  makeStoreShape,
  mergeStoreContracts,
  materializeContractHandle,
  toStoreContract,
  type CustomMethodEntry,
  type MergedCustom,
  type NormalizedShape,
  type NormalizedShapes,
  type NormalizeShape,
  type ShapeAppendFn,
  type ShapeHandle,
  type ShapeHandles,
  type ShapeReadFn,
  type StoreContractDef,
  type StoreContractValue,
  type StoreMethodsFn,
  type StoreShapeDef,
  type StoreShapeInput,
  type StoreShapes,
} from "./contractDef";
