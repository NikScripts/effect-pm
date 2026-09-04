/**
 * PolicyBuilder engine — HttpApi-shaped constructable families with Schema keys.
 *
 * `PolicyBuilder.make(id).key(name, schema, { defaultValue, toRuntime? })` returns
 * a constructor so `class LookupPolicies extends … {}` works (HttpApi / Router).
 * Each key string is PascalCase (owned tag). On the Def:
 * - PascalCase binding → `Context.Reference` (`Sticky`)
 * - camelCase method → Layer factory (`sticky(value)`), via `Uncapitalize`
 * Constructable is plural (`LookupPolicies` / `NodePolicies`); module namespace
 * is singular (`LookupPolicy` / `NodePolicy`).
 *
 * @internal
 */
import type { Context } from "effect";
import { Context as ContextMod, Layer, Schema } from "effect";
import { dual } from "effect/Function";
import { pipeArguments } from "effect/Pipeable";
import { hasProperty } from "effect/Predicate";

/** Brand key shared by every policy family (value = family id). @internal */
export const BrandKey = "~hyperlink-ts/PolicyBuilder" as const;

/** Runtime config slot on a branded policy. @internal */
export const ConfigKey = "~hyperlink-ts/PolicyBuilder/Config" as const;

/** TypeId on family constructables. @internal */
export const DefTypeId = "~hyperlink-ts/PolicyBuilder/Def" as const;

/**
 * One config key: Schema (config input) + Reference (runtime) + encode.
 *
 * @internal
 */
export interface PolicyBuilderKeySpec<
  S extends Schema.Top,
  in out Runtime = Schema.Schema.Type<S>,
> {
  readonly schema: S;
  readonly reference: Context.Reference<Runtime>;
  readonly encode: (input: Schema.Schema.Type<S>) => Runtime;
}

/**
 * Branded policy: a `Layer.Layer<never>` plus frozen config.
 *
 * @internal
 */
export interface PolicyBuilderPolicy<Id extends string, out C extends object>
  extends Layer.Layer<never> {
  readonly [BrandKey]: Id;
  readonly [ConfigKey]: C;
}

/**
 * Patch `Prev` with `Patch` — patch keys win (Layer merge last-write).
 *
 * @internal
 */
export type PolicyBuilderMergeConfigs<
  Prev extends object,
  Patch extends object,
> = Omit<Prev, keyof Patch> & Patch;

/**
 * Config type parameter of a branded policy.
 *
 * @internal
 */
export type PolicyBuilderConfigOf<P> =
  P extends PolicyBuilderPolicy<string, infer C> ? C : never;

/**
 * Left-to-right merge of policy config types.
 *
 * @internal
 */
export type PolicyBuilderMergePolicyList<
  Id extends string,
  Ps extends ReadonlyArray<PolicyBuilderPolicy<Id, object>>,
> = Ps extends readonly []
  ? Record<never, never>
  : Ps extends readonly [PolicyBuilderPolicy<Id, infer H>]
    ? H
    : Ps extends readonly [
        PolicyBuilderPolicy<Id, infer H>,
        ...infer Rest,
      ]
      ? Rest extends ReadonlyArray<PolicyBuilderPolicy<Id, object>>
        ? PolicyBuilderMergeConfigs<H, PolicyBuilderMergePolicyList<Id, Rest>>
        : H
      : Record<never, never>;

/**
 * Config object shape derived from a keys map (optional per key, schema types).
 *
 * @internal
 */
export type PolicyBuilderConfigOfKeys<
  Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
> = {
  readonly [K in keyof Keys]?: Keys[K] extends PolicyBuilderKeySpec<infer S, any>
    ? Schema.Schema.Type<S>
    : never;
};

/** Schema input type of one key spec. @internal */
export type PolicyBuilderInputOf<S> =
  S extends PolicyBuilderKeySpec<infer Sch, any>
    ? Schema.Schema.Type<Sch>
    : never;

/** Runtime type of one key spec. @internal */
export type PolicyBuilderRuntimeOf<S> =
  S extends PolicyBuilderKeySpec<any, infer R> ? R : never;

/**
 * Tagged fragment sum — `_tag` is the knob name. Product bags stay untagged.
 * Built via literals / `fromConfig`; Layer methods are camelCase, not data.
 *
 * @internal
 */
export type PolicyBuilderFragmentOfKeys<
  Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
> = {
  [K in keyof Keys & string]: {
    readonly _tag: K;
    readonly value: PolicyBuilderInputOf<Keys[K]>;
  };
}[keyof Keys & string];

/**
 * Product config stamped from a fragment list (last write wins per `_tag`).
 *
 * @internal
 */
export type PolicyBuilderConfigFromFragments<
  Fs extends ReadonlyArray<{
    readonly _tag: string;
    readonly value: unknown;
  }>,
> = Fs extends readonly []
  ? Record<never, never>
  : Fs extends readonly [
      infer H extends { readonly _tag: string; readonly value: unknown },
      ...infer Rest,
    ]
    ? Rest extends ReadonlyArray<{
        readonly _tag: string;
        readonly value: unknown;
      }>
      ? PolicyBuilderMergeConfigs<
          { readonly [P in H["_tag"]]: H["value"] },
          PolicyBuilderConfigFromFragments<Rest>
        >
      : { readonly [P in H["_tag"]]: H["value"] }
    : Record<never, never>;

/** Flat PascalCase Context.References on a Def (one per key). @internal */
export type PolicyBuilderRefsOfKeys<
  Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
> = {
  readonly [K in keyof Keys & string]: Context.Reference<
    PolicyBuilderRuntimeOf<Keys[K]>
  >;
};

/**
 * camelCase Layer factories derived from PascalCase key strings
 * (`"Sticky"` → `sticky(value)`).
 *
 * @internal
 */
export type PolicyBuilderMethodsOfKeys<
  Id extends string,
  Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
> = {
  readonly [K in keyof Keys & string as Uncapitalize<K>]: <
    const V extends PolicyBuilderInputOf<Keys[K]>,
  >(
    value: V,
  ) => PolicyBuilderPolicy<Id, { readonly [P in K]: V }>;
};

/**
 * Fragment matchers / bag converters on the Def (camelCase methods).
 *
 * @internal
 */
export type PolicyBuilderMatchersOfKeys<
  Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
> = {
  readonly isFragment: <Tag extends keyof Keys & string>(
    tag: Tag,
  ) => (
    u: unknown,
  ) => u is Extract<PolicyBuilderFragmentOfKeys<Keys>, { readonly _tag: Tag }>;
  readonly matchFragment: {
    <
      Cases extends {
        readonly [Tag in keyof Keys & string]: (
          fragment: Extract<
            PolicyBuilderFragmentOfKeys<Keys>,
            { readonly _tag: Tag }
          >,
        ) => any;
      },
    >(
      cases: Cases,
    ): (
      value: PolicyBuilderFragmentOfKeys<Keys>,
    ) => ReturnType<Cases[keyof Keys & string]>;
    <
      Cases extends {
        readonly [Tag in keyof Keys & string]: (
          fragment: Extract<
            PolicyBuilderFragmentOfKeys<Keys>,
            { readonly _tag: Tag }
          >,
        ) => any;
      },
    >(
      value: PolicyBuilderFragmentOfKeys<Keys>,
      cases: Cases,
    ): ReturnType<Cases[keyof Keys & string]>;
  };
  readonly fromConfig: (
    config: PolicyBuilderConfigOfKeys<Keys>,
  ) => ReadonlyArray<PolicyBuilderFragmentOfKeys<Keys>>;
  readonly toConfig: <
    const Fs extends ReadonlyArray<PolicyBuilderFragmentOfKeys<Keys>>,
  >(
    fragments: Fs,
  ) => PolicyBuilderConfigFromFragments<Fs>;
};

const buildKeySpec = <S extends Schema.Top, Runtime>(options: {
  readonly familyId: string;
  readonly name: string;
  readonly schema: S;
  readonly defaultValue: () => Runtime;
  readonly toRuntime?: (input: Schema.Schema.Type<S>) => Runtime;
}): PolicyBuilderKeySpec<S, Runtime> => {
  const reference = ContextMod.Reference<Runtime>(
    `${options.familyId}/${options.name}`,
    { defaultValue: options.defaultValue },
  );
  const encode =
    options.toRuntime !== undefined
      ? options.toRuntime
      : (input: Schema.Schema.Type<S>) => input as Runtime;
  return { schema: options.schema, reference, encode };
};

type SyncDecoder = Parameters<typeof Schema.decodeUnknownSync>[0];

const decodeInput = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Schema.Schema.Type<S> =>
  Schema.decodeUnknownSync(schema as unknown as SyncDecoder)(
    input,
  ) as Schema.Schema.Type<S>;

const layerForKey = <S extends Schema.Top, Runtime>(
  spec: PolicyBuilderKeySpec<S, Runtime>,
  input: unknown,
): {
  readonly layer: Layer.Layer<never>;
  readonly decoded: Schema.Schema.Type<S>;
} => {
  const decoded = decodeInput(spec.schema, input);
  return {
    decoded,
    layer: Layer.succeed(spec.reference, spec.encode(decoded)),
  };
};

/**
 * Constructable family methods — intersected with flat key References.
 *
 * @internal
 */
export interface PolicyBuilderDefMethods<
  Id extends string,
  Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
> extends PolicyBuilderMatchersOfKeys<Keys> {
  readonly [DefTypeId]: typeof DefTypeId;
  readonly id: Id;
  readonly keys: Keys;
  new (_: never): Record<never, never>;
  /**
   * Widen with a Schema-backed key (HttpApi.`add` analogue).
   *
   * Adds a PascalCase key string / Reference, plus a camelCase Layer method
   * (`Uncapitalize` — `"StreamGap"` → `streamGap(value)`).
   *
   * - `defaultValue` — **same form as** `Context.Reference(id, { defaultValue })`.
   * - `toRuntime` — optional when Layer runtime ≠ schema decoded type.
   */
  key: <
    const K extends string,
    S extends Schema.Top,
    Runtime = Schema.Schema.Type<S>,
  >(
    name: K,
    schema: S,
    options: {
      readonly defaultValue: () => Runtime;
      readonly toRuntime?: (input: Schema.Schema.Type<S>) => Runtime;
    },
  ) => PolicyBuilderDef<
    Id,
    Keys & { readonly [P in K]: PolicyBuilderKeySpec<S, Runtime> }
  >;
  make: {
    <const C extends PolicyBuilderConfigOfKeys<Keys>>(
      config: C,
    ): PolicyBuilderPolicy<Id, C>;
    <const Fs extends ReadonlyArray<PolicyBuilderFragmentOfKeys<Keys>>>(
      fragments: Fs,
    ): PolicyBuilderPolicy<Id, PolicyBuilderConfigFromFragments<Fs>>;
  };
  succeed: <
    const K extends keyof Keys & string,
    const V extends PolicyBuilderInputOf<Keys[K]>,
  >(
    fragment: { readonly _tag: K; readonly value: V },
  ) => PolicyBuilderPolicy<Id, { readonly [P in K]: V }>;
  layer: {
    <
      const That extends PolicyBuilderPolicy<
        Id,
        PolicyBuilderConfigOfKeys<Keys>
      >,
    >(
      that: That,
    ): <
      const Self extends PolicyBuilderPolicy<
        Id,
        PolicyBuilderConfigOfKeys<Keys>
      >,
    >(
      self: Self,
    ) => PolicyBuilderPolicy<
      Id,
      PolicyBuilderMergeConfigs<
        PolicyBuilderConfigOf<Self>,
        PolicyBuilderConfigOf<That>
      >
    >;
    <
      const Self extends PolicyBuilderPolicy<
        Id,
        PolicyBuilderConfigOfKeys<Keys>
      >,
      const That extends PolicyBuilderPolicy<
        Id,
        PolicyBuilderConfigOfKeys<Keys>
      >,
      const Rest extends ReadonlyArray<
        PolicyBuilderPolicy<Id, PolicyBuilderConfigOfKeys<Keys>>
      >,
    >(
      self: Self,
      that: That,
      ...rest: Rest
    ): PolicyBuilderPolicy<
      Id,
      PolicyBuilderMergePolicyList<Id, readonly [Self, That, ...Rest]>
    >;
  };
  provide: (
    ...policies: ReadonlyArray<Layer.Layer<never>>
  ) => <A, E, R>(self: Layer.Layer<A, E, R>) => Layer.Layer<A, E, R>;
  is: (
    u: unknown,
  ) => u is PolicyBuilderPolicy<Id, PolicyBuilderConfigOfKeys<Keys>>;
  config: <C extends PolicyBuilderConfigOfKeys<Keys>>(
    self: PolicyBuilderPolicy<Id, C>,
  ) => C;
  pipe: <A>(
    this: A,
    ...args: Array<(a: any) => any>
  ) => unknown;
}

/**
 * Constructable family — toolkit + PascalCase References + camelCase Layer methods.
 *
 * @internal
 */
export type PolicyBuilderDef<
  Id extends string,
  Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
> = PolicyBuilderDefMethods<Id, Keys> &
  PolicyBuilderRefsOfKeys<Keys> &
  PolicyBuilderMethodsOfKeys<Id, Keys>;

type DefData = {
  readonly id: string;
  readonly keys: Record<string, PolicyBuilderKeySpec<any, any>>;
};

/** Brand an underlying Layer with family id + frozen config. @internal */
export const brandPolicy = <Id extends string, const C extends object>(
  id: Id,
  underlying: Layer.Layer<never>,
  cfg: C,
): PolicyBuilderPolicy<Id, C> =>
  Object.assign(Object.create(Object.getPrototypeOf(underlying)), underlying, {
    [BrandKey]: id,
    [ConfigKey]: Object.freeze({ ...cfg }),
  }) as PolicyBuilderPolicy<Id, C>;

/** PascalCase key string → camelCase method name. */
const toMethodName = (keyName: string): string =>
  keyName.length === 0
    ? keyName
    : `${keyName.charAt(0).toLowerCase()}${keyName.slice(1)}`;

const refsOf = (
  keys: Record<string, PolicyBuilderKeySpec<any, any>>,
): Record<string, Context.Reference<unknown>> => {
  const out: Record<string, Context.Reference<unknown>> = {};
  for (const keyName of Object.keys(keys)) {
    out[keyName] = keys[keyName]!.reference;
  }
  return out;
};

const methodsOf = (
  familyId: string,
  keys: Record<string, PolicyBuilderKeySpec<any, any>>,
): Record<string, (value: unknown) => PolicyBuilderPolicy<string, object>> => {
  const out: Record<
    string,
    (value: unknown) => PolicyBuilderPolicy<string, object>
  > = {};
  for (const keyName of Object.keys(keys)) {
    const spec = keys[keyName]!;
    out[toMethodName(keyName)] = (value: unknown) => {
      const { layer, decoded } = layerForKey(spec, value);
      return brandPolicy(familyId, layer, { [keyName]: decoded });
    };
  }
  return out;
};

const matchersOf = (
  keys: Record<string, PolicyBuilderKeySpec<any, any>>,
): PolicyBuilderMatchersOfKeys<any> => {
  const isFragment =
    (tag: string) =>
    (u: unknown): boolean =>
      typeof u === "object" &&
      u !== null &&
      (u as { readonly _tag?: unknown })._tag === tag;
  const matchFragment = dual(
    2,
    (
      value: { readonly _tag: string },
      cases: Record<string, (fragment: unknown) => unknown>,
    ): unknown => cases[value._tag]!(value),
  );
  const fromConfig = (
    config: Record<string, unknown>,
  ): ReadonlyArray<{ readonly _tag: string; readonly value: unknown }> => {
    const out: Array<{ readonly _tag: string; readonly value: unknown }> = [];
    for (const keyName of Object.keys(keys)) {
      if (!Object.prototype.hasOwnProperty.call(config, keyName)) continue;
      const value = config[keyName];
      if (value === undefined) continue;
      out.push({ _tag: keyName, value });
    }
    return out;
  };
  const toConfig = (
    fragments: ReadonlyArray<{
      readonly _tag: string;
      readonly value: unknown;
    }>,
  ): Record<string, unknown> =>
    Object.fromEntries(fragments.map((f) => [f._tag, f.value] as const));
  return {
    isFragment,
    matchFragment,
    fromConfig,
    toConfig,
  } as PolicyBuilderMatchersOfKeys<any>;
};

const defProto = {
  pipe() {
    // Effect Pipeable protocol — `arguments` required by `pipeArguments`.
    // eslint-disable-next-line prefer-rest-params -- pipeArguments(this, arguments)
    return pipeArguments(this, arguments);
  },
  key(
    this: DefData,
    name: string,
    schema: Schema.Top,
    options: {
      readonly defaultValue: () => unknown;
      readonly toRuntime?: (input: unknown) => unknown;
    },
  ) {
    const spec = buildKeySpec({
      familyId: this.id,
      name,
      schema,
      defaultValue: options.defaultValue,
      toRuntime: options.toRuntime,
    });
    return makeProto({
      id: this.id,
      keys: { ...this.keys, [name]: spec },
    });
  },
  make(
    this: DefData,
    input:
      | Record<string, unknown>
      | ReadonlyArray<{ readonly _tag: string; readonly value: unknown }>,
  ) {
    const config: Record<string, unknown> = Array.isArray(input)
      ? Object.fromEntries(input.map((f) => [f._tag, f.value] as const))
      : input;
    const parts: Array<Layer.Layer<never>> = [];
    const decodedConfig: Record<string, unknown> = {};
    for (const keyName of Object.keys(this.keys)) {
      if (!Object.prototype.hasOwnProperty.call(config, keyName)) continue;
      const value = config[keyName];
      if (value === undefined) continue;
      const spec = this.keys[keyName]!;
      const { layer, decoded } = layerForKey(spec, value);
      parts.push(layer);
      decodedConfig[keyName] = decoded;
    }
    return brandPolicy(this.id, mergeLayers(parts), decodedConfig);
  },
  succeed(
    this: DefData,
    fragment: { readonly _tag: string; readonly value: unknown },
  ) {
    const keyName = fragment._tag;
    const spec = this.keys[keyName]!;
    const { layer, decoded } = layerForKey(spec, fragment.value);
    return brandPolicy(this.id, layer, { [keyName]: decoded });
  },
  layer: dual(
    (args) => args.length >= 2,
    (
      self: PolicyBuilderPolicy<string, object>,
      that: PolicyBuilderPolicy<string, object>,
      ...rest: ReadonlyArray<PolicyBuilderPolicy<string, object>>
    ): PolicyBuilderPolicy<string, object> => {
      const id = self[BrandKey];
      return combine(id, [self, that, ...rest]);
    },
  ),
  provide(
    this: DefData,
    ...policies: ReadonlyArray<Layer.Layer<never>>
  ) {
    return <A, E, R>(self: Layer.Layer<A, E, R>): Layer.Layer<A, E, R> => {
      if (policies.length === 0) return self;
      return self.pipe(Layer.provide(mergeLayers(policies)));
    };
  },
  is(this: DefData, u: unknown) {
    return (
      hasProperty(u, BrandKey) &&
      (u as { readonly [BrandKey]: unknown })[BrandKey] === this.id
    );
  },
  config(this: DefData, self: PolicyBuilderPolicy<string, object>) {
    return self[ConfigKey];
  },
};

/** Merge Layers + configs (last write wins). @internal */
export const combine = <Id extends string>(
  id: Id,
  policies: ReadonlyArray<PolicyBuilderPolicy<Id, object>>,
): PolicyBuilderPolicy<Id, object> => {
  let cfg: object = {};
  for (const p of policies) {
    cfg = { ...cfg, ...p[ConfigKey] };
  }
  if (policies.length === 0) {
    return brandPolicy(id, Layer.empty, cfg);
  }
  if (policies.length === 1) {
    return brandPolicy(id, policies[0]!, cfg);
  }
  return brandPolicy(
    id,
    Layer.mergeAll(policies[0]!, policies[1]!, ...policies.slice(2)),
    cfg,
  );
};

/** Merge Layers only (for provide). @internal */
export const mergeLayers = (
  policies: ReadonlyArray<Layer.Layer<never>>,
): Layer.Layer<never> => {
  if (policies.length === 0) return Layer.empty;
  if (policies.length === 1) return policies[0]!;
  return Layer.mergeAll(policies[0]!, policies[1]!, ...policies.slice(2));
};

/**
 * Constructor-shaped family so `class X extends PolicyBuilder.make(…).key(…)` works.
 *
 * @internal
 */
export const makeProto = (options: DefData): PolicyBuilderDef<any, any> => {
  function PolicyDef(_: never) {}
  Object.setPrototypeOf(PolicyDef, defProto);
  const matchers = matchersOf(options.keys);
  return Object.assign(
    PolicyDef,
    {
      [DefTypeId]: DefTypeId,
      id: options.id,
      keys: options.keys,
      ...matchers,
    },
    refsOf(options.keys),
    methodsOf(options.id, options.keys),
  ) as unknown as PolicyBuilderDef<any, any>;
};

/**
 * Empty family constructable — HttpApi.`make(id)` analogue.
 *
 * @internal
 */
export const make = <const Id extends string>(
  id: Id,
): PolicyBuilderDef<Id, Record<never, never>> =>
  // SAFE: makeProto assembles the Def surface (id, keys, add/matchers) field-by-field below;
  // TS cannot relate the runtime prototype build to the branded Def type. No runtime value to validate.
  makeProto({ id, keys: {} }) as unknown as PolicyBuilderDef<
    Id,
    Record<never, never>
  >;
