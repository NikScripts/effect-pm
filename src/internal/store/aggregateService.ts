/**
 * Legacy re-exports — prefer `./defineStore`.
 *
 * @module internal/store/aggregateService
 * @internal
 */

export {
  applyStoreDefaultLogLevel,
  defineStoreService,
  defineStoreTag,
  defineStandaloneStore,
  isStandaloneStoreClass,
  isStoreServiceClass,
  StoreScopeBridgeTag,
  StoreScopeNotRegistered,
  storeDefaultLogLevelSym,
  storeNamedSym,
  storeRegsSym,
  type StandaloneStoreClass,
  type StoreBundle,
  type StoreScopeBridge,
  type StoreServiceClass,
  type StoreTagClass,
} from "./defineStore";
