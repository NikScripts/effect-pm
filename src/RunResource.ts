/**
 * RunResource — concurrency gate for effects.
 *
 * Wraps any effect with bounded concurrency via `Semaphore`. Unlike
 * {@link QueueResource}, there are no queues, priorities, or background workers —
 * the gate is applied inline at the call site. Each `run` acquires a permit,
 * executes the effect, and releases the permit on completion.
 *
 * ## Entry points
 *
 * | Function | Purpose |
 * |----------|---------|
 * | `RunResource.make` | Scoped handle with `.run` only (no Subscribables exposed) |
 * | `RunResource.layer` | Builds a `Layer` from tag + config (observable handle) |
 * | `RunResource.serve` / `serveRemote` | RPC server layers (same config as {@link layer}) |
 * | `RunResource.Service` | Tag + baked-in `.layer` + `.configure` |
 * | `RunResource.Tag` | Identity tag + wire schemas — pair with {@link layer} |
 * | `RunResource.configure` | Config patch layer for a tag (Tag path) |
 * | `RunResource.store` | Register built-in run facts + state history on an app {@link Store.Service} |
 * | `RunResource.makeRunner` | Generic runner (wraps arbitrary effects) |
 *
 * ## Store provision
 *
 * {@link layer}, {@link serve}, and {@link Service.layer} merge {@link Store.layerDefaultMemory} — the store
 * bridge is always in context (like `Clock`), so engines emit unconditionally. Override with a real
 * {@link Store.Service} via `Layer.provideMerge(AppStore.layerMemory)` (or SQLite) on the composed app layer.
 * {@link make} requires the same bridge — provide {@link Store.layerDefaultMemory} or your store layer on the
 * effect (see tests).
 *
 * ## Remote usage
 *
 * Declare wire schemas on the tag, then serve or connect like {@link QueueResource} / {@link Process}:
 *
 * ```ts
 * class FetchGate extends RunResource.Tag<FetchGate>()("@app/FetchGate", {
 *   payload: SymbolSchema,
 *   success: PriceSchema,
 *   error: FetchErrSchema,
 * }) {}
 *
 * // unit gate — omit payload; bare effect on Service / layer
 * class Tick extends RunResource.Service<Tick>()("@app/Tick", {
 *   effect: Effect.sleep("1 second"),
 * }) {}
 * ```
 *
 * ## Observable handles (Tag / Service / layer)
 *
 * `yield* Tag` returns a toolkit service with `.run` plus {@link Subscribable} views
 * (`status`, `waiting`, `inFlight`, `completed`, …). Read with `yield* handle.waiting.get`
 * or subscribe via `handle.waiting.changes`.
 *
 * Tag and Service also expose a static `.run` shortcut that requires the tag in `R`.
 *
 * @module RunResource
 */

import { Context, Effect, Layer, Schema, Scope } from "effect";
import * as Resource from "./Resource";
import type {
  HandlerContextOf,
  ImplOf,
  Local,
  ResourceTag,
} from "./Resource";
import { facetStoreRegistration } from "./internal/store/facetStore";
import {
  makeRunResourceStoreAnalyticsContract,
  type RunResourceStoreAnalyticsContract,
} from "./internal/store/runResourceStoreSpec";
import type { StoreShapes } from "./internal/store/contractDef";
import type { StoreScopeTag } from "./internal/store/registration";
import {
  configureLayer,
  configureWrapEffectField,
  foldConfiguredSpec,
  type ConfigPatch,
} from "./ResourceConfigure";
import * as internal from "./internal/runResource";
import { errorSym, successSym } from "./internal/runTagSchemas";
import * as Store from "./Store";
import {
  materializeRunSpec,
  runSpecHasPayload,
  type RunInstanceSpec,
} from "./internal/runResourceSchema";

// ============================================================================
// Public wire schemas + spec
// ============================================================================

/**
 * Live gate counters on the wire — element of the reactive `status` ref.
 *
 * @public
 */
export { runGateStatus, runSpec } from "./internal/runResourceSchema";

/**
 * This contract's canonical **kind** — stamped on every run-gate tag.
 *
 * @public
 */
export const kind = "@nikscripts/effect-pm/RunResource";

/** @public */
export type { RunInstanceSpec };

// ============================================================================
// Public Types
// ============================================================================

/**
 * Live counters for an observable run gate.
 *
 * @public
 */
export type RunGateStatus = internal.RunGateStatus;

/**
 * Minimal handle from {@link RunResource.make} — `.run` only.
 *
 * @public
 */
export type RunGateHandle<T, A, E> = internal.RunGateHandle<T, A, E>;

/**
 * Observable handle from {@link RunResource.make} with observation disabled, or the local-only
 * engine handle. Prefer the toolkit service from {@link Tag} / {@link Service} for RPC.
 *
 * @public
 */
export type RunResourceHandle<T, A, E> = internal.RunResourceHandle<T, A, E>;

/**
 * Static `.run` shortcut on {@link Tag} / {@link Service} — adds the tag to `R`.
 *
 * Unit gates (no payload slot) resolve to an {@link Effect.Effect}; parameterized gates resolve
 * to `(input) => Effect`.
 *
 * @public
 */
export type RunResourceStaticRun<
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top,
  Self,
> = [I] extends [undefined]
  ? Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>, Self>
  : (input: Schema.Schema.Type<I>) => Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>, Self>;

/**
 * Service factory result — tag surface plus baked-in layer and configure helpers.
 *
 * @public
 */
export interface RunResourceServiceDefinition<
  Self,
  Name extends string,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
> extends RunResourceTagDefinition<Self, I, A, E> {
  readonly defaultSpec: RunResourceServiceConfig<I, A, E, R> & { readonly name: Name };
  readonly layer: Layer.Layer<Self | Store.Storage, never, R>;
  readonly configure: (
    patch: ConfigPatch<
      RunResourceLayerConfig<
        RunPayloadDecoded<I>,
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>,
        R
      >
    >,
  ) => Layer.Layer<never>;
  readonly wrapGate: (
    fn: (
      previous: RunResourceLayerConfig<
        RunPayloadDecoded<I>,
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>,
        R
      >["effect"],
    ) => RunResourceLayerConfig<
      RunPayloadDecoded<I>,
      Schema.Schema.Type<A>,
      Schema.Schema.Type<E>,
      R
    >["effect"],
  ) => Layer.Layer<never>;
}

/** Tag + static `.run` shortcut. @internal */
type RunTagWithStaticRun<
  Self,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> = ResourceTag<Self, RunInstanceSpec<I, A, E>> & {
  readonly run: RunResourceStaticRun<I, A, E, Self>;
};

/**
 * Tag factory result — Resource tag + wire schemas + static {@link RunResourceStaticRun}.
 *
 * @public
 */
export type RunResourceTagDefinition<
  Self,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> = RunTagWithStaticRun<Self, I, A, E>;

/**
 * Wire schemas shared by {@link Tag} and {@link Service}.
 *
 * @public
 */
export interface RunResourceWireSchemas<
  I extends Schema.Top | undefined = undefined,
  A extends Schema.Top = typeof Schema.Void,
  E extends Schema.Top = typeof Schema.Never,
> {
  /** Wire input schema; omit for unit gates (no payload slot on the contract). */
  readonly payload?: I extends Schema.Top ? I : never;
  /** Wire success schema; defaults to {@link Schema.Void}. Omitted slots are not store-stamped. */
  readonly success?: A;
  /** Wire error schema; defaults to {@link Schema.Never}. Omitted slots are not store-stamped. */
  readonly error?: E;
}

/**
 * Schema-only options for {@link Tag} — pair with {@link layer} for the gated effect.
 *
 * @public
 */
export interface RunResourceTagSchemas<
  I extends Schema.Top | undefined = undefined,
  A extends Schema.Top = Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> extends RunResourceWireSchemas<I, A, E> {
  readonly description?: string;
}

/** Decoded payload type for layer / service config. @internal */
type RunPayloadDecoded<I extends Schema.Top | undefined> = [I] extends [undefined]
  ? void
  : Schema.Schema.Type<I>;

/**
 * Gated effect for {@link layer} / {@link serve} — unit gates accept a bare
 * {@link Effect.Effect} or `() => Effect`; parameterized gates use `(input) => Effect`.
 *
 * @public
 */
export type RunResourceLayerEffect<
  I extends Schema.Top | undefined,
  A,
  E,
  R,
> = [I] extends [undefined]
  ? Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)
  : (input: Schema.Schema.Type<I>) => Effect.Effect<A, E, R>;

/**
 * Gated effect for {@link Service} — same rules as {@link RunResourceLayerEffect} at the decoded type.
 *
 * @public
 */
export type RunResourceServiceEffect<
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top,
  R,
> = RunResourceLayerEffect<I, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>;

/**
 * Full {@link Service} config — wire schemas and the gated effect in one object.
 *
 * @public
 */
export interface RunResourceServiceConfig<
  I extends Schema.Top | undefined = undefined,
  A extends Schema.Top = typeof Schema.Void,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
> extends RunResourceWireSchemas<I, A, E> {
  /** Unit gates may pass a bare effect; parameterized gates use `(input) => Effect`. */
  readonly effect: RunResourceServiceEffect<I, A, E, R>;
  /**
   * Max concurrent executions through this gate.
   * @default 1
   */
  readonly concurrency?: number;
}

/**
 * Layer / serve config — the tag carries wire schemas; this supplies the gated effect.
 *
 * @public
 */
/** Gated effect at decoded payload types — used by {@link RunResourceLayerConfig}. @internal */
type RunResourceLayerEffectDecoded<I, A, E, R> = [I] extends [void]
  ? Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)
  : (input: I) => Effect.Effect<A, E, R>;

export interface RunResourceLayerConfig<I, A, E, R> {
  /** Override telemetry / status `resourceId`; defaults to the tag key. */
  readonly name?: string;
  /** Unit gates may pass a bare effect; parameterized gates use `(input) => Effect`. */
  readonly effect: RunResourceLayerEffectDecoded<I, A, E, R>;
  /**
   * Max concurrent executions through this gate.
   * @default 1
   */
  readonly concurrency?: number;
}

/**
 * Configuration for {@link RunResource.make} — local scoped handle, no RPC.
 *
 * @public
 */
export interface RunResourceConfig<T, A, E> {
  readonly name?: string;
  readonly effect: (input: T) => Effect.Effect<A, E>;
  readonly concurrency?: number;
  /** When true, `.run` is an {@link Effect.Effect} property (unit gate). @public */
  readonly unit?: boolean;
}

/**
 * Configuration for {@link RunResource.makeRunner}.
 *
 * @public
 */
export interface RunResourceRunnerConfig {
  readonly name?: string;
  readonly concurrency?: number;
}

/**
 * A generic runner that wraps any effect with concurrency gating.
 *
 * @public
 */
export type RunResourceRunner = internal.RunResourceRunner;

// ============================================================================
// Internal helpers
// ============================================================================

/** Resolved wire schemas with RPC defaults applied. @internal */
const resolveRunWireSchemas = <
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  config: RunResourceWireSchemas<I, A, E>,
): {
  readonly payload: I;
  readonly success: A;
  readonly error: E;
} => ({
  payload: config.payload as I,
  success: (config.success ?? Schema.Void) as A,
  error: (config.error ?? Schema.Never) as E,
});

/** Normalize bare unit-gate effects and thunk forms into `(input) => Effect`. @internal */
const toRunFn = <I, A, E, R>(
  effect: RunResourceLayerEffectDecoded<I, A, E, R>,
): ((input: I) => Effect.Effect<A, E, R>) => {
  if (Effect.isEffect(effect)) {
    return (() => effect) as (input: I) => Effect.Effect<A, E, R>;
  }
  return effect as (input: I) => Effect.Effect<A, E, R>;
};

const isRunTagConfigObject = (
  value: unknown,
): value is RunResourceTagSchemas<Schema.Top | undefined, Schema.Top, Schema.Top> =>
  typeof value === "object"
  && value !== null
  && !Schema.isSchema(value)
  && ("payload" in value || "success" in value || "error" in value || "description" in value);

/** Parse {@link Tag} positional schema args or a config object. @internal */
const parseRunTagArgs = (
  args: ReadonlyArray<unknown>,
): RunResourceTagSchemas<Schema.Top | undefined, Schema.Top, Schema.Top> => {
  if (args.length === 0) {
    return {};
  }
  if (args.length === 1) {
    const arg = args[0];
    if (Schema.isSchema(arg)) {
      return { success: arg };
    }
    if (isRunTagConfigObject(arg)) {
      return arg;
    }
    return {};
  }
  if (args.every(Schema.isSchema)) {
    if (args.length === 2) {
      return { payload: args[0] as Schema.Top, success: args[1] as Schema.Top };
    }
    if (args.length === 3) {
      return {
        payload: args[0] as Schema.Top,
        success: args[1] as Schema.Top,
        error: args[2] as Schema.Top,
      };
    }
  }
  throw new Error(
    "Invalid RunResource.Tag arguments — use Tag(key), Tag(key, success), "
      + "Tag(key, payload, success[, error]), or Tag(key, { … }). "
      + "Unit gates with success and error schemas use the config object form.",
  );
};

const stampRunWireSchemas = <
  Self,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  config: RunResourceWireSchemas<I, A, E>,
  resolved: { readonly payload: I; readonly success: A; readonly error: E },
): ResourceTag<Self, RunInstanceSpec<I, A, E>> => {
  const stamp: Partial<Record<typeof successSym | typeof errorSym, Schema.Top>> = {};
  if (config.success !== undefined) {
    stamp[successSym] = resolved.success;
  }
  if (config.error !== undefined && (resolved.error as Schema.Top) !== Schema.Never) {
    stamp[errorSym] = resolved.error;
  }
  const hasStamp = config.success !== undefined
    || (config.error !== undefined && (resolved.error as Schema.Top) !== Schema.Never);
  return hasStamp
    ? (Object.assign(tag, stamp) as ResourceTag<Self, RunInstanceSpec<I, A, E>>)
    : tag;
};

const runMethodHasPayload = (tag: ResourceTag<any, any>): boolean => {
  const run = tag[Resource.specSym].run as { readonly payload?: unknown };
  return run.payload !== undefined;
};

const makeStaticRun = <
  Self,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
): RunResourceStaticRun<I, A, E, Self> => {
  if (!runMethodHasPayload(tag)) {
    return Effect.gen(function* () {
      const svc = yield* tag;
      return yield* svc.run as Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>>;
    }) as RunResourceStaticRun<I, A, E, Self>;
  }
  return ((input: Schema.Schema.Type<I>) =>
    Effect.gen(function* () {
      const svc = yield* tag;
      return yield* (svc.run as (payload: Schema.Schema.Type<I>) => Effect.Effect<
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>
      >)(input);
    })) as RunResourceStaticRun<I, A, E, Self>;
};

const materializeRunTag = <
  Self,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  key: string,
  config: RunResourceTagSchemas<I, A, E>,
): RunTagWithStaticRun<Self, I, A, E> => {
  const resolved = resolveRunWireSchemas(config);
  const wirePayload = runSpecHasPayload(resolved.payload) ? resolved.payload : undefined;
  const spec = materializeRunSpec(wirePayload as I, resolved.success, resolved.error);
  const tag = Resource.Tag<Self>()(key, spec, {
    description: config.description,
    kind,
  });
  const ready = Resource.withReadiness(tag, (svc) =>
    Effect.map(
      (svc as { readonly status: { readonly get: Effect.Effect<RunGateStatus> } }).status.get,
      () => ({ ready: true }),
    ),
  ) as ResourceTag<Self, RunInstanceSpec<I, A, E>>;
  const stamped = stampRunWireSchemas<Self, I, A, E>(ready, config, resolved);
  return Object.assign(stamped, { run: makeStaticRun(stamped) }) as RunTagWithStaticRun<
    Self,
    I,
    A,
    E
  >;
};

const runTag = <Self>() => {
  type Build = {
    (
      key: string,
    ): RunTagWithStaticRun<Self, undefined, typeof Schema.Void, typeof Schema.Never>;
    <A extends Schema.Top>(
      key: string,
      success: A,
    ): RunTagWithStaticRun<Self, undefined, A, typeof Schema.Never>;
    <I extends Schema.Top, A extends Schema.Top>(
      key: string,
      payload: I,
      success: A,
    ): RunTagWithStaticRun<Self, I, A, typeof Schema.Never>;
    <I extends Schema.Top, A extends Schema.Top, E extends Schema.Top>(
      key: string,
      payload: I,
      success: A,
      error: E,
    ): RunTagWithStaticRun<Self, I, A, E>;
    <
      I extends Schema.Top | undefined,
      A extends Schema.Top,
      E extends Schema.Top = typeof Schema.Never,
    >(
      key: string,
      config: RunResourceTagSchemas<I, A, E>,
    ): RunTagWithStaticRun<Self, I, A, E>;
    (key: string, ...args: ReadonlyArray<unknown>): RunTagWithStaticRun<
      Self,
      Schema.Top | undefined,
      Schema.Top,
      Schema.Top
    >;
  };
  const build = (key: string, ...args: ReadonlyArray<unknown>) =>
    materializeRunTag(key, parseRunTagArgs(args));
  return build as Build;
};

/** Merge the baked-in default store bridge; apps override with `Layer.provideMerge(AppStore.layerMemory)`. @internal */
const withDefaultStoreBridge = <A, E, R>(
  layer: Layer.Layer<A, E, R | Store.Storage>,
): Layer.Layer<A | Store.Storage, E, R> =>
  layer.pipe(Layer.provideMerge(Store.layerDefaultMemory));

/**
 * Build the live gate behind `tag` and map it onto the toolkit service impl — shared by
 * {@link layer} / {@link serve} / {@link serveRemote}.
 *
 * @internal
 */
const buildRunImpl = <
  Self,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top,
  R,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  config: RunResourceLayerConfig<
    RunPayloadDecoded<I>,
    Schema.Schema.Type<A>,
    Schema.Schema.Type<E>,
    R
  >,
): Effect.Effect<any, never, R | Scope.Scope | Store.Storage> =>
  Effect.gen(function* () {
    const unit = !runMethodHasPayload(tag);
    const context = yield* Effect.context<R>();
    const provideR = <Out, Err>(
      effect: Effect.Effect<Out, Err, R>,
    ): Effect.Effect<Out, Err> => Effect.provide(effect, context);
    const effectiveConfig = yield* foldConfiguredSpec<
      RunResourceLayerConfig<
        RunPayloadDecoded<I>,
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>,
        R
      >
    >(tag.key, { ...config, name: tag.key });
    const handle = yield* internal.makeRunResourceHandleEffect({
      name: effectiveConfig.name ?? tag.key,
      scopeKey: tag.key,
      tag,
      effect: (input: RunPayloadDecoded<I>) =>
        provideR(toRunFn(effectiveConfig.effect)(input)),
      concurrency: effectiveConfig.concurrency,
      unit,
    });

    const statusSub = {
      get: handle.status.get,
      changes: handle.status.changes,
    };
    const impl = {
      status: statusSub,
      waiting: handle.waiting,
      inFlight: handle.inFlight,
      completed: handle.completed,
      failed: handle.failed,
      interrupted: handle.interrupted,
      run: unit
        ? handle.run
        : (input: Schema.Schema.Type<I>) =>
            (handle.run as (payload: Schema.Schema.Type<I>) => Effect.Effect<
              Schema.Schema.Type<A>,
              Schema.Schema.Type<E>
            >)(input),
    };
    return Resource.builtResource(
      tag,
      impl as Resource.WithRequirement<ImplOf<RunInstanceSpec<I, A, E>>, R>,
      context,
    );
  });

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a scoped handle with `.run` only — no live observation, no RPC.
 *
 * @public
 */
export const make = internal.makeRunGateHandleEffect;

/**
 * Config-patch layer for a tag — merge with {@link layer} (Tag path).
 *
 * @public
 */
export const configure = <
  Self,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  patch: ConfigPatch<
    RunResourceLayerConfig<
      RunPayloadDecoded<I>,
      Schema.Schema.Type<A>,
      Schema.Schema.Type<E>,
      never
    >
  >,
): Layer.Layer<never> => configureLayer(tag.key, patch);

/**
 * Build a `Layer` from a tag and config — yields an observable toolkit service.
 *
 * @public
 */
export const layer = <
  Self,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  config: RunResourceLayerConfig<
    RunPayloadDecoded<I>,
    Schema.Schema.Type<A>,
    Schema.Schema.Type<E>,
    R
  >,
): Layer.Layer<Self | Local<Self> | Store.Storage, never, R> =>
  withDefaultStoreBridge(
    Layer.unwrap(
      Effect.map(buildRunImpl(tag, config), (built) =>
        Resource.layer(tag, Resource.grantLocal(tag, built)),
      ),
    ),
  );

/**
 * Serve this run gate **remotely (served-only)** — RPC handlers without granting the local instance.
 *
 * @public
 */
export function serveRemote<
  Self,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  config: RunResourceLayerConfig<
    RunPayloadDecoded<I>,
    Schema.Schema.Type<A>,
    Schema.Schema.Type<E>,
    R
  >,
): Layer.Layer<HandlerContextOf<RunInstanceSpec<I, A, E>> | Store.Storage, never, R>;
export function serveRemote(
  tag: ResourceTag<any, any>,
  config: RunResourceLayerConfig<any, any, any, any>,
): Layer.Layer<any, any, any> {
  return withDefaultStoreBridge(
    Layer.unwrap(
      Effect.map(
        buildRunImpl(tag, config),
        (built) =>
          Resource.serveRemote(tag as any, built as any) as unknown as Layer.Layer<any, any, any>,
      ),
    ) as Layer.Layer<any, any, any>,
  );
}

/**
 * Serve this run gate **and** grant its local instance from one materialization.
 *
 * @public
 */
export function serve<
  Self,
  I extends Schema.Top | undefined,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  config: RunResourceLayerConfig<
    RunPayloadDecoded<I>,
    Schema.Schema.Type<A>,
    Schema.Schema.Type<E>,
    R
  >,
): Layer.Layer<
  Self | Local<Self> | HandlerContextOf<RunInstanceSpec<I, A, E>> | Store.Storage,
  never,
  R
>;
export function serve(
  tag: ResourceTag<any, any>,
  config: RunResourceLayerConfig<any, any, any, any>,
): Layer.Layer<any, any, any> {
  return withDefaultStoreBridge(
    Layer.unwrap(
      Effect.map(
        buildRunImpl(tag, config),
        (built) => Resource.serve(tag as any, built as any) as unknown as Layer.Layer<any, any, any>,
      ),
    ) as Layer.Layer<any, any, any>,
  );
}

/**
 * Class factory: tag + wire schemas + baked-in `.layer` + `.configure`.
 *
 * @public
 */
export const Service = <Self>() => {
  function build<
    const Name extends string,
    I extends Schema.Top | undefined = undefined,
    A extends Schema.Top = typeof Schema.Void,
    E extends Schema.Top = typeof Schema.Never,
    R = never,
  >(
    name: Name,
    config: RunResourceServiceConfig<I, A, E, R>,
  ) {
    const wire = resolveRunWireSchemas(config);
    const tag = runTag<Self>()(name, config as RunResourceTagSchemas<I, A, E>);
    const error = wire.error;
    const defaultSpec = { name, ...config, ...wire, error };
    const layerConfig: RunResourceLayerConfig<
      RunPayloadDecoded<I>,
      Schema.Schema.Type<A>,
      Schema.Schema.Type<E>,
      R
    > = {
      effect: config.effect as RunResourceLayerEffectDecoded<
        RunPayloadDecoded<I>,
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>,
        R
      >,
      concurrency: config.concurrency,
      name,
    };
    return Object.assign(tag, {
      defaultSpec,
      configure: (
        patch: ConfigPatch<
          RunResourceLayerConfig<
            RunPayloadDecoded<I>,
            Schema.Schema.Type<A>,
            Schema.Schema.Type<E>,
            R
          >
        >,
      ) => configureLayer(name, patch),
      wrapGate: (
        fn: (
          previous: RunResourceLayerConfig<
            RunPayloadDecoded<I>,
            Schema.Schema.Type<A>,
            Schema.Schema.Type<E>,
            R
          >["effect"],
        ) => RunResourceLayerConfig<
          RunPayloadDecoded<I>,
          Schema.Schema.Type<A>,
          Schema.Schema.Type<E>,
          R
        >["effect"],
      ) => configureWrapEffectField(name, fn),
      layer: withDefaultStoreBridge(
        Layer.unwrap(
          Effect.map(
            buildRunImpl(tag as ResourceTag<any, any>, layerConfig),
            (built) =>
              Resource.layer(
                tag as ResourceTag<any, any>,
                Resource.grantLocal(tag as ResourceTag<any, any>, built),
              ),
          ),
        ) as Layer.Layer<Self, never, R | Store.Storage>,
      ),
      run: makeStaticRun(tag),
    });
  }
  return build;
};

/**
 * Class factory: identity tag + wire schemas — pair with {@link layer}.
 *
 * @public
 */
export { runTag as Tag };

/**
 * Register this run gate on an app {@link Store.Service} — built-in analytics reads over run facts
 * and state history (tier 3), with the tag's `success` / `error` wire slots.
 *
 * @public
 */
export function store<const Tag extends StoreScopeTag>(tag: Tag): ReturnType<
  typeof facetStoreRegistration<Tag, RunResourceStoreAnalyticsContract<Tag>>
>;
export function store<
  const Tag extends StoreScopeTag,
  const Shapes extends StoreShapes,
>(tag: Tag, extended: Shapes): ReturnType<
  typeof facetStoreRegistration<
    Tag,
    RunResourceStoreAnalyticsContract<Tag>,
    Shapes
  >
>;
export function store(tag: StoreScopeTag, extended?: StoreShapes) {
  const contract = makeRunResourceStoreAnalyticsContract(tag);
  return extended === undefined
    ? facetStoreRegistration(tag, contract)
    : facetStoreRegistration(tag, contract, extended);
}

/**
 * Generic runner tag + layer — no observation, no handle shape, no RPC.
 *
 * @public
 */
export const makeRunner = <const Name extends string>(
  config: RunResourceRunnerConfig & { readonly name: Name },
) => {
  const tag = Context.Service<
    RunResourceRunner & { readonly _tag: Name },
    RunResourceRunner
  >(config.name);
  const runnerLayer = Layer.effect(tag)(internal.makeRunnerEffect(config));
  return Object.assign(tag, { layer: runnerLayer });
};
