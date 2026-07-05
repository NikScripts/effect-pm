/**
 * Store registration descriptors and log-level modifiers.
 *
 * @module internal/store/registration
 * @internal
 */

import type { StoreLogLevel } from "./types";
import type { StoreSpec } from "./spec";
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
  readonly tag?: StoreScopeTag;
  readonly logLevel?: StoreLogLevel;
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
  : Scope extends StoreScopeTag
    ? Scope["key"]
    : never;

/** @internal */
export const makeRegistration = <
  const Scope extends string | StoreScopeTag,
  const S extends StoreSpec,
>(
  scope: Scope,
  spec: S,
): StoreRegistration<ScopeKeyOf<Scope>, S> => {
  const scopeKey = (typeof scope === "string" ? scope : scope.key) as ScopeKeyOf<Scope>;
  return {
    [storeRegSym]: storeRegSym,
    scopeKey,
    spec,
    ...(typeof scope === "string" ? {} : { tag: scope }),
  };
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
export const isRegistrationPipeTarget = (value: unknown): value is StoreRegistrationAny | StoreSpec =>
  isStoreRegistration(value) || isStoreSpec(value);
