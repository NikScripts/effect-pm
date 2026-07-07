/**
 * Runtime bridge between aggregate {@link Store.Service} layers and tag `.store` accessors.
 *
 * @module internal/store/bridge
 * @internal
 */

import { Context, Effect, Stream } from "effect";
import type { Scope } from "effect/Scope";
import type { StoreChangeEvent, StoreJournalDecodeError, StoreScopeNotRegistered } from "./errors";
import type { StoreContractValue } from "./contractDef";
import type { StoreHandleOf, StoreSpec } from "./spec";

/** @internal */
export interface StoreScopeBridge {
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

/** @internal */
export class StoreScopeBridgeTag extends Context.Service<StoreScopeBridgeTag, StoreScopeBridge>()(
  "@nikscripts/effect-pm/internal/store/bridge/StoreScopeBridgeTag",
) {}
