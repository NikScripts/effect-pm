/**
 * PolicyBuilder engine — branded Layer+config families with typed make/layer/provide.
 *
 * @internal
 */
import type { Context } from "effect";
import { Layer } from "effect";
import { dual } from "effect/Function";
import { hasProperty } from "effect/Predicate";

/** Brand key shared by every policy family (value = family id). */
export const BrandKey = "~hyperlink-ts/PolicyBuilder" as const;

/** Runtime config slot on a branded policy. */
export const ConfigKey = "~hyperlink-ts/PolicyBuilder/Config" as const;

/**
 * One config key: Context reference + encode (input → runtime).
 *
 * @internal
 */
export interface PolicyBuilderKeySpec<in out Input, in out Runtime = Input> {
  readonly reference: Context.Reference<Runtime>;
  readonly encode: (input: Input) => Runtime;
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
  ? {}
  : Ps extends readonly [PolicyBuilderPolicy<Id, infer H>]
    ? H
    : Ps extends readonly [
        PolicyBuilderPolicy<Id, infer H>,
        ...infer Rest,
      ]
      ? Rest extends ReadonlyArray<PolicyBuilderPolicy<Id, object>>
        ? PolicyBuilderMergeConfigs<H, PolicyBuilderMergePolicyList<Id, Rest>>
        : H
      : {};

/**
 * Config object shape derived from a keys map (optional per key, input types).
 *
 * @internal
 */
export type PolicyBuilderConfigOfKeys<
  Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
> = {
  readonly [K in keyof Keys]?: Keys[K] extends PolicyBuilderKeySpec<
    infer I,
    any
  >
    ? I
    : never;
};

/** Input type of one key spec. @internal */
export type PolicyBuilderInputOf<S> =
  S extends PolicyBuilderKeySpec<infer I, any> ? I : never;

/**
 * Bind a Context reference as a policy key (identity encode).
 *
 * @internal
 */
export const key = <Runtime>(
  reference: Context.Reference<Runtime>,
): PolicyBuilderKeySpec<Runtime, Runtime> => ({
  reference,
  encode: (input) => input,
});

/**
 * Bind a Context reference with a custom input→runtime encode.
 *
 * @internal
 */
export const keyEncoded = <Input, Runtime>(
  reference: Context.Reference<Runtime>,
  encode: (input: Input) => Runtime,
): PolicyBuilderKeySpec<Input, Runtime> => ({ reference, encode });

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

const layerForKey = <Input, Runtime>(
  spec: PolicyBuilderKeySpec<Input, Runtime>,
  input: Input,
): Layer.Layer<never> => Layer.succeed(spec.reference, spec.encode(input));

/**
 * Family API returned by {@link define}.
 *
 * @internal
 */
export interface PolicyBuilderFamily<
  Id extends string,
  Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
> {
  readonly id: Id;
  readonly keys: Keys;
  readonly make: <const C extends PolicyBuilderConfigOfKeys<Keys>>(
    config: C,
  ) => PolicyBuilderPolicy<Id, C>;
  readonly succeed: <
    const K extends keyof Keys & string,
    const V extends PolicyBuilderInputOf<Keys[K]>,
  >(
    keyName: K,
    value: V,
  ) => PolicyBuilderPolicy<Id, { readonly [P in K]: V }>;
  readonly layer: {
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
  readonly provide: (
    ...policies: ReadonlyArray<Layer.Layer<never>>
  ) => <A, E, R>(self: Layer.Layer<A, E, R>) => Layer.Layer<A, E, R>;
  readonly is: (
    u: unknown,
  ) => u is PolicyBuilderPolicy<Id, PolicyBuilderConfigOfKeys<Keys>>;
  readonly config: <C extends PolicyBuilderConfigOfKeys<Keys>>(
    self: PolicyBuilderPolicy<Id, C>,
  ) => C;
}

/**
 * Define a policy family from a stable id + key map.
 *
 * @internal
 */
export const define = <
  const Id extends string,
  const Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
>(options: {
  readonly id: Id;
  readonly keys: Keys;
}): PolicyBuilderFamily<Id, Keys> => {
  type Config = PolicyBuilderConfigOfKeys<Keys>;
  const { id, keys } = options;

  const make = <const C extends Config>(
    config: C,
  ): PolicyBuilderPolicy<Id, C> => {
    const parts: Array<Layer.Layer<never>> = [];
    for (const keyName of Object.keys(keys) as Array<keyof Keys & string>) {
      if (!Object.prototype.hasOwnProperty.call(config, keyName)) continue;
      const input = (config as Record<string, unknown>)[keyName];
      if (input === undefined) continue;
      const spec = keys[keyName]!;
      parts.push(
        layerForKey(
          spec,
          input as PolicyBuilderInputOf<(typeof keys)[typeof keyName]>,
        ),
      );
    }
    return brandPolicy(id, mergeLayers(parts), config);
  };

  const succeed = <
    const K extends keyof Keys & string,
    const V extends PolicyBuilderInputOf<Keys[K]>,
  >(
    keyName: K,
    value: V,
  ): PolicyBuilderPolicy<Id, { readonly [P in K]: V }> => {
    const spec = keys[keyName]!;
    const cfg = { [keyName]: value } as { readonly [P in K]: V };
    return brandPolicy(id, layerForKey(spec, value), cfg);
  };

  const layer = dual(
    (args) => args.length >= 2,
    (
      self: PolicyBuilderPolicy<Id, Config>,
      that: PolicyBuilderPolicy<Id, Config>,
      ...rest: ReadonlyArray<PolicyBuilderPolicy<Id, Config>>
    ): PolicyBuilderPolicy<Id, object> => combine(id, [self, that, ...rest]),
  );

  const provide =
    (...policies: ReadonlyArray<Layer.Layer<never>>) =>
    <A, E, R>(self: Layer.Layer<A, E, R>): Layer.Layer<A, E, R> => {
      if (policies.length === 0) return self;
      return self.pipe(Layer.provide(mergeLayers(policies)));
    };

  const is = (u: unknown): u is PolicyBuilderPolicy<Id, Config> =>
    hasProperty(u, BrandKey) &&
    (u as { readonly [BrandKey]: unknown })[BrandKey] === id;

  const config = <C extends Config>(self: PolicyBuilderPolicy<Id, C>): C =>
    self[ConfigKey];

  return { id, keys, make, succeed, layer, provide, is, config };
};
