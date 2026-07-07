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
 * ## Remote usage
 *
 * Declare wire schemas on the tag, then serve or connect like {@link QueueResource} / {@link Process}:
 *
 * ```ts
 * class FetchGate extends RunResource.Tag<FetchGate>()(
 *   "@app/FetchGate",
 *   SymbolSchema,
 *   PriceSchema,
 *   FetchErrSchema,
 * ) {}
 * // or:
 * class FetchGate extends RunResource.Tag<FetchGate>()("@app/FetchGate", {
 *   payload: SymbolSchema,
 *   success: PriceSchema,
 *   error: FetchErrSchema,
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
  Local,
  ResourceTag,
} from "./Resource";
import { facetStoreRegistration } from "./internal/store/facetStore";
import {
  builtInRunResourceStoreContract,
  type BuiltInRunResourceContract,
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
export type RunResourceStaticRun<I, A, E, Self> = Schema.Schema.Type<I> extends void
  ? () => Effect.Effect<A, E, Self>
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
  readonly layer: Layer.Layer<Self, never, R>;
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
  I extends Schema.Top = Schema.Top,
  A extends Schema.Top = Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> {
  readonly payload: I;
  readonly success: A;
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
 * Full {@link Service} config — wire schemas and the gated effect in one object.
 *
 * @public
 */
export interface RunResourceServiceConfig<
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
> extends RunResourceWireSchemas<I, A, E> {
  /** The effect to gate. For unit gates (`Schema.Void` input), use `() => myEffect`. */
  readonly effect: (
    input: Schema.Schema.Type<I>,
  ) => Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>;
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
  /** The effect to gate. For unit gates (`Schema.Void` input), use `() => myEffect`. */
  readonly effect: (input: I) => Effect.Effect<A, E, R>;
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

const makeStaticRun = <
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  tag: ResourceTag<Self, RunInstanceSpec<I, A, E>>,
): RunResourceStaticRun<I, A, E, Self> =>
  ((input?: Schema.Schema.Type<I>) =>
    Effect.gen(function* () {
      const svc = yield* tag;
      const run = svc.run;
      if (input === undefined) {
        if (typeof run === "function") {
          return yield* (run as () => Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>>)();
        }
        return yield* (run as Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>>);
      }
      return yield* (run as (payload: Schema.Schema.Type<I>) => Effect.Effect<
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>
      >)(input);
    })) as RunResourceStaticRun<I, A, E, Self>;

const isSchemaTop = (value: unknown): value is Schema.Top =>
  typeof value === "object" && value !== null && "ast" in value;

const isTagSchemaConfig = (value: unknown): value is RunResourceTagSchemas =>
  typeof value === "object" &&
  value !== null &&
  "payload" in value &&
  "success" in value;

const materializeRunTag = <
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  key: string,
  payload: I,
  success: A,
  error: E,
  options?: { readonly description?: string },
): RunTagWithStaticRun<Self, I, A, E> => {
  const spec = runSpec(payload, success, error);
  const tag = Resource.Tag<Self>()(key, spec, {
    description: options?.description,
    kind,
  });
  const ready = Resource.withReadiness(tag, (svc) =>
    Effect.map(svc.status.get, () => ({ ready: true })),
  );
  return Object.assign(ready, { run: makeStaticRun(ready) }) as RunTagWithStaticRun<
    Self,
    I,
    A,
    E
  >;
};

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
): Effect.Effect<any, never, R | Scope.Scope> =>
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
      effect: (input: Schema.Schema.Type<I>) => provideR(effectiveConfig.effect(input)),
      concurrency: effectiveConfig.concurrency,
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
      run: (input?: Schema.Schema.Type<I>) =>
        input === undefined
          ? (handle.run as () => Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>>)()
          : handle.run(input as Schema.Schema.Type<I>),
    };
    return impl;
  });

const runTag = <Self>() => {
  function build<I extends Schema.Top, A extends Schema.Top>(
    key: string,
    schemas: RunResourceTagSchemas<I, A, typeof Schema.Never>,
  ): RunTagWithStaticRun<Self, I, A, typeof Schema.Never>;
  function build<
    I extends Schema.Top,
    A extends Schema.Top,
    E extends Schema.Top,
  >(
    key: string,
    schemas: RunResourceTagSchemas<I, A, E>,
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
    inputOrSchemas: Schema.Top | RunResourceTagSchemas,
    success?: Schema.Top,
    errorOrOptions?: Schema.Top | { readonly description?: string },
    maybeOptions?: { readonly description?: string },
  ): RunTagWithStaticRun<Self, any, any, any> {
    if (isTagSchemaConfig(inputOrSchemas)) {
      const error = (inputOrSchemas.error ?? Schema.Never) as Schema.Top;
      return materializeRunTag(
        key,
        inputOrSchemas.payload,
        inputOrSchemas.success,
        error,
        { description: inputOrSchemas.description },
      );
    }
    const payload = inputOrSchemas;
    const hasError =
      errorOrOptions !== undefined &&
      isSchemaTop(errorOrOptions);
    const error = hasError ? errorOrOptions : Schema.Never;
    const options = hasError ? maybeOptions : errorOrOptions as
      | { readonly description?: string }
      | undefined;
    return materializeRunTag(
      key,
      payload,
      success as Schema.Top,
      error,
      options,
    );
  }
  return build;
};

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
): Layer.Layer<Self | Local<Self>, never, R> =>
  Layer.unwrap(
    Effect.map(buildRunImpl(tag, config), (impl) => Resource.layer(tag, impl)),
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
): Layer.Layer<HandlerContextOf<RunInstanceSpec<I, A, E>>, never, R>;
export function serveRemote(
  tag: ResourceTag<any, any>,
  config: RunResourceLayerConfig<any, any, any, any>,
): Layer.Layer<any, any, any> {
  return Layer.unwrap(
    Effect.map(
      buildRunImpl(tag, config),
      (impl) =>
        Resource.serveRemote(tag as any, impl as any) as unknown as Layer.Layer<any, any, any>,
    ),
  ) as Layer.Layer<any, any, any>;
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
  Self | Local<Self> | HandlerContextOf<RunInstanceSpec<I, A, E>>,
  never,
  R
>;
export function serve(
  tag: ResourceTag<any, any>,
  config: RunResourceLayerConfig<any, any, any, any>,
): Layer.Layer<any, any, any> {
  return Layer.unwrap(
    Effect.map(
      buildRunImpl(tag, config),
      (impl) => Resource.serve(tag as any, impl as any) as unknown as Layer.Layer<any, any, any>,
    ),
  ) as Layer.Layer<any, any, any>;
}

/**
 * Class factory: tag + wire schemas + baked-in `.layer` + `.configure`.
 *
 * @public
 */
export const Service = <Self>() => {
  function build<
    const Name extends string,
    I extends Schema.Top,
    A extends Schema.Top,
    E extends Schema.Top = typeof Schema.Never,
    R = never,
  >(
    name: Name,
    config: RunResourceServiceConfig<I, A, E, R>,
  ) {
    const error = (config.error ?? Schema.Never) as E;
    const tag = runTag<Self>()(name, {
      payload: config.payload,
      success: config.success,
      error,
    });
    const defaultSpec = { name, ...config, error };
    const layerConfig: RunResourceLayerConfig<
      Schema.Schema.Type<I>,
      Schema.Schema.Type<A>,
      Schema.Schema.Type<E>,
      R
    > = {
      effect: config.effect,
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
      layer: Layer.unwrap(
        Effect.map(
          buildRunImpl(tag as ResourceTag<any, any>, layerConfig),
          (impl) => Resource.layer(tag as ResourceTag<any, any>, impl),
        ),
      ) as Layer.Layer<Self, never, R>,
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
 * Register this run gate on an app {@link Store.Service} — built-in fact and state-history shapes.
 *
 * @public
 */
export function store<const Tag extends StoreScopeTag>(tag: Tag): ReturnType<
  typeof facetStoreRegistration<Tag, BuiltInRunResourceContract>
>;
export function store<
  const Tag extends StoreScopeTag,
  const Shapes extends StoreShapes,
>(tag: Tag, extended: Shapes): ReturnType<
  typeof facetStoreRegistration<
    Tag,
    BuiltInRunResourceContract,
    Shapes
  >
>;
export function store(tag: StoreScopeTag, extended?: StoreShapes) {
  const builtIn = builtInRunResourceStoreContract(tag);
  return extended === undefined
    ? facetStoreRegistration(tag, builtIn)
    : facetStoreRegistration(tag, builtIn, extended);
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
