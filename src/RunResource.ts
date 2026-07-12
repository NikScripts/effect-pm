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
 * // unit gate — bare effect, wire slots default to Void / Never
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
  runGateStatus,
  runSpec,
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
export { runGateStatus };

/**
 * This contract's canonical **kind** — stamped on every run-gate tag.
 *
 * @public
 */
export const kind = "@nikscripts/effect-pm/RunResource";

/**
 * Build a run-gate **instance** spec from wire schemas — pass to {@link Resource.Tag} or use via
 * {@link Tag} / {@link Service}.
 *
 * @public
 */
export { runSpec };

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
 * @public
 */
export type RunResourceStaticRun<I, A, E, Self> = [Schema.Schema.Type<I>] extends [void]
  ? Effect.Effect<A, E, Self>
  : (input: Schema.Schema.Type<I>) => Effect.Effect<A, E, Self>;

/**
 * Service factory result — tag surface plus baked-in layer and configure helpers.
 *
 * @public
 */
export interface RunResourceServiceDefinition<
  Self,
  Name extends string,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
> extends RunResourceTagDefinition<Self, I, A, E> {
  readonly defaultSpec: RunResourceServiceConfig<I, A, E, R> & { readonly name: Name };
  readonly layer: Layer.Layer<Self | Store.Storage, never, R>;
  readonly configure: (
    patch: ConfigPatch<
      RunResourceLayerConfig<
        Schema.Schema.Type<I>,
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>,
        R
      >
    >,
  ) => Layer.Layer<never>;
  readonly wrapGate: (
    fn: (
      previous: RunResourceLayerConfig<
        Schema.Schema.Type<I>,
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>,
        R
      >["effect"],
    ) => RunResourceLayerConfig<
      Schema.Schema.Type<I>,
      Schema.Schema.Type<A>,
      Schema.Schema.Type<E>,
      R
    >["effect"],
  ) => Layer.Layer<never>;
}

/** Tag + static `.run` shortcut. @internal */
type RunTagWithStaticRun<
  Self,
  I extends Schema.Top,
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
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> = RunTagWithStaticRun<Self, I, A, E>;

/**
 * Wire schemas shared by {@link Tag} and {@link Service}.
 *
 * @public
 */
export interface RunResourceWireSchemas<
  I extends Schema.Top = typeof Schema.Void,
  A extends Schema.Top = typeof Schema.Void,
  E extends Schema.Top = typeof Schema.Never,
> {
  /** Wire input schema; defaults to {@link Schema.Void} (unit gate). */
  readonly payload?: I;
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
  I extends Schema.Top = Schema.Top,
  A extends Schema.Top = Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> extends RunResourceWireSchemas<I, A, E> {
  readonly description?: string;
}

/**
 * Gated effect for {@link layer} / {@link serve} — unit gates (`void` input) accept a bare
 * {@link Effect.Effect} or `() => Effect`; parameterized gates use `(input) => Effect`.
 *
 * @public
 */
export type RunResourceLayerEffect<I, A, E, R> = [I] extends [void]
  ? Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)
  : (input: I) => Effect.Effect<A, E, R>;

/**
 * Gated effect for {@link Service} — same rules as {@link RunResourceLayerEffect} at the decoded type.
 *
 * @public
 */
export type RunResourceServiceEffect<
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
  R,
> = [Schema.Schema.Type<I>] extends [void]
  ? Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>
    | (() => Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>)
  : (input: Schema.Schema.Type<I>) => Effect.Effect<
      Schema.Schema.Type<A>,
      Schema.Schema.Type<E>,
      R
    >;

/**
 * Full {@link Service} config — wire schemas and the gated effect in one object.
 *
 * @public
 */
export interface RunResourceServiceConfig<
  I extends Schema.Top = typeof Schema.Void,
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
export interface RunResourceLayerConfig<I, A, E, R> {
  /** Override telemetry / status `resourceId`; defaults to the tag key. */
  readonly name?: string;
  /** Unit gates may pass a bare effect; parameterized gates use `(input) => Effect`. */
  readonly effect: RunResourceLayerEffect<I, A, E, R>;
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
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  config: RunResourceWireSchemas<I, A, E>,
): { readonly payload: I; readonly success: A; readonly error: E } => ({
  payload: (config.payload ?? Schema.Void) as I,
  success: (config.success ?? Schema.Void) as A,
  error: (config.error ?? Schema.Never) as E,
});

/** Normalize bare unit-gate effects and thunk forms into `(input) => Effect`. @internal */
const toRunFn = <I, A, E, R>(
  effect: RunResourceLayerEffect<I, A, E, R>,
): ((input: I) => Effect.Effect<A, E, R>) => {
  if (Effect.isEffect(effect)) {
    return (() => effect) as (input: I) => Effect.Effect<A, E, R>;
  }
  return effect as (input: I) => Effect.Effect<A, E, R>;
};

const stampRunWireSchemas = <
  Self,
  I extends Schema.Top,
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

const makeStaticRunInputless = <
  Self,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  tag: ResourceTag<Self, RunInstanceSpec<typeof Schema.Void, A, E>>,
): Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>, Self> =>
  Effect.gen(function* () {
    const svc = yield* tag;
    return yield* (svc.run as Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>>);
  });

const makeStaticRunParameterized = <
  Self,
  I extends Exclude<Schema.Top, typeof Schema.Void>,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
): ((
  input: Schema.Schema.Type<I>,
) => Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>, Self>) =>
  (input) =>
    Effect.gen(function* () {
      const svc = yield* tag;
      return yield* (svc.run as (payload: Schema.Schema.Type<I>) => Effect.Effect<
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>
      >)(input);
    });

const makeStaticRun = <
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
): RunResourceStaticRun<I, A, E, Self> =>
  (Resource.isInputlessEffect(tag[Resource.specSym].run as Resource.AnyMethod)
    ? makeStaticRunInputless(tag as unknown as ResourceTag<Self, RunInstanceSpec<typeof Schema.Void, A, E>>)
    : makeStaticRunParameterized(
        tag as unknown as ResourceTag<Self, RunInstanceSpec<Exclude<I, typeof Schema.Void>, A, E>>,
      )) as unknown as RunResourceStaticRun<I, A, E, Self>;

const isRunTagSchemaConfig = (value: unknown): value is RunResourceTagSchemas =>
  typeof value === "object" && value !== null && !Schema.isSchema(value);

/** Infer wire schemas from a tag config object (defaults match {@link resolveRunWireSchemas}). @internal */
type RunSchemasOf<C extends RunResourceTagSchemas> = {
  readonly payload: C extends { readonly payload: infer I extends Schema.Top } ? I : typeof Schema.Void;
  readonly success: C extends { readonly success: infer A extends Schema.Top } ? A : typeof Schema.Void;
  readonly error: C extends { readonly error: infer E extends Schema.Top } ? E : typeof Schema.Never;
};

const materializeRunTag = <
  Self,
  const C extends RunResourceTagSchemas,
>(
  key: string,
  config: C,
): RunTagWithStaticRun<
  Self,
  RunSchemasOf<C>["payload"],
  RunSchemasOf<C>["success"],
  RunSchemasOf<C>["error"]
> => {
  type I = RunSchemasOf<C>["payload"];
  type A = RunSchemasOf<C>["success"];
  type E = RunSchemasOf<C>["error"];
  const resolved = resolveRunWireSchemas(config as RunResourceWireSchemas<I, A, E>);
  const spec = runSpec(resolved.payload, resolved.success, resolved.error);
  const tag = Resource.Tag<Self>()(key, spec, {
    description: config.description,
    kind,
  });
  const ready = Resource.withReadiness(tag, (svc) =>
    Effect.map(svc.status.get, () => ({ ready: true })),
  );
  const stamped = stampRunWireSchemas<Self, I, A, E>(ready, config as RunResourceWireSchemas<I, A, E>, resolved);
  return Object.assign(stamped, { run: makeStaticRun(stamped) });
};

const runTag = <Self>() => {
  function build(key: string): RunTagWithStaticRun<Self, typeof Schema.Void, typeof Schema.Void, typeof Schema.Never>;
  function build<
    I extends Schema.Top,
    A extends Schema.Top,
    E extends Schema.Top = typeof Schema.Never,
  >(
    key: string,
    config: RunResourceTagSchemas<I, A, E>,
  ): RunTagWithStaticRun<Self, I, A, E>;
  function build<I extends Schema.Top, A extends Schema.Top>(
    key: string,
    payload: I,
    success: A,
    options?: { readonly description?: string },
  ): RunTagWithStaticRun<Self, I, A, typeof Schema.Never>;
  function build<
    I extends Schema.Top,
    A extends Schema.Top,
    E extends Schema.Top,
  >(
    key: string,
    payload: I,
    success: A,
    error: E,
    options?: { readonly description?: string },
  ): RunTagWithStaticRun<Self, I, A, E>;
  function build(
    key: string,
    inputOrSchemas?: Schema.Top | RunResourceTagSchemas,
    success?: Schema.Top,
    errorOrOptions?: Schema.Top | { readonly description?: string },
    maybeOptions?: { readonly description?: string },
  ): any {
    if (inputOrSchemas === undefined) {
      return materializeRunTag(key, {});
    }
    if (isRunTagSchemaConfig(inputOrSchemas)) {
      return materializeRunTag(key, inputOrSchemas);
    }
    const payload = inputOrSchemas;
    const hasError =
      errorOrOptions !== undefined && Schema.isSchema(errorOrOptions);
    const error = hasError ? errorOrOptions : undefined;
    const options = hasError
      ? maybeOptions
      : errorOrOptions as { readonly description?: string } | undefined;
    return materializeRunTag(key, {
      payload,
      success: success!,
      ...(error !== undefined ? { error } : {}),
      description: options?.description,
    } as RunResourceTagSchemas);
  }
  return build;
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
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
  R,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  config: RunResourceLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
): Effect.Effect<any, never, R | Scope.Scope | Store.Storage> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const provideR = <Out, Err>(
      effect: Effect.Effect<Out, Err, R>,
    ): Effect.Effect<Out, Err> => Effect.provide(effect, context);
    const effectiveConfig = yield* foldConfiguredSpec<
      RunResourceLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>
    >(tag.key, { ...config, name: tag.key });
    const handle = yield* internal.makeRunResourceHandleEffect({
      name: effectiveConfig.name ?? tag.key,
      scopeKey: tag.key,
      tag,
      effect: (input: Schema.Schema.Type<I>) =>
        provideR(toRunFn(effectiveConfig.effect)(input)),
      concurrency: effectiveConfig.concurrency,
    });

    const statusSub = {
      get: handle.status.get,
      changes: handle.status.changes,
    };
    const runImpl = (
      Resource.isInputlessEffect(tag[Resource.specSym].run as Resource.AnyMethod)
        ? Effect.suspend(
            handle.run as () => Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>>,
          )
        : handle.run
    ) as ImplOf<RunInstanceSpec<I, A, E>>["run"];

    const impl = {
      status: statusSub,
      waiting: handle.waiting,
      inFlight: handle.inFlight,
      completed: handle.completed,
      failed: handle.failed,
      interrupted: handle.interrupted,
      run: runImpl,
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
export const configure = <Self, I extends Schema.Top, A extends Schema.Top, E extends Schema.Top>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  patch: ConfigPatch<
    RunResourceLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, never>
  >,
): Layer.Layer<never> => configureLayer(tag.key, patch);

/**
 * Build a `Layer` from a tag and config — yields an observable toolkit service.
 *
 * @public
 */
export const layer = <
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  config: RunResourceLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
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
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  config: RunResourceLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
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
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
  config: RunResourceLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
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
    I extends Schema.Top = typeof Schema.Void,
    A extends Schema.Top = typeof Schema.Void,
    E extends Schema.Top = typeof Schema.Never,
    R = never,
  >(
    name: Name,
    config: RunResourceServiceConfig<I, A, E, R>,
  ) {
    const wire = resolveRunWireSchemas(config);
    const tag = runTag<Self>()(name, config);
    const error = wire.error;
    const defaultSpec = { name, ...config, ...wire, error };
    const layerConfig: RunResourceLayerConfig<
      Schema.Schema.Type<I>,
      Schema.Schema.Type<A>,
      Schema.Schema.Type<E>,
      R
    > = {
      effect: config.effect as RunResourceLayerEffect<
        Schema.Schema.Type<I>,
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
            Schema.Schema.Type<I>,
            Schema.Schema.Type<A>,
            Schema.Schema.Type<E>,
            R
          >
        >,
      ) => configureLayer(name, patch),
      wrapGate: (
        fn: (
          previous: RunResourceLayerConfig<
            Schema.Schema.Type<I>,
            Schema.Schema.Type<A>,
            Schema.Schema.Type<E>,
            R
          >["effect"],
        ) => RunResourceLayerConfig<
          Schema.Schema.Type<I>,
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
