/**
 * {@link Store.Service} factory — aggregate backing for scoped registrations.
 *
 * @module internal/store/aggregateService
 * @internal
 */

import { Context, Data, Effect, Layer, Ref } from "effect";
import { acquireFromScopes, type ScopeState, type StoredRow } from "./memoryScope";
import {
  normalizeRegistrations,
  type RegisteredKeys,
  type StoreRegistration,
  type StoreRegistrationAny,
  type StoreScopeTag,
  type TagForKey,
} from "./registration";
import { mergeSpecs } from "./specMerge";
import {
  type StoreHandleForKey,
  type StoreHandleOf,
  type StoreSpec,
} from "./spec";
import type { StoreLayerOptions, StoreLogLevel } from "./types";

export const storeRegsSym = Symbol.for("@nikscripts/effect-pm/Store/registrations");
export const storeDefaultLogLevelSym = Symbol.for("@nikscripts/effect-pm/Store/defaultLogLevel");

/** @internal */
export class StoreScopeNotRegistered extends Data.TaggedError("StoreScopeNotRegistered")<{
  readonly key: string;
}> {}

/** @internal */
export interface StoreRoot {
  readonly acquire: <S extends StoreSpec>(
    key: string,
    spec: S,
  ) => Effect.Effect<StoreHandleOf<S>, StoreScopeNotRegistered>;
  readonly defaultLogLevel: StoreLogLevel | undefined;
}

/** @internal */
export type StoreServiceClass<
  Self,
  Regs extends ReadonlyArray<StoreRegistrationAny>,
  Backing = never,
> = Context.Service<Self, StoreRoot> & {
  readonly [storeRegsSym]: Regs;
  readonly [storeDefaultLogLevelSym]?: StoreLogLevel;
  readonly layerMemory: Layer.Layer<Self>;
  readonly layer: (options?: StoreLayerOptions) => Layer.Layer<Self>;
  readonly backingLayer: Layer.Layer<Backing, never, Self>;
  <K extends RegisteredKeys<Regs>>(
    key: K | TagForKey<Regs, K>,
  ): Effect.Effect<
    StoreHandleForKey<Regs, K>,
    StoreScopeNotRegistered,
    Self
  >;
};

/** @internal */
const mergeRegistrationsByKey = (
  registrations: ReadonlyArray<StoreRegistrationAny>,
): ReadonlyMap<string, StoreRegistrationAny> => {
  const merged = new Map<string, StoreRegistrationAny>();
  for (const registration of registrations) {
    const prior = merged.get(registration.scopeKey);
    if (prior === undefined) {
      merged.set(registration.scopeKey, registration);
      continue;
    }
    merged.set(registration.scopeKey, {
      ...prior,
      spec: mergeSpecs(prior.spec, registration.spec),
      logLevel: registration.logLevel ?? prior.logLevel,
    });
  }
  return merged;
};

/** @internal */
const buildScopeState = (
  merged: ReadonlyMap<string, StoreRegistrationAny>,
): Effect.Effect<Map<string, ScopeState>> =>
  Effect.gen(function* () {
    const scopeState = new Map<string, ScopeState>();
    for (const [key, registration] of merged) {
      scopeState.set(key, {
        spec: registration.spec,
        rows: yield* Ref.make<ReadonlyArray<StoredRow>>([]),
      });
    }
    return scopeState;
  });

/** @internal */
const buildMemoryLayer = <Self>(
  tag: Context.Service<Self, StoreRoot>,
  merged: ReadonlyMap<string, StoreRegistrationAny>,
  defaultLogLevel: StoreLogLevel | undefined,
): Layer.Layer<Self> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      const scopes = yield* buildScopeState(merged);
      const service: StoreRoot = {
        defaultLogLevel,
        acquire: (key, spec) => acquireFromScopes(scopes, key, spec),
      };
      return service;
    }),
  );

/** @internal */
export const defineStoreService =
  <
    Self,
    Backing extends Context.Service<any, { readonly acquire: StoreRoot["acquire"] }>,
  >(
    backingTag: Backing,
  ) => {
    const factory = (id: string) => {
      function define<const Regs extends ReadonlyArray<StoreRegistration<string, StoreSpec>>>(
        registrations: Regs,
      ): StoreServiceClass<Self, Regs, Backing>;
      function define<
        const Regs extends readonly [StoreRegistration<string, StoreSpec>, ...Array<StoreRegistration<string, StoreSpec>>],
      >(
        ...registrations: Regs
      ): StoreServiceClass<Self, Regs, Backing>;
      function define(
        ...args: ReadonlyArray<
          StoreRegistration<string, StoreSpec> | ReadonlyArray<StoreRegistration<string, StoreSpec>>
        >
      ): StoreServiceClass<Self, ReadonlyArray<StoreRegistration<string, StoreSpec>>, Backing> {
        const registrations = normalizeRegistrations(args);
        const merged = mergeRegistrationsByKey(registrations);
        const defaultLogLevel = undefined;

        const Base = Context.Service<Self, StoreRoot>()(id);

        const acquireByKey = <K extends RegisteredKeys<typeof registrations>>(
          keyOrTag: K | TagForKey<typeof registrations, K>,
        ): Effect.Effect<
          StoreHandleForKey<typeof registrations, K>,
          StoreScopeNotRegistered,
          Self
        > => {
          const key = typeof keyOrTag === "string" ? keyOrTag : keyOrTag.key;
          const registration = merged.get(key);
          if (registration === undefined) {
            return Effect.fail(new StoreScopeNotRegistered({ key }));
          }
          return Effect.flatMap(
            Base,
            (root) => root.acquire(key, registration.spec),
          ) as Effect.Effect<
            StoreHandleForKey<typeof registrations, K>,
            StoreScopeNotRegistered,
            Self
          >;
        };

        const layerMemory = buildMemoryLayer(Base, merged, defaultLogLevel);
        const layer = (options?: StoreLayerOptions) =>
          buildMemoryLayer(Base, merged, options?.logLevel ?? defaultLogLevel);

        const backingLayerForStore: Layer.Layer<Backing, never, Self> = Layer.effect(
          backingTag,
          Effect.gen(function* () {
            const root = yield* Base;
            return {
              acquire: root.acquire,
            };
          }),
        );

        const extras = {
          [storeRegsSym]: registrations,
          layerMemory,
          layer,
          backingLayer: backingLayerForStore,
        };

        const Callable = new Proxy(Base, {
          apply(_target, _thisArg, args: ReadonlyArray<string | StoreScopeTag>) {
            return acquireByKey(args[0]!);
          },
        });

        return Object.assign(Callable, Base, extras) as unknown as StoreServiceClass<
          Self,
          typeof registrations,
          Backing
        >;
      }

      return define;
    };

    return factory;
  };

/** @internal */
export const applyStoreDefaultLogLevel = <T extends StoreServiceClass<any, any, any>>(
  storeClass: T,
  logLevel: StoreLogLevel,
): T => {
  const merged = mergeRegistrationsByKey(storeClass[storeRegsSym]);
  return Object.assign(storeClass, {
    [storeDefaultLogLevelSym]: logLevel,
    layerMemory: buildMemoryLayer(storeClass, merged, logLevel),
    layer: (options?: StoreLayerOptions) =>
      buildMemoryLayer(storeClass, merged, options?.logLevel ?? logLevel),
  });
};

/** @internal */
export const isStoreServiceClass = (value: unknown): value is StoreServiceClass<any, any, any> =>
  typeof value === "function" &&
  storeRegsSym in value &&
  "layerMemory" in value;
