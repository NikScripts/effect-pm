/**
 * {@link Store.Service} / {@link Store.Tag} factory — class-based aggregate stores.
 *
 * @module internal/store/defineStore
 * @internal
 */

import { Context, Effect } from "effect";
import type { Simplify } from "effect/Types";
import { StoreScopeNotRegistered } from "./errors";
import type { ScopeKeyFromLookup, ScopeKeyOf, StoreScopeTag } from "./registration";
import {
  normalizeStoreRegistrations,
  type NormalizedStoreRegistration,
  storeSingleSym,
  storeStandaloneSym,
  isSingleStoreServiceInput,
} from "./registrationNormalize";
import type {
  ContractForSingleInput,
  IsSingleStoreInput,
  RegsOfStoreInput,
} from "./registrationTypes";
import {
  type FlatStoreHandleOf,
  type StoreHandleFromContract,
  type StoreSpec,
} from "./spec";
import type { StoreContractValue } from "./contractDef";
import type { StoreLogLevel } from "./types";

export const storeRegsSym = Symbol.for("@nikscripts/effect-pm/Store/registrations");
export const storeDefaultLogLevelSym = Symbol.for("@nikscripts/effect-pm/Store/defaultLogLevel");
export const storeNamedSym = Symbol.for("@nikscripts/effect-pm/Store/named");

/** @internal */
export type RegistrationHandleOf<R> =
  R extends { readonly contract: infer C extends StoreContractValue }
    ? StoreHandleFromContract<C>
    : R extends NormalizedStoreRegistration<string, string, infer S extends StoreSpec>
      ? FlatStoreHandleOf<S>
      : never;

/** True when `S` is an unbounded `string`, not a string literal. @internal */
type IsWideString<S extends string> = string extends S ? true : false;

/** Match a registration by exact scope key (wide `string` never matches — use tag or accessor). @internal */
type RegWithExactScopeKey<
  R,
  SK extends string,
> = IsWideString<SK> extends true
  ? never
  : R extends { readonly scopeKey: infer Key extends string }
    ? IsWideString<Key> extends true
      ? never
      : [Key] extends [SK]
        ? SK extends Key
          ? R
          : never
        : never
    : never;

/** Match a registration whose `tag` is exactly the lookup key (resource / queue tag class). @internal */
type RegWithExactTag<
  R,
  K,
> = R extends { readonly tag?: infer T }
  ? K extends T
    ? T extends K
      ? R
      : never
    : never
  : never;

/** Match a registration by exact accessor. @internal */
type RegWithExactAccessor<
  R,
  A extends string,
> = IsWideString<A> extends true
  ? never
  : R extends { readonly accessor: infer Key extends string }
    ? IsWideString<Key> extends true
      ? never
      : [Key] extends [A]
        ? A extends Key
          ? R
          : never
        : never
    : never;

/** True for tuple / array registration inputs. @internal */
type IsRegArray<Regs> = Regs extends readonly NormalizedStoreRegistration[] ? true : false;

/** Registration entries from tuple/array or named-object {@link RegsOfStoreInput}. @internal */
type RegEntries<Regs> = IsRegArray<Regs> extends true
  ? Regs extends readonly (infer R extends NormalizedStoreRegistration)[]
    ? R
    : never
  : Regs extends Record<string, infer R extends NormalizedStoreRegistration>
    ? R
    : never;

/** @internal */
type StoreBundleArray<Regs extends readonly NormalizedStoreRegistration[]> = Simplify<{
  readonly [R in Regs[number] as R["accessor"]]: RegistrationHandleOf<R>;
}>;

/** @internal */
type StoreBundleObject<Regs extends Record<string, NormalizedStoreRegistration>> = Simplify<{
  readonly [A in keyof Regs & string]: RegistrationHandleOf<Regs[A]>;
}>;

/** @internal */
export type StoreBundle<Regs> = IsRegArray<Regs> extends true
  ? Regs extends readonly NormalizedStoreRegistration[]
    ? StoreBundleArray<Regs>
    : never
  : Regs extends Record<string, NormalizedStoreRegistration>
    ? StoreBundleObject<Regs>
    : never;

/** @internal */
export type RegistrationAtKey<
  Regs,
  K,
> = [RegWithExactTag<RegEntries<Regs>, K>] extends [never]
  ? ScopeKeyFromLookup<K> extends infer SK extends string
    ? [RegWithExactScopeKey<RegEntries<Regs>, SK>] extends [never]
      ? RegWithExactAccessor<RegEntries<Regs>, K & string>
      : RegWithExactScopeKey<RegEntries<Regs>, SK>
    : RegWithExactAccessor<RegEntries<Regs>, K & string>
  : RegWithExactTag<RegEntries<Regs>, K>;

/** @internal */
export type StoreHandleAtKey<
  Regs,
  K,
> = RegistrationHandleOf<
  RegistrationAtKey<Regs, K> extends infer R extends NormalizedStoreRegistration ? R : never
>;

/** @internal */
export type StoreAtMethod<
  Self,
  Regs,
> = <const K extends string | StoreScopeTag>(
  key: K,
) => Effect.Effect<StoreHandleAtKey<Regs, K>, StoreScopeNotRegistered, Self>;

/** @internal */
export type StoreAggregateBase<
  Self,
  Id extends string,
  Regs,
> = Context.ServiceClass<Self, Id, StoreBundle<Regs>> & {
  readonly [storeRegsSym]: Regs;
  readonly [storeNamedSym]: boolean;
  readonly [storeDefaultLogLevelSym]?: StoreLogLevel;
  readonly at: StoreAtMethod<Self, Regs>;
};

/**
 * Registration-only aggregate — no layers. `src/Store.ts` attaches `layerMemory` / `layer`
 * (`StoreServiceClass`) via the co-located `Storage` layer builders.
 *
 * @internal
 */
export type StoreTagClass<
  Self = unknown,
  Id extends string = string,
  Regs = ReadonlyArray<NormalizedStoreRegistration>,
> = StoreAggregateBase<Self, Id, Regs>;

/**
 * Single-registration {@link Store.Service} — service type is the store handle (no `at`).
 *
 * @internal
 */
export type SingleStoreTagClass<
  Self,
  Id extends string,
  C extends StoreContractValue,
> = Context.ServiceClass<Self, Id, StoreHandleFromContract<C>> & {
  readonly [storeRegsSym]: ReadonlyArray<NormalizedStoreRegistration>;
  readonly [storeSingleSym]: true;
  readonly [storeNamedSym]: false;
  readonly [storeDefaultLogLevelSym]?: StoreLogLevel;
};

/**
 * Standalone single-scope store class — no layers. `src/Store.ts` attaches `layerMemory` /
 * `layer` via the co-located `Storage` layer builders.
 *
 * @internal
 */
export type StandaloneStoreClass<
  Self,
  Id extends string,
  K extends string = string,
  C extends StoreContractValue = StoreContractValue,
  Tag extends StoreScopeTag | undefined = undefined,
> = Context.ServiceClass<Self, Id, StoreHandleFromContract<C>> & {
  readonly [storeStandaloneSym]: true;
  readonly scopeKey: K;
  readonly spec: C["spec"];
  readonly contract: C;
} & (Tag extends undefined ? unknown : { readonly tag: Tag });

export { isStandaloneStoreClass } from "./registrationNormalize";

/** @internal */
const resolveLookupKey = (
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  key: string | StoreScopeTag,
): string => {
  const raw = typeof key === "string" ? key : key.key;
  if (registrations.some((registration) => registration.accessor === raw)) {
    return raw;
  }
  const byScope = registrations.find((registration) => registration.scopeKey === raw);
  if (byScope !== undefined) {
    return byScope.accessor;
  }
  return raw;
};

/** @internal */
const makeAt = <
  Self,
  Id extends string,
  Regs,
>(
  tag: Context.ServiceClass<Self, Id, StoreBundle<Regs>>,
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
) =>
  (<const K extends string | StoreScopeTag>(
    key: K,
  ): Effect.Effect<StoreHandleAtKey<Regs, K>, StoreScopeNotRegistered, Self> =>
    Effect.flatMap(tag, (bundle) => {
      const accessor = resolveLookupKey(registrations, key);
      const handle = bundle[accessor as keyof StoreBundle<Regs>];
      if (handle === undefined) {
        const scopeKey = typeof key === "string" ? key : key.key;
        return Effect.fail(new StoreScopeNotRegistered({ key: scopeKey }));
      }
      return Effect.succeed(handle as unknown as StoreHandleAtKey<Regs, K>);
    })) as StoreAtMethod<Self, Regs>;

/** @internal */
type InputOfArgs<Args extends ReadonlyArray<unknown>> = Args extends readonly [infer Only]
  ? Only
  : Args;

/**
 * Build the registration-only aggregate class (regs + `at`, no layers). `src/Store.ts` attaches
 * the `Storage`-providing layers to produce a `StoreServiceClass`.
 *
 * @internal
 */
const defineStoreAggregateInner =
  <Self, const Id extends string>(id: Id) =>
  <const Input>(input: Input) => {
    const { registrations: normalized, named } = normalizeStoreRegistrations(input);
    const registrations = normalized as ReadonlyArray<NormalizedStoreRegistration>;

    if (isSingleStoreServiceInput(input) && registrations.length === 1) {
      const registration = registrations[0]!;
      const contract = registration.contract;
      if (contract === undefined) {
        throw new Error(
          "Store.Service single registration requires a Store.contract value",
        );
      }
      type C = ContractForSingleInput<Input>;
      const base = Context.Service<Self, StoreHandleFromContract<C>>()(id);
      class StoreSingle extends base {}
      return Object.assign(StoreSingle, {
        [storeRegsSym]: registrations,
        [storeSingleSym]: true as const,
        [storeNamedSym]: false,
      }) as SingleStoreTagClass<Self, Id, C>;
    }

    type Regs = RegsOfStoreInput<Input>;
    const base = Context.Service<Self, StoreBundle<Regs>>()(id);
    const at = makeAt(base, registrations);

    class StoreAggregate extends base {}

    return Object.assign(StoreAggregate, {
      [storeRegsSym]: registrations,
      [storeNamedSym]: named,
      at,
    }) as StoreTagClass<Self, Id, Regs>;
  };

/** @internal */
export const defineStoreTag = <Self, const Id extends string>(id: Id) => {
  const define = <const Args extends ReadonlyArray<unknown>>(...args: Args) => {
    type Input = InputOfArgs<Args>;
    const input = (args.length === 1 ? args[0]! : args) as Input;
    return defineStoreAggregateInner<Self, Id>(id)(input) as IsSingleStoreInput<Input> extends true
      ? SingleStoreTagClass<Self, Id, ContractForSingleInput<Input>>
      : StoreTagClass<Self, Id, RegsOfStoreInput<Input>>;
  };
  return define;
};

/** @internal */
export const isSingleStoreTagClass = (
  value: unknown,
): value is SingleStoreTagClass<unknown, string, StoreContractValue> =>
  typeof value === "function" && storeSingleSym in value;

/**
 * Normalized registration for a standalone store — shared by {@link defineStandaloneStore} and
 * the layer attachment in `src/Store.ts` (single source for the standalone → registration shape).
 *
 * @internal
 */
export const buildStandaloneRegistration = <
  const Scope extends string | StoreScopeTag,
  const C extends StoreContractValue,
>(
  scope: Scope,
  contract: C,
): NormalizedStoreRegistration => {
  const scopeKey = typeof scope === "string" ? scope : scope.key;
  return {
    scopeKey,
    accessor: scopeKey,
    spec: contract.spec,
    contract,
    ...(typeof scope === "string" ? {} : { tag: scope }),
  };
};

/** @internal */
export const defineStandaloneStore = <
  const Scope extends string | StoreScopeTag,
  const C extends StoreContractValue,
>(
  scope: Scope,
  contract: C,
): StandaloneStoreClass<
  { readonly _tag: ScopeKeyOf<Scope> },
  `@nikscripts/effect-pm/Store/scope/${ScopeKeyOf<Scope>}`,
  ScopeKeyOf<Scope>,
  C,
  Scope extends StoreScopeTag ? Scope : undefined
> => {
  type ScopeKey = ScopeKeyOf<Scope>;
  type Self = { readonly _tag: ScopeKey };
  type Id = `@nikscripts/effect-pm/Store/scope/${ScopeKey}`;
  const scopeKey = (typeof scope === "string" ? scope : scope.key) as ScopeKey;
  const id = `@nikscripts/effect-pm/Store/scope/${scopeKey}` as Id;
  const plainSpec = contract.spec;

  const base = Context.Service<Self, StoreHandleFromContract<C>>()(id);

  return Object.assign(base, {
    [storeStandaloneSym]: true as const,
    scopeKey,
    spec: plainSpec,
    contract,
    tag: typeof scope === "string" ? undefined : scope,
  }) as unknown as StandaloneStoreClass<
    Self,
    Id,
    ScopeKey,
    C,
    Scope extends StoreScopeTag ? Scope : undefined
  >;
};

/** @internal */
export const isStoreServiceClass = (value: unknown): value is StoreTagClass =>
  typeof value === "function" && storeRegsSym in value;

export { StoreScopeNotRegistered } from "./errors";
