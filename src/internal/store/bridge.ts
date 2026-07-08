/**
 * Runtime bridge type between aggregate {@link Store.Service} layers and tag `.store` accessors.
 *
 * The {@link Storage} service tag that carries this API is co-located with its layers in
 * `src/Store.ts`. This leaf holds only the pure type so internal modules can reference the API
 * shape without importing the public namespace.
 *
 * @module internal/store/bridge
 */

import type { Effect, Stream } from "effect";
import type { Scope } from "effect/Scope";
import type { StoreChangeEvent, StoreJournalDecodeError, StoreScopeNotRegistered } from "./errors";
import type { StoreContractValue } from "./contractDef";
import type { StoreHandleOf, StoreSpec } from "./spec";

/**
 * Scope bridge API carried by {@link Storage | Store.Storage}.
 *
 * @public
 */
export interface StorageApi {
  readonly at: <Input extends StoreSpec | StoreContractValue>(
    scopeKey: string,
    input: Input,
  ) => Effect.Effect<StoreHandleOf<Input>, StoreScopeNotRegistered>;
  readonly changes: (
    scopeKey: string,
  ) => Effect.Effect<
    Stream.Stream<StoreChangeEvent, StoreJournalDecodeError>,
    StoreScopeNotRegistered,
    Scope
  >;
}
