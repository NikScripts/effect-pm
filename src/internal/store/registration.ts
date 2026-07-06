/**
 * Store registration descriptors and log-level modifiers.
 *
 * @module internal/store/registration
 * @internal
 */

import type { StoreLogLevel } from "./types";
import {
  contractSpec,
  isStoreContractValue,
  isStoreShapeMap,
  toStoreContract,
  type StoreContractValue,
} from "./contractDef";
import type { StoreSpec, AsStoreSpec } from "./spec";
import { isStoreSpec } from "./spec";

export const storeRegSym = Symbol.for("@nikscripts/effect-pm/Store/registration");

/** Minimal tag shape for scope keys — avoids importing {@link Resource}. @internal */
export interface StoreScopeTag {
  readonly key: string;
}

/** @internal */
export interface StoreRegistration<
  K extends string = string,
  S extends StoreSpec = StoreSpec,
> {
  readonly [storeRegSym]: typeof storeRegSym;
  readonly scopeKey: K;
  readonly spec: S;
  readonly contract?: StoreContractValue;
  readonly tag?: StoreScopeTag;
  readonly logLevel?: StoreLogLevel;
  readonly maxRows?: number;
}

/** @internal */
export type StoreRegistrationAny = StoreRegistration<string, StoreSpec>;

/** @internal */
export const isStoreRegistration = (value: unknown): value is StoreRegistrationAny =>
  typeof value === "object" && value !== null && storeRegSym in value;

/** @internal */
export const isStoreRegistrationArray = (
  value: ReadonlyArray<unknown>,
): value is ReadonlyArray<StoreRegistrationAny> =>
  value.length > 0 && value.every(isStoreRegistration);

/** @internal */
export const normalizeRegistrations = (
  args: ReadonlyArray<StoreRegistrationAny | ReadonlyArray<StoreRegistrationAny>>,
): ReadonlyArray<StoreRegistrationAny> => {
  if (args.length === 1 && Array.isArray(args[0]) && isStoreRegistrationArray(args[0])) {
    return args[0];
  }
  return args as ReadonlyArray<StoreRegistrationAny>;
};

/** @internal */
export type ScopeKeyOf<Scope extends string | StoreScopeTag> = Scope extends string
  ? Scope
  : Scope extends { readonly key: infer Id extends string }
    ? Id
    : never;

/**
 * Resolve a scope key from a string, tag instance, or tag class (`Tag.key`).
 *
 * @internal
 */
export type ScopeKeyFromLookup<K> = K extends { readonly key: infer Id extends string }
  ? Id
  : K extends string
    ? K
    : never;

/** Registration with a concrete contract attached (no optional widening). @internal */
export type RegisteredWithContract<
  K extends string,
  S extends StoreSpec,
  C extends StoreContractValue,
  Tag extends StoreScopeTag | undefined = undefined,
> = Omit<StoreRegistration<K, S>, "contract" | "tag"> & {
  readonly contract: C;
} & (Tag extends undefined ? {} : { readonly tag: Tag });

/** Tag type carried on a registration, if any. @internal */
export type RegTag<R> = R extends { readonly tag?: infer T extends StoreScopeTag } ? T : undefined;

/** @internal */
export const makeRegistration = <
  const Scope extends string | StoreScopeTag,
  const Input,
>(
  scope: Scope,
  spec: Input & {},
): Input extends StoreContractValue
  ? Scope extends StoreScopeTag
    ? RegisteredWithContract<ScopeKeyOf<Scope>, Input["spec"], Input, Scope>
    : RegisteredWithContract<ScopeKeyOf<Scope>, Input["spec"], Input>
  : Scope extends StoreScopeTag
    ? StoreRegistration<ScopeKeyOf<Scope>, AsStoreSpec<Input>> & { readonly tag: Scope }
    : StoreRegistration<ScopeKeyOf<Scope>, AsStoreSpec<Input>> => {
  const scopeKey = (typeof scope === "string" ? scope : scope.key) as ScopeKeyOf<Scope>;
  const contract =
    isStoreContractValue(spec) || isStoreShapeMap(spec)
      ? toStoreContract(spec as StoreContractValue | StoreContractValue["shapes"])
      : undefined;
  return {
    [storeRegSym]: storeRegSym,
    scopeKey,
    spec: (contract !== undefined ? contractSpec(contract) : spec) as Input extends StoreContractValue
      ? Input["spec"]
      : AsStoreSpec<Input>,
    ...(contract !== undefined ? { contract } : {}),
    ...(typeof scope === "string" ? {} : { tag: scope }),
  } as unknown as Input extends StoreContractValue
    ? Scope extends StoreScopeTag
      ? RegisteredWithContract<ScopeKeyOf<Scope>, Input["spec"], Input, Scope>
      : RegisteredWithContract<ScopeKeyOf<Scope>, Input["spec"], Input>
    : Scope extends StoreScopeTag
      ? StoreRegistration<ScopeKeyOf<Scope>, AsStoreSpec<Input>> & { readonly tag: Scope }
      : StoreRegistration<ScopeKeyOf<Scope>, AsStoreSpec<Input>>;
};

/** @internal */
export type StoreRegistrationKey<R> = R extends StoreRegistration<infer K, infer _S> ? K : never;

/** @internal */
export type RegisteredKeys<Regs extends ReadonlyArray<StoreRegistrationAny>> =
  StoreRegistrationKey<Regs[number]>;

/** @internal */
export type TagForKey<
  Regs extends ReadonlyArray<StoreRegistrationAny>,
  K extends string,
> = Extract<
  Regs[number],
  StoreRegistration<K, StoreSpec>
> extends StoreRegistration<K, StoreSpec>
  ? Extract<Regs[number], StoreRegistration<K, StoreSpec>> extends {
      readonly tag?: infer T extends StoreScopeTag;
    }
    ? T extends { readonly key: K }
      ? T
      : never
    : never
  : never;

/** @internal */
export const withRegistrationLogLevel = <R extends StoreRegistrationAny>(
  registration: R,
  logLevel: StoreLogLevel,
): R => Object.assign({}, registration, { logLevel });

/** @internal */
export const withRegistrationRetention = <R extends StoreRegistrationAny>(
  registration: R,
  maxRows: number,
): R => Object.assign({}, registration, { maxRows });

/** @internal */
export const isRegistrationPipeTarget = (
  value: unknown,
): value is StoreRegistrationAny | StoreSpec | StoreContractValue =>
  isStoreRegistration(value) || isStoreSpec(value) || isStoreContractValue(value);
