/**
 * Type-level registration normalization for {@link Store.Service}.
 *
 * @module internal/store/registrationTypes
 * @internal
 */

import type { IsStoreContractValue, StoreContractValue } from "./contractDef";
import type { StandaloneStoreClass } from "./defineStore";
import type {
  RegTag,
  StoreRegistration,
  StoreRegistrationAny,
  StoreScopeTag,
} from "./registration";
import {
  storeStandaloneSym,
  type NormalizedStoreRegistration,
} from "./registrationNormalize";
import type { StoreSpec, AsStoreSpec } from "./spec";

/** @internal */
type StoreSpecEntriesOf<V> = AsStoreSpec<V>;

/** @internal */
type WithContract<
  K extends string,
  A extends string,
  S extends StoreSpec,
  C extends StoreContractValue,
  Tag extends StoreScopeTag | undefined = undefined,
> = Omit<NormalizedStoreRegistration<K, A, S>, "contract" | "tag"> & {
  readonly contract: C;
} & (Tag extends undefined ? unknown : { readonly tag: Tag });

/** @internal */
type ContractFromRegistration<R> = R extends { readonly contract: infer C extends StoreContractValue }
  ? C
  : never;

/** @internal */
type NormalizeStandaloneReg<
  ScopeKey extends string,
  Accessor extends string,
  S extends StoreSpec,
  C extends StoreContractValue,
> = WithContract<ScopeKey, Accessor, S, C>;

/** @internal */
type NormalizeRegEntry<
  R,
  Accessor extends string = R extends StoreRegistration<infer K, infer _S>
    ? K
    : R extends StandaloneStoreClass<any, any, infer SK extends string, any>
      ? SK
      : R extends {
            readonly [storeStandaloneSym]: true;
            readonly scopeKey: infer SK extends string;
          }
        ? SK
        : never,
> = R extends StoreRegistration<infer K, infer S>
  ? ContractFromRegistration<R> extends infer C extends StoreContractValue
    ? C extends never
      ? NormalizedStoreRegistration<K, Accessor, S>
      : WithContract<K, Accessor, S, C, RegTag<R>>
    : NormalizedStoreRegistration<K, Accessor, S>
  : R extends StandaloneStoreClass<
      any,
      any,
      infer SK extends string,
      infer C extends StoreContractValue,
      infer Tag extends StoreScopeTag | undefined
    >
    ? WithContract<SK, Accessor, C["spec"], C, Tag>
    : R extends {
        readonly contract: infer C extends StoreContractValue;
        readonly scopeKey: infer SK extends string;
        readonly spec: infer S extends StoreSpec;
      }
      ? NormalizeStandaloneReg<SK, Accessor, S, C>
      : R extends {
          readonly [storeStandaloneSym]: true;
          readonly scopeKey: infer SK extends string;
          readonly spec: infer S extends StoreSpec;
        }
        ? NormalizedStoreRegistration<SK, Accessor, S>
        : never;

/** @internal */
type NormalizeObjectEntry<Accessor extends string, V> = V extends StoreRegistration<
  infer K,
  infer S
>
  ? ContractFromRegistration<V> extends infer C extends StoreContractValue
    ? C extends never
      ? NormalizedStoreRegistration<K, Accessor, S>
      : WithContract<K, Accessor, S, C, RegTag<V>>
    : NormalizedStoreRegistration<K, Accessor, S>
  : V extends StandaloneStoreClass<
      any,
      any,
      infer SK extends string,
      infer C extends StoreContractValue,
      infer Tag extends StoreScopeTag | undefined
    >
    ? WithContract<SK, Accessor, C["spec"], C, Tag>
    : V extends {
        readonly contract: infer C extends StoreContractValue;
        readonly scopeKey: infer SK extends string;
        readonly spec: infer S extends StoreSpec;
      }
      ? NormalizeStandaloneReg<SK, Accessor, S, C>
      : V extends {
          readonly [storeStandaloneSym]: true;
          readonly scopeKey: infer SK extends string;
          readonly spec: infer S extends StoreSpec;
        }
        ? NormalizedStoreRegistration<SK, Accessor, S>
        : IsStoreContractValue<V> extends infer C extends StoreContractValue
        ? C extends never
          ? NormalizedStoreRegistration<Accessor, Accessor, StoreSpecEntriesOf<V>>
          : WithContract<Accessor, Accessor, C["spec"], C>
        : StoreSpecEntriesOf<V> extends StoreSpec
          ? NormalizedStoreRegistration<Accessor, Accessor, StoreSpecEntriesOf<V>>
          : V extends StoreSpec
            ? NormalizedStoreRegistration<Accessor, Accessor, V>
            : never;

/** @internal */
type NormalizeObjectRegs<O extends Record<string, unknown>> = {
  readonly [K in keyof O & string]: NormalizeObjectEntry<K, O[K]>;
};

/** @internal */
type StandaloneRegInput =
  | StandaloneStoreClass<any, any, string, StoreContractValue>
  | {
      readonly [storeStandaloneSym]: true;
      readonly scopeKey: string;
      readonly spec: StoreSpec;
      readonly contract?: StoreContractValue;
    };

/** @internal */
type NormalizeRegistrationArray<
  Regs extends ReadonlyArray<
    StoreRegistrationAny | StandaloneRegInput
  >,
> = { [I in keyof Regs]: NormalizeRegEntry<Regs[I]> };

/** @internal */
export type RegsOfStoreInput<Input> = Input extends StoreRegistration<infer K, infer S>
  ? ContractFromRegistration<Input> extends infer C extends StoreContractValue
    ? C extends never
      ? [NormalizedStoreRegistration<K, K, S>]
      : [WithContract<K, K, S, C, RegTag<Input>>]
    : [NormalizedStoreRegistration<K, K, S>]
  : Input extends {
      readonly contract: infer V;
      readonly scopeKey: infer SK extends string;
      readonly spec: infer S extends StoreSpec;
    }
    ? IsStoreContractValue<V> extends infer C extends StoreContractValue
      ? C extends never
        ? [NormalizedStoreRegistration<SK, SK, S>]
        : [NormalizeStandaloneReg<SK, SK, S, C>]
      : [NormalizedStoreRegistration<SK, SK, S>]
    : Input extends ReadonlyArray<
          StoreRegistrationAny | StandaloneRegInput
        >
      ? NormalizeRegistrationArray<Input>
      : Input extends Record<string, unknown>
        ? NormalizeObjectRegs<Input>
        : Input extends ReadonlyArray<
              ReadonlyArray<
                StoreRegistrationAny | StandaloneRegInput
              >
            >
          ? Input[0] extends ReadonlyArray<
                StoreRegistrationAny | StandaloneRegInput
              >
            ? NormalizeRegistrationArray<Input[0]>
            : ReadonlyArray<NormalizedStoreRegistration>
          : ReadonlyArray<NormalizedStoreRegistration>;

/** Bare single registration passed to {@link Store.Service} (not `[]` / `{}`). @internal */
export type IsSingleStoreInput<Input> = Input extends ReadonlyArray<unknown>
  ? false
  : Input extends StoreRegistrationAny
    ? true
    : Input extends StandaloneRegInput
      ? true
      : false;

/** Contract carried by a bare single {@link Store.Service} registration. @internal */
export type ContractForSingleInput<Input> = Input extends StoreRegistrationAny
  ? ContractFromRegistration<Input> extends infer C extends StoreContractValue
    ? C
    : never
  : Input extends {
      readonly contract: infer C extends StoreContractValue;
      readonly scopeKey: string;
      readonly spec: StoreSpec;
    }
    ? C
    : never;
