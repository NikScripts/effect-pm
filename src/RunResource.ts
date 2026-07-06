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
 * | `RunResource.make` | Scoped handle with `.run` only (no observation) |
 * | `RunResource.layer` | Builds a `Layer` from tag + config (observable handle) |
 * | `RunResource.Service` | Tag + baked-in `.layer` + `.configure` |
 * | `RunResource.Tag` | Identity tag — pair with {@link layer} |
 * | `RunResource.configure` | Config patch layer for a tag (Tag path) |
 * | `RunResource.makeRunner` | Generic runner (wraps arbitrary effects) |
 *
 * ## Observable handles (Tag / Service / layer)
 *
 * `yield* Tag` returns a handle with `.run` plus {@link Subscribable} views
 * (`status`, `waiting`, `inFlight`, `completed`, …). Read with `yield* handle.waiting.get`
 * or subscribe via `handle.waiting.changes`.
 *
 * Tag and Service also expose a static {@link RunResourceTagDefinition.run} shortcut that
 * requires the tag in `R` (unlike `Effect.use`, which does not add a service requirement).
 *
 * ## Usage
 *
 * ```ts
 * class FetchGate extends RunResource.Service<FetchGate, string, Price, FetchErr>()(
 *   "@app/FetchGate",
 *   { effect: (symbol) => fetch(symbol), concurrency: 3 },
 * ) {}
 *
 * yield* FetchGate.run("AAPL")           // static shortcut
 * const gate = yield* FetchGate
 * yield* gate.run("GOOG")                // handle method
 * yield* gate.waiting.get                // one-shot read
 * gate.status.changes.pipe(Stream.runForEach(...))
 * ```
 *
 * @module RunResource
 */

import { Context, Effect, Layer } from "effect";
import {
  configureLayer,
  configureWrapEffectField,
  foldConfiguredSpec,
  type ConfigPatch,
} from "./ResourceConfigure";
import * as internal from "./internal/runResource";

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
 * Observable handle from {@link RunResource.layer}, {@link RunResource.Service},
 * or {@link RunResource.Tag} when a layer is provided.
 *
 * @public
 */
export type RunResourceHandle<T, A, E> = internal.RunResourceHandle<T, A, E>;

/**
 * Static `.run` shortcut on {@link Tag} / {@link Service} — adds the tag to `R`.
 *
 * @public
 */
export type RunResourceStaticRun<T, A, E, Self> = [T] extends [void]
  ? () => Effect.Effect<A, E, Self>
  : (input: T) => Effect.Effect<A, E, Self>;

/**
 * Configuration for {@link RunResource.make}, {@link layer}, and {@link Service}.
 *
 * @public
 */
export interface RunResourceConfig<T, A, E> {
  /** Service name used for log annotations and status `resourceId`. */
  readonly name?: string;
  /**
   * The effect to gate. A function receiving the input and returning the effect.
   * For unit gates (no input), use `() => myEffect`.
   */
  readonly effect: (input: T) => Effect.Effect<A, E>;
  /**
   * Max concurrent executions through this gate.
   * @default 1
   */
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

/**
 * Tag factory result — identity + static {@link RunResourceStaticRun}.
 *
 * @public
 */
export type RunResourceTagDefinition<
  Self,
  T,
  A,
  E,
> = Context.Service<Self, RunResourceHandle<T, A, E>> & {
  readonly run: RunResourceStaticRun<T, A, E, Self>;
};

/**
 * Service factory result — tag surface plus baked-in layer and configure helpers.
 *
 * @public
 */
export interface RunResourceServiceDefinition<
  Self,
  Name extends string,
  T,
  A,
  E,
> extends RunResourceTagDefinition<Self, T, A, E> {
  readonly defaultSpec: RunResourceConfig<T, A, E> & { readonly name: Name };
  readonly layer: Layer.Layer<Self>;
  readonly configure: (
    patch: ConfigPatch<RunResourceConfig<T, A, E>>,
  ) => Layer.Layer<never>;
  readonly wrapGate: (
    fn: (
      previous: RunResourceConfig<T, A, E>["effect"],
    ) => RunResourceConfig<T, A, E>["effect"],
  ) => Layer.Layer<never>;
}

/**
 * @deprecated Callable gates are replaced by {@link RunGateHandle.run}. Will be removed.
 * @public
 */
export type RunGate<T, A, E> = RunGateHandle<T, A, E>;

// ============================================================================
// Internal helpers
// ============================================================================

const makeStaticRun = <Self, T, A, E, Name extends string>(
  tag: Context.ServiceClass<Self, Name, RunResourceHandle<T, A, E>>,
): RunResourceStaticRun<T, A, E, Self> =>
  ((...args: [T] extends [void] ? readonly [] : readonly [T]) =>
    Effect.gen(function* () {
      const handle = yield* tag;
      return args.length === 0
        ? yield* (handle.run as () => Effect.Effect<A, E>)()
        : yield* handle.run(args[0] as T);
    })) as RunResourceStaticRun<T, A, E, Self>;

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a scoped handle with `.run` only — no live observation.
 *
 * @public
 */
export const make = internal.makeRunGateHandleEffect;

/**
 * Config-patch layer for a tag — merge with {@link layer} (Tag path).
 *
 * @public
 */
export const configure = <Self, T, A, E>(
  tag: Context.Service<Self, RunResourceHandle<T, A, E>>,
  patch: ConfigPatch<RunResourceConfig<T, A, E>>,
): Layer.Layer<never> => configureLayer(tag.key, patch);

/**
 * Build a `Layer` from a tag and config — yields an observable handle.
 *
 * @public
 */
export const layer = <Self, T, A, E>(
  tag: Context.Service<Self, RunResourceHandle<T, A, E>>,
  config: RunResourceConfig<T, A, E>,
) => {
  const resourceId = config.name ?? tag.key;
  return Layer.effect(tag)(
    foldConfiguredSpec(resourceId, {
      ...config,
      name: resourceId,
    }).pipe(Effect.flatMap(internal.makeRunResourceHandleEffect)),
  );
};

/**
 * Class factory: tag + baked-in `.layer` + `.configure`.
 *
 * @public
 */
export const Service = <Self, T, A, E = never>() =>
<const Name extends string>(
  name: Name,
  config: RunResourceConfig<T, A, E>,
) => {
  const defaultSpec = { ...config, name };
  const base = Context.Service<Self, RunResourceHandle<T, A, E>>()(name);
  const buildHandle = foldConfiguredSpec(name, defaultSpec).pipe(
    Effect.flatMap(internal.makeRunResourceHandleEffect),
  );
  return Object.assign(base, {
    defaultSpec,
    configure: (patch: ConfigPatch<RunResourceConfig<T, A, E>>) =>
      configureLayer(name, patch),
    wrapGate: (
      fn: (
        previous: RunResourceConfig<T, A, E>["effect"],
      ) => RunResourceConfig<T, A, E>["effect"],
    ) => configureWrapEffectField(name, fn),
    layer: Layer.effect(base)(buildHandle),
    run: makeStaticRun(base),
  });
};

/**
 * Class factory: identity tag only — pair with {@link layer}.
 *
 * @public
 */
export const Tag = <Self, T, A, E = never>() =>
<const Name extends string>(name: Name) => {
  const base = Context.Service<Self, RunResourceHandle<T, A, E>>()(name);
  return Object.assign(base, { run: makeStaticRun(base) });
};

/**
 * Generic runner tag + layer — no observation, no handle shape.
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
