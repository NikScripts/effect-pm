/**
 * PolicyBuilder engine — HttpApi-shaped constructable policy families.
 *
 * `PolicyBuilder.make(id).key(...).keyEncoded(...)` returns a constructor so
 * `class X extends … {}` works (same trick as HttpApi / Router).
 *
 * @internal
 */
import type { Context } from "effect";
import { Layer } from "effect";
import { dual } from "effect/Function";
import { pipeArguments } from "effect/Pipeable";
import { hasProperty } from "effect/Predicate";

/** Brand key shared by every policy family (value = family id). */
export const BrandKey = "~hyperlink-ts/PolicyBuilder" as const;

/** Runtime config slot on a branded policy. */
export const ConfigKey = "~hyperlink-ts/PolicyBuilder/Config" as const;

/** TypeId on family constructables. */
export const FamilyTypeId = "~hyperlink-ts/PolicyBuilder/Family" as const;

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
 * Constructable family — `new (_: never) => {}` so `class extends` works.
 *
 * @internal
 */
export interface PolicyBuilderFamily<
  Id extends string,
  Keys extends Record<string, PolicyBuilderKeySpec<any, any>>,
> {
  readonly [FamilyTypeId]: typeof FamilyTypeId;
  readonly id: Id;
  readonly keys: Keys;
  new (_: never): {};
  /**
   * Widen with an identity-encoded key (HttpApi.`add` analogue).
   */
  key: <
    const K extends string,
    Runtime,
  >(
    name: K,
    reference: Context.Reference<Runtime>,
  ) => PolicyBuilderFamily<
    Id,
    Keys & { readonly [P in K]: PolicyBuilderKeySpec<Runtime, Runtime> }
  >;
  /**
   * Widen with a custom-encoded key.
   */
  keyEncoded: <
    const K extends string,
    Input,
    Runtime,
  >(
    name: K,
    reference: Context.Reference<Runtime>,
    encode: (input: Input) => Runtime,
  ) => PolicyBuilderFamily<
    Id,
    Keys & { readonly [P in K]: PolicyBuilderKeySpec<Input, Runtime> }
  >;
  /** Object-form → branded policy Layer (last-write config stamp). */
  make: <const C extends PolicyBuilderConfigOfKeys<Keys>>(
    config: C,
  ) => PolicyBuilderPolicy<Id, C>;
  succeed: <
    const K extends keyof Keys & string,
    const V extends PolicyBuilderInputOf<Keys[K]>,
  >(
    keyName: K,
    value: V,
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
    ...args: [
      ...Array<(a: any) => any>,
      (a: any) => any,
    ]
  ) => unknown;
}

type FamilyData = {
  readonly id: string;
  readonly keys: Record<string, PolicyBuilderKeySpec<any, any>>;
};

const familyProto = {
  pipe() {
    // Effect Pipeable protocol — `arguments` required by `pipeArguments`.
    // eslint-disable-next-line prefer-rest-params -- pipeArguments(this, arguments)
    return pipeArguments(this, arguments);
  },
  key(
    this: FamilyData,
    name: string,
    reference: Context.Reference<unknown>,
  ) {
    return makeProto({
      id: this.id,
      keys: { ...this.keys, [name]: key(reference) },
    });
  },
  keyEncoded(
    this: FamilyData,
    name: string,
    reference: Context.Reference<unknown>,
    encode: (input: unknown) => unknown,
  ) {
    return makeProto({
      id: this.id,
      keys: { ...this.keys, [name]: keyEncoded(reference, encode) },
    });
  },
  make(this: FamilyData, config: Record<string, unknown>) {
    const parts: Array<Layer.Layer<never>> = [];
    for (const keyName of Object.keys(this.keys)) {
      if (!Object.prototype.hasOwnProperty.call(config, keyName)) continue;
      const input = config[keyName];
      if (input === undefined) continue;
      const spec = this.keys[keyName]!;
      parts.push(layerForKey(spec, input));
    }
    return brandPolicy(this.id, mergeLayers(parts), config);
  },
  succeed(this: FamilyData, keyName: string, value: unknown) {
    const spec = this.keys[keyName]!;
    const cfg = { [keyName]: value };
    return brandPolicy(this.id, layerForKey(spec, value), cfg);
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
    this: FamilyData,
    ...policies: ReadonlyArray<Layer.Layer<never>>
  ) {
    return <A, E, R>(self: Layer.Layer<A, E, R>): Layer.Layer<A, E, R> => {
      if (policies.length === 0) return self;
      return self.pipe(Layer.provide(mergeLayers(policies)));
    };
  },
  is(this: FamilyData, u: unknown) {
    return (
      hasProperty(u, BrandKey) &&
      (u as { readonly [BrandKey]: unknown })[BrandKey] === this.id
    );
  },
  config(this: FamilyData, self: PolicyBuilderPolicy<string, object>) {
    return self[ConfigKey];
  },
};

/**
 * Constructor-shaped family so `class X extends PolicyBuilder.make(…).key(…)` works.
 *
 * @internal
 */
export const makeProto = (options: FamilyData): PolicyBuilderFamily<any, any> => {
  function PolicyFamily(_: never) {}
  Object.setPrototypeOf(PolicyFamily, familyProto);
  return Object.assign(PolicyFamily, {
    [FamilyTypeId]: FamilyTypeId,
    id: options.id,
    keys: options.keys,
  }) as unknown as PolicyBuilderFamily<any, any>;
};

/**
 * Empty family constructable — HttpApi.`make(id)` analogue.
 *
 * @internal
 */
export const make = <const Id extends string>(
  id: Id,
): PolicyBuilderFamily<Id, {}> =>
  makeProto({ id, keys: {} }) as PolicyBuilderFamily<Id, {}>;
