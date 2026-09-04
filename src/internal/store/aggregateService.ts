/**
 * Legacy re-exports — prefer `./defineStore`.
 *
 * Layer-bearing surfaces (`StoreServiceClass`, `applyStoreDefaultLogLevel`, the `Storage` tag)
 * now live in the public `src/Store.ts`; this leaf re-exports only the tag-free pieces plus the
 * pure {@link StorageApi} type from `./bridge`.
 *
 * @module internal/store/aggregateService
 * @internal
 */

export type { StorageApi } from "./bridge";
export {
  defineStoreTag,
  defineStandaloneStore,
  isStandaloneStoreClass,
  isStoreServiceClass,
  StoreScopeNotRegistered,
  storeDefaultLogLevelSym,
  storeNamedSym,
  storeRegsSym,
  type StandaloneStoreClass,
  type StoreBundle,
  type StoreTagClass,
} from "./defineStore";
