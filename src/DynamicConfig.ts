/**
 * Hot-swappable config on top of Effect `Config`.
 *
 * @remarks
 * Define config the normal way with `Config.*`; wrap fields that may change at
 * runtime in {@link swappable}. {@link make} returns a plain **bag** of
 * {@link ConfigField} wrappers — not a service tag, so a field can be named
 * anything (even `key`) with no collisions.
 *
 * Reads keep the **native `Config` interface**: a `ConfigField` is yieldable and
 * delegates to its underlying `Config`, so `yield* cfg.apiKey` reads through the
 * ambient `ConfigProvider` exactly like any `Config` (`R = never`). The config
 * owns no values — only *where to find them* (env keys). Control lives on the
 * swappable field — `field.set(v)` / `field.reset` / `field.changes`; the
 * string-keyed path for remote/RPC swaps is {@link setByKey}. {@link all} is the
 * combined, yieldable-as-a-whole form (like `Config.all`).
 *
 * A swap writes a per-key override into the store behind {@link layer} (a
 * mutable `ConfigProvider` over a `SubscriptionRef`, with env fallback). Because
 * it rides the ambient provider, every reader of that key — wrapper or raw
 * `Config` — sees the new value on its next read. The store is scoped to the
 * layer, so state is isolated per provision.
 *
 * @module DynamicConfig
 */

import {
  Config,
  ConfigProvider,
  Context,
  Data,
  Effect,
  Effectable,
  Layer,
  Stream,
  SubscriptionRef,
} from "effect";

/**
 * A string-keyed swap targeted a key that wasn't declared swappable in this
 * runtime's allowlist.
 *
 * @public
 */
export class ConfigKeyNotSwappable extends Data.TaggedError(
  "ConfigKeyNotSwappable",
)<{
  readonly key: string;
}> {}

// ============================================================================
// ConfigField wrapper (read-side output)
// ============================================================================

const ConfigFieldTypeId: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/DynamicConfig/ConfigField",
);

interface ConfigFieldMeta {
  readonly envKeys: ReadonlyArray<string>;
}

/**
 * A yieldable config field. `yield* field` reads its underlying `Config`
 * through the ambient provider. Read-only on its own; {@link SwappableField}
 * adds the control methods — so swappability is a structural distinction, not a
 * stored marker flag.
 *
 * @public
 */
export interface ConfigField<A>
  extends Effect.Effect<A, Config.ConfigError> {
  readonly [ConfigFieldTypeId]: ConfigFieldMeta;
  readonly config: Config.Config<A>;
}

/**
 * A hot-swappable field: yieldable for reads, with control methods on the field
 * itself (`yield* field` reads; `field.set(v)` / `field.reset` / `field.changes`
 * control).
 *
 * @public
 */
export interface SwappableField<A> extends ConfigField<A> {
  /** Swap the value (raw/encoded form); validated through the field's Config. */
  readonly set: (
    value: string,
  ) => Effect.Effect<void, Config.ConfigError, DynamicConfigStore>;
  /** Drop the override; revert to env/default. */
  readonly reset: Effect.Effect<void, never, DynamicConfigStore>;
  /** Stream of this field's changed env keys on swap/reset. */
  readonly changes: Stream.Stream<
    ReadonlyArray<string>,
    never,
    DynamicConfigStore
  >;
}

/** A read-only field — a {@link ConfigField} with no control methods. */
export type FixedField<A> = ConfigField<A>;

// Yieldable prototype: a field reads by delegating to its underlying Config
// against the ambient provider — exactly how a plain `Config` reads.
const ConfigFieldProto = Effectable.Prototype<ConfigField<unknown>>({
  label: "DynamicConfigField",
  evaluate(fiber) {
    return this.config.parse(fiber.getRef(ConfigProvider.ConfigProvider));
  },
});

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// Build a custom Effect-yieldable. `Object.create(proto)` attaches `proto`'s
// `Effectable.Prototype` (yieldability) at runtime, which TypeScript can't model
// — so this is the single, isolated place the unavoidable `any` from
// `Object.create` lives. It returns a MUTABLE view of `Self`, so callers assign
// every member with full type checking, and the result is assignable back to the
// readonly `Self` with no cast.
const makeEffectable = <Self>(proto: object): Mutable<Self> =>
  Object.create(proto);

const makeFixedField = <A>(
  config: Config.Config<A>,
  envKeys: ReadonlyArray<string>,
): FixedField<A> => {
  const field = makeEffectable<FixedField<A>>(ConfigFieldProto);
  field.config = config;
  field[ConfigFieldTypeId] = { envKeys };
  return field;
};

const makeSwappableField = <A>(
  config: Config.Config<A>,
  envKeys: ReadonlyArray<string>,
): SwappableField<A> => {
  const field = makeEffectable<SwappableField<A>>(ConfigFieldProto);
  field.config = config;
  field[ConfigFieldTypeId] = { envKeys };
  field.set = (value) => setFieldImpl(field, value);
  field.reset = resetFieldImpl(field);
  field.changes = changesFieldImpl(field);
  return field;
};

/** Type predicate for a {@link ConfigField}. @public */
export const isConfigField = (
  value: unknown,
): value is ConfigField<unknown> =>
  typeof value === "object" && value !== null && ConfigFieldTypeId in value;

// ============================================================================
// Field map types
// ============================================================================

// A field input is a plain Config (becomes a FixedField) or an already-built
// ConfigField — e.g. from `swappable(...)` or another bag (via `extend`).
type FieldsInput = {
  readonly [key: string]:
    | Config.Config<unknown>
    | ConfigField<unknown>;
};

// Order matters: SwappableField (has the control methods) is checked before the
// bare ConfigField it structurally extends.
type FieldOf<S> = S extends SwappableField<infer A>
  ? SwappableField<A>
  : S extends ConfigField<infer A>
    ? FixedField<A>
    : S extends Config.Config<infer A>
      ? FixedField<A>
      : never;

/** A bag of {@link ConfigField}s produced by {@link make} / {@link extend}. */
export type ConfigBag<F extends FieldsInput> = {
  readonly [K in keyof F]: FieldOf<F[K]>;
};

// ============================================================================
// Override store (the one tag) + dynamic provider
// ============================================================================

/**
 * Shared override store. Provided by {@link layer}; written by a swappable
 * field's `.set` / `.reset` (and {@link setByKey}), and read (as a
 * `ConfigProvider`) by every `Config`.
 *
 * @public
 */
export class DynamicConfigStore extends Context.Service<
  DynamicConfigStore,
  {
    readonly setRaw: (
      entries: ReadonlyArray<readonly [string, string]>,
    ) => Effect.Effect<void>;
    readonly unsetRaw: (keys: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly changedKeys: Stream.Stream<ReadonlyArray<string>>;
    /** Per-runtime snapshot: env key → its Config, for declared-swappable keys. */
    readonly allowed: ReadonlyMap<string, Config.Config<unknown>>;
  }
>()("@nikscripts/effect-pm/DynamicConfig/DynamicConfigStore") {}

// Module registry: every swappable field's env key → its Config, recorded as
// configs are defined. `layer` snapshots this per runtime.
const swappableRegistry = new Map<string, Config.Config<unknown>>();

const constProvider = (raw: string) =>
  ConfigProvider.make(() => Effect.succeed(ConfigProvider.makeValue(raw)));

const recordKeys = (config: Config.Config<unknown>): ReadonlyArray<string> => {
  const keys: Array<string> = [];
  const probe = ConfigProvider.make((path) => {
    keys.push(path.join("_"));
    return Effect.succeed(ConfigProvider.makeValue("probe"));
  });
  Effect.runSync(Effect.ignore(config.parse(probe)));
  return keys;
};

// ============================================================================
// swappable / make / extend
// ============================================================================

/**
 * Make a single hot-swappable field — the **single-field** constructor. Returns
 * a usable {@link SwappableField} on its own (yieldable for reads, with `.set` /
 * `.reset` / `.changes` on the field); no {@link make} needed. Its env key joins
 * this runtime's allowlist.
 *
 * @example
 * ```ts
 * const apiKey = DynamicConfig.swappable(Config.redacted("API_KEY"));
 * const k = yield* apiKey;        // read
 * yield* apiKey.set("new");       // swap (control is on the field)
 * ```
 *
 * @public
 */
export const swappable = <A>(config: Config.Config<A>): SwappableField<A> => {
  const envKeys = recordKeys(config);
  // "any time you add swappable, its key joins the allowlist registry"
  for (const key of envKeys) {
    swappableRegistry.set(key, config);
  }
  return makeSwappableField(config, envKeys);
};

const makeField = (spec: Config.Config<unknown> | ConfigField<unknown>) =>
  // already a field (swappable, or another bag's field) → use as-is;
  // a plain Config → wrap as a read-only FixedField.
  isConfigField(spec) ? spec : makeFixedField(spec, recordKeys(spec));

const AllTypeId: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/DynamicConfig/All",
);

type FieldRecord = Record<string, ConfigField<unknown>>;

type BagShape<Bag extends FieldRecord> = {
  readonly [K in keyof Bag]: Bag[K] extends ConfigField<infer A>
    ? A
    : never;
};

/**
 * The combined, yieldable-as-a-whole form of a config (like `Config.all`):
 * `yield* allCfg` resolves every field into one object. No per-field accessors —
 * {@link make} has those; pass either into the other to convert.
 *
 * @public
 */
export interface AllConfig<Bag extends FieldRecord>
  extends Effect.Effect<BagShape<Bag>, Config.ConfigError> {
  readonly [AllTypeId]: Bag;
}

const isAllConfig = (value: unknown): value is AllConfig<FieldRecord> =>
  typeof value === "object" && value !== null && AllTypeId in value;

const AllProto = Effectable.Prototype<AllConfig<FieldRecord>>({
  label: "DynamicConfigAll",
  evaluate(_fiber) {
    return Effect.all(this[AllTypeId]);
  },
});

const toFieldRecord = (
  input: FieldsInput | AllConfig<FieldRecord>,
): FieldRecord => {
  if (isAllConfig(input)) {
    return input[AllTypeId];
  }
  const out: FieldRecord = {};
  for (const [name, spec] of Object.entries(input)) {
    out[name] = makeField(spec);
  }
  return out;
};

/**
 * Group fields into a bag with per-field accessors (`cfg.apiKey.set(...)`). Each
 * value is a plain `Config` (→ read-only field) or an already-built field from
 * {@link swappable} / another bag. Pass an {@link AllConfig} to convert it back.
 *
 * @example
 * ```ts
 * const cfg = DynamicConfig.make({
 *   baseUrl: Config.string("BASE_URL").pipe(Config.withDefault("https://x")),
 *   apiKey: DynamicConfig.swappable(Config.redacted("API_KEY")),
 * });
 * const url = yield* cfg.baseUrl;     // FixedField — read only
 * yield* cfg.apiKey.set("rotated");   // SwappableField — control on the field
 * ```
 *
 * @see {@link all} for the combined, yieldable-as-a-whole form.
 * @see {@link swappable} to mark a field hot-swappable.
 * @public
 */
export function make<const F extends FieldsInput>(fields: F): ConfigBag<F>;
export function make<Bag extends FieldRecord>(all: AllConfig<Bag>): Bag;
export function make(input: FieldsInput | AllConfig<FieldRecord>): FieldRecord {
  return toFieldRecord(input);
}

/**
 * The combined, yieldable form — `yield* DynamicConfig.all({...})` reads every
 * field into one object, like `Config.all`. Accepts a field map or a bag from
 * {@link make}; pass one into the other to convert.
 *
 * Reads all fields at once, so it's all-or-nothing (it fails if any field fails);
 * per-field reads via {@link make} are independent.
 *
 * @example
 * ```ts
 * const cfg = DynamicConfig.make({ apiKey: DynamicConfig.swappable(...) });
 * const whole = yield* DynamicConfig.all(cfg);   // { apiKey } — one read
 * const bag = DynamicConfig.make(DynamicConfig.all(cfg)); // back to accessors
 * ```
 *
 * @see {@link make} for per-field accessors and control.
 * @public
 */
export const all = <const F extends FieldsInput>(
  input: F,
): AllConfig<ConfigBag<F>> => {
  const result = makeEffectable<AllConfig<ConfigBag<F>>>(AllProto);
  // `make(input)` is typed `ConfigBag<F>` — exactly the `[AllTypeId]` slot.
  result[AllTypeId] = make(input);
  return result;
};

/**
 * Extend a config by **cloning** the base's fields and adding more — a pure
 * value op, no dependency. Inherited fields keep their env keys, so swapping a
 * shared key updates every extension that points at it.
 *
 * @example
 * ```ts
 * const base = DynamicConfig.make({ apiKey: DynamicConfig.swappable(...) });
 * const child = DynamicConfig.extend(base, {
 *   batchSize: Config.int("BATCH").pipe(Config.withDefault(100)),
 * });
 * yield* base.apiKey.set("x"); // child.apiKey (same env key) sees it
 * ```
 *
 * @see {@link make} for the base bag.
 * @public
 */
export const extend = <
  Base extends ConfigBag<FieldsInput>,
  const Extra extends FieldsInput,
>(
  base: Base,
  extra: Extra,
): Omit<Base, keyof ConfigBag<Extra>> & ConfigBag<Extra> => ({
  ...base,
  ...make(extra),
});

// ============================================================================
// Control — free functions over a field
// ============================================================================

const metaOf = (field: ConfigField<unknown>) =>
  field[ConfigFieldTypeId];

// Backing impls for the field's `.set` / `.reset` / `.changes` methods.
const setFieldImpl = (
  field: ConfigField<unknown>,
  value: string,
): Effect.Effect<void, Config.ConfigError, DynamicConfigStore> =>
  Effect.gen(function* () {
    const store = yield* DynamicConfigStore;
    // validate the raw value through the field's Config
    yield* field.config.parse(constProvider(value));
    yield* store.setRaw(metaOf(field).envKeys.map((key) => [key, value]));
  });

const resetFieldImpl = (
  field: ConfigField<unknown>,
): Effect.Effect<void, never, DynamicConfigStore> =>
  Effect.flatMap(DynamicConfigStore, (store) =>
    store.unsetRaw(metaOf(field).envKeys),
  );

/**
 * Swap by raw env key — the string-keyed path for remote/RPC handlers that don't
 * hold a field (e.g. an RPC procedure that swaps an allowed key on its runtime).
 * Enforces the per-runtime allowlist — the key must have been declared swappable
 * — and validates the value through that key's `Config`.
 *
 * @example
 * ```ts
 * // inside an RPC procedure on the target runtime:
 * yield* DynamicConfig.setByKey("API_KEY", "rotated");
 * // → ConfigKeyNotSwappable if "API_KEY" was never made swappable here
 * ```
 *
 * @see The field method `field.set` for the typed, in-process path.
 * @public
 */
export const setByKey = (
  key: string,
  value: string,
): Effect.Effect<
  void,
  Config.ConfigError | ConfigKeyNotSwappable,
  DynamicConfigStore
> =>
  Effect.gen(function* () {
    const store = yield* DynamicConfigStore;
    const config = store.allowed.get(key);
    if (config === undefined) {
      return yield* new ConfigKeyNotSwappable({ key });
    }
    yield* config.parse(constProvider(value));
    yield* store.setRaw([[key, value]]);
  });

const changesFieldImpl = (
  field: ConfigField<unknown>,
): Stream.Stream<ReadonlyArray<string>, never, DynamicConfigStore> => {
  const keys = new Set(metaOf(field).envKeys);
  return Stream.unwrap(
    Effect.map(DynamicConfigStore, (store) =>
      Stream.map(store.changedKeys, (changed) =>
        changed.filter((key) => keys.has(key)),
      ),
    ),
  );
};

// ============================================================================
// freeze — capability restriction (read-only views); touches no store state
// ============================================================================

const demote = (field: ConfigField<unknown>): FixedField<unknown> =>
  makeFixedField(field.config, field[ConfigFieldTypeId].envKeys);

type FrozenBag<Bag> = {
  readonly [K in keyof Bag]: Bag[K] extends ConfigField<infer A>
    ? FixedField<A>
    : Bag[K];
};

type WithFrozenField<Bag, K extends keyof Bag> = {
  readonly [P in keyof Bag]: P extends K
    ? Bag[P] extends ConfigField<infer A>
      ? FixedField<A>
      : Bag[P]
    : Bag[P];
};

// Rebuild a bag, demoting each field for which `freezeName` returns true. The
// lone remaining cast lives here: a per-key mapped type (`{ [K]: FixedField<…> }`)
// can't be inferred from a runtime loop — it builds a homogeneous record, and no
// combinator (`Record.map`, `Object.fromEntries`) recovers the per-key value
// types. Safe: demoted entries are FixedFields over the same `Config`, the rest
// pass through, so the record matches the caller's mapped return type key-for-key.
const rebuildBag = <Out>(
  bag: Record<string, ConfigField<unknown>>,
  freezeName: (name: string) => boolean,
): Out => {
  const out: Record<string, ConfigField<unknown>> = {};
  for (const [name, field] of Object.entries(bag)) {
    out[name] = freezeName(name) ? demote(field) : field;
  }
  // SAFE: per-key FrozenBag / WithFrozenField can't be inferred from a runtime
  // loop; demote preserves Config identity so the mapped Out shape holds key-for-key.
  return out as Out;
};

/**
 * Read-only view of a config: every field becomes a {@link FixedField}, so
 * `.set` won't compile against it. Touches no store state — the underlying keys
 * stay swappable for any handle that still holds the original. Hand a frozen
 * config to code that should only read.
 *
 * @example
 * ```ts
 * const safe = DynamicConfig.freeze(cfg);
 * yield* safe.apiKey;            // reads the live value
 * // safe.apiKey.set("x")       // compile error — frozen
 * ```
 *
 * @see {@link freezeField} to freeze a single field instead of all of them.
 * @public
 */
export const freeze = <
  Bag extends Record<string, ConfigField<unknown>>,
>(
  bag: Bag,
): FrozenBag<Bag> => rebuildBag<FrozenBag<Bag>>(bag, () => true);

/**
 * Like {@link freeze} but for a single field — that field becomes read-only,
 * the rest stay swappable.
 *
 * @example
 * ```ts
 * const partial = DynamicConfig.freezeField(cfg, "apiKey");
 * // partial.apiKey.set(...)    // compile error — frozen
 * yield* partial.retries.set("5"); // other fields still swappable
 * ```
 *
 * @see {@link freeze} to freeze every field.
 * @public
 */
export const freezeField = <
  Bag extends Record<string, ConfigField<unknown>>,
  K extends keyof Bag,
>(
  bag: Bag,
  key: K,
): WithFrozenField<Bag, K> => {
  const target = String(key);
  return rebuildBag<WithFrozenField<Bag, K>>(bag, (name) => name === target);
};

// ============================================================================
// layer — the store + the dynamic ConfigProvider (env fallback)
// ============================================================================

/**
 * Provides the override store and a `ConfigProvider` that reads it first, then
 * the real environment. Provide once per runtime; every `Config` read then sees
 * swaps, and {@link DynamicConfigStore} is available for field control / {@link setByKey}.
 *
 * Provide at or above any scope that reads or swaps — scoping (`Effect.scoped`)
 * and forked fibers inherit it. Separate runtimes get their own store, so a swap
 * in one is not seen by another (swap each via its own {@link setByKey}).
 *
 * @example
 * ```ts
 * program.pipe(Effect.provide(DynamicConfig.layer));
 * ```
 *
 * @public
 */
export const layer: Layer.Layer<DynamicConfigStore> = Layer.unwrap(
  Effect.gen(function* () {
    const overrides = yield* SubscriptionRef.make(new Map<string, string>());

    const provider = ConfigProvider.make((path) =>
      Effect.map(SubscriptionRef.get(overrides), (map) => {
        const value = map.get(path.join("_"));
        return value === undefined
          ? undefined
          : ConfigProvider.makeValue(value);
      }),
    );

    const store = DynamicConfigStore.of({
      setRaw: (entries) =>
        SubscriptionRef.update(overrides, (map) => {
          const next = new Map(map);
          for (const [key, value] of entries) {
            next.set(key, value);
          }
          return next;
        }),
      unsetRaw: (keys) =>
        SubscriptionRef.update(overrides, (map) => {
          const next = new Map(map);
          for (const key of keys) {
            next.delete(key);
          }
          return next;
        }),
      changedKeys: Stream.map(SubscriptionRef.changes(overrides), (map) =>
        Array.from(map.keys()),
      ),
      // per-runtime snapshot of declared-swappable keys
      allowed: new Map(swappableRegistry),
    });

    return Layer.merge(
      ConfigProvider.layer(
        ConfigProvider.orElse(provider, ConfigProvider.fromEnv()),
      ),
      Layer.succeed(DynamicConfigStore, store),
    );
  }),
);
