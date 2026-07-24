/**
 * Gate — concurrency gate for effects.
 *
 * Wraps any effect with bounded concurrency via `Semaphore`. Unlike
 * {@link WorkPool}, there are no queues, priorities, or background workers —
 * the gate is applied inline at the call site. Each `run` acquires a permit,
 * executes the effect, and releases the permit on completion.
 *
 * ## Entry points
 *
 * | Function | Purpose |
 * |----------|---------|
 * | `Gate.make` | Scoped handle with `.run` only (no Subscribables exposed) |
 * | `Gate.layer` | Builds a `Layer` from tag + config (observable handle) |
 * | `Gate.serve` / `serveRemote` | RPC server layers (same config as {@link layer}) |
 * | `Gate.Service` | Tag + baked-in `.layer` + `.configure` |
 * | `Gate.Tag` | Identity tag + wire schemas — pair with {@link layer} |
 * | `Gate.configure` | Config patch layer for a tag (Tag path) |
 * | `Gate.store` | Register built-in run facts + state history on an app {@link Store.Service} |
 * | `Gate.makeRunner` | Generic runner (wraps arbitrary effects) |
 *
 * ## Store provision
 *
 * {@link layer}, {@link serve}, and {@link serveRemote} soft-default {@link Store.layerDefaultMemory}
 * via {@link Store.withDefaultStorage} — **R is fulfilled** out of the box. Override by providing
 * your {@link Store.Service} into the toolkit layer so Soft unwrap captures that bridge:
 *
 * ```ts
 * Gate.layer(Tag, config).pipe(Layer.provideMerge(AppStore.layer({ filename })))
 * ```
 *
 * {@link layerMemory} / {@link serveMemory} / {@link serveRemoteMemory} are aliases of the same
 * soft-default. {@link make} still needs {@link Store.Storage} on the effect (see tests).
 *
 * ## Remote usage
 *
 * Declare wire schemas on the tag, then serve or connect like {@link WorkPool} / {@link Daemon}:
 *
 * ```ts
 * class FetchGate extends Gate.Tag<FetchGate>()("@app/FetchGate", {
 *   payload: SymbolSchema,
 *   success: PriceSchema,
 *   error: FetchErrSchema,
 * }) {}
 *
 * // unit gate — bare effect, wire slots default to Void / Never
 * class Tick extends Gate.Service<Tick>()("@app/Tick", {
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
 * @module Gate
 */

import { Context, Effect, Layer, Schema, Scope } from "effect";
import * as Hyperlink from "./Hyperlink";
import type {
  Driver,
  HandlerContextOf,
  ImplOf,
  Local,
  HyperlinkTag,
} from "./Hyperlink";
import { facetStoreRegistration } from "./internal/store/facetStore";
import {
  makeGateStoreAnalyticsContract,
  type GateStoreAnalyticsContract,
} from "./internal/store/gateStoreSpec";
import type { StoreShapes } from "./internal/store/contractDef";
import type { StoreScopeTag } from "./internal/store/registration";
import {
  configureLayer,
  configureWrapEffectField,
  foldConfiguredSpec,
  type ConfigPatch,
} from "./HyperlinkConfigure";
import * as internal from "./internal/gate";
import { stampRunWireSchemas } from "./internal/gateTagSchemas";
import * as Store from "./Store";
import {
  runGateStatus,
  runSpec,
  type RunInstanceSpec,
} from "./internal/gateSchema";

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
 * @category utils
 * @public
 */
export const kind = "hyperlink-ts/Gate";

/**
 * Build a run-gate **instance** spec from wire schemas — pass to {@link Hyperlink.Tag} or use via
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
 * @category models
 * @public
 */
export type RunGateStatus = internal.RunGateStatus;

/**
 * Minimal handle from {@link Gate.make} — `.run` only.
 *
 * @category models
 * @public
 */
export type RunGateHandle<T, A, E> = internal.RunGateHandle<T, A, E>;

/**
 * Observable handle from {@link Gate.make} with observation disabled, or the local-only
 * engine handle. Prefer the toolkit service from {@link Tag} / {@link Service} for RPC.
 *
 * @category models
 * @public
 */
export type GateHandle<T, A, E> = internal.GateHandle<T, A, E>;

/**
 * A run-gate handle — the value `yield* MyRun` produces. The **named** compact form of a run gate's
 * service (both the light `Tag` path and the engine-included `Service` path yield this one type), so it
 * hovers as `Gate<Ticket, Price>` instead of the expanded `ServiceOf<…>` member wall; the docs
 * popover / prettify-ts expand it to the full shape on demand.
 *
 * @typeParam Payload - the decoded gate input (`run(input)`; `void` → the gate is a bare {@link Effect})
 * @typeParam Success - the gated effect's success value
 * @typeParam Error - the gated effect's failure channel
 * @typeParam Requirements - the transport requirement (`never` for a local `yield*`, the `Protocol` for
 *   a remote {@link Hyperlink.client})
 *
 * @category models
 * @public
 */
export interface Gate<
  Payload,
  Success = void,
  Error = never,
  Requirements = never,
> {
  /** Live gate counters (waiting / in-flight / completed / failed / interrupted / durations). */
  readonly status: Hyperlink.Subscribable<RunGateStatus>;
  /** Count of runs waiting for a concurrency permit. */
  readonly waiting: Hyperlink.Subscribable<number>;
  /** Count of runs currently executing. */
  readonly inFlight: Hyperlink.Subscribable<number>;
  /** Count of runs that completed successfully. */
  readonly completed: Hyperlink.Subscribable<number>;
  /** Count of runs that failed (excluding interrupts). */
  readonly failed: Hyperlink.Subscribable<number>;
  /** Count of runs interrupted while waiting or executing. */
  readonly interrupted: Hyperlink.Subscribable<number>;
  /**
   * Acquire a permit, run the gated effect, release the permit on completion. A unit gate (`void`
   * input) is a bare {@link Effect}; a parameterized gate is `(input) => Effect`.
   */
  readonly run: [Payload] extends [void]
    ? Effect.Effect<Success, Error, Requirements>
    : (input: Payload) => Effect.Effect<Success, Error, Requirements>;
}

/**
 * Static `.run` shortcut on {@link Tag} / {@link Service} — adds the tag to `R`.
 *
 * @category models
 * @public
 */
export type GateStaticRun<I, A, E, Self> = [Schema.Schema.Type<I>] extends [void]
  ? Effect.Effect<A, E, Self>
  : (input: Schema.Schema.Type<I>) => Effect.Effect<A, E, Self>;

/**
 * Service factory result — tag surface plus baked-in layer and configure helpers.
 *
 * @category models
 * @public
 */
export interface GateServiceDefinition<
  Self,
  Name extends string,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
> extends GateTagDefinition<Self, I, A, E> {
  readonly defaultSpec: GateServiceConfig<I, A, E, R> & { readonly name: Name };
  readonly layer: Layer.Layer<Self | Store.Storage, never, R>;
  readonly configure: (
    patch: ConfigPatch<
      GateLayerConfig<
        Schema.Schema.Type<I>,
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>,
        R
      >
    >,
  ) => Layer.Layer<never>;
  readonly wrapGate: (
    fn: (
      previous: GateLayerConfig<
        Schema.Schema.Type<I>,
        Schema.Schema.Type<A>,
        Schema.Schema.Type<E>,
        R
      >["effect"],
    ) => GateLayerConfig<
      Schema.Schema.Type<I>,
      Schema.Schema.Type<A>,
      Schema.Schema.Type<E>,
      R
    >["effect"],
  ) => Layer.Layer<never>;
}

/**
 * Tag + static `.run` shortcut, whose service value is the **named** {@link Gate} handle (via the
 * `Svc` seam on {@link HyperlinkTag}), so `yield* MyRun` hovers as `Gate<Ticket, Price>` rather
 * than the expanded `ServiceOf<…>` wall. @internal
 */
type RunTagWithStaticRun<
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> = HyperlinkTag<
  Self,
  RunInstanceSpec<I, A, E>,
  Gate<Hyperlink.Decoded<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>>
> & {
  readonly run: GateStaticRun<I, A, E, Self>;
};

/**
 * Tag factory result — Hyperlink tag + wire schemas + static {@link GateStaticRun}.
 *
 * @category models
 * @public
 */
export type GateTagDefinition<
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> = RunTagWithStaticRun<Self, I, A, E>;

/**
 * Wire schemas shared by {@link Tag} and {@link Service}.
 *
 * @category models
 * @public
 */
export interface GateWireSchemas<
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
 * @category models
 * @public
 */
export interface GateTagSchemas<
  I extends Schema.Top = Schema.Top,
  A extends Schema.Top = Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
> extends GateWireSchemas<I, A, E> {
  readonly description?: string;
}

/**
 * Gated effect for {@link layer} / {@link serve} — unit gates (`void` input) accept a bare
 * {@link Effect.Effect} or `() => Effect`; parameterized gates use `(input) => Effect`.
 *
 * @category models
 * @public
 */
export type GateLayerEffect<I, A, E, R> = [I] extends [void]
  ? Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)
  : (input: I) => Effect.Effect<A, E, R>;

/**
 * Gated effect for {@link Service} — same rules as {@link GateLayerEffect} at the decoded type.
 *
 * @category models
 * @public
 */
export type GateServiceEffect<
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
 * @category models
 * @public
 */
export interface GateServiceConfig<
  I extends Schema.Top = typeof Schema.Void,
  A extends Schema.Top = typeof Schema.Void,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
> extends GateWireSchemas<I, A, E> {
  /** Unit gates may pass a bare effect; parameterized gates use `(input) => Effect`. */
  readonly effect: GateServiceEffect<I, A, E, R>;
  /**
   * Max concurrent executions through this gate.
   * @default 1
   */
  readonly concurrency?: number;
}

/**
 * Layer / serve config — the tag carries wire schemas; this supplies the gated effect.
 *
 * @category models
 * @public
 */
export interface GateLayerConfig<I, A, E, R> {
  /** Override telemetry / status `resourceId`; defaults to the tag key. */
  readonly name?: string;
  /** Unit gates may pass a bare effect; parameterized gates use `(input) => Effect`. */
  readonly effect: GateLayerEffect<I, A, E, R>;
  /**
   * Max concurrent executions through this gate.
   * @default 1
   */
  readonly concurrency?: number;
}

/**
 * Configuration for {@link Gate.make} — local scoped handle, no RPC.
 *
 * @category models
 * @public
 */
export interface GateConfig<T, A, E> {
  readonly name?: string;
  readonly effect: (input: T) => Effect.Effect<A, E>;
  readonly concurrency?: number;
}

/**
 * Configuration for {@link Gate.makeRunner}.
 *
 * @category models
 * @public
 */
export interface GateRunnerConfig {
  readonly name?: string;
  readonly concurrency?: number;
}

/**
 * A generic runner that wraps any effect with concurrency gating.
 *
 * @category models
 * @public
 */
export type GateRunner = internal.GateRunner;

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Resolve an optional wire schema to its {@link Schema.Void} default while keeping the caller's `S`
 * clean: the public overload returns `S` (not the `S | typeof Schema.Void` union a bare `?? Schema.Void`
 * yields). Sound — a caller whose `S` is not `typeof Schema.Void` always supplies the schema (the type
 * param is inferred from it), so the `?? Schema.Void` branch runs only when `S` really is
 * `typeof Schema.Void`. A function-overload narrowing — no cast. @internal
 */
function withVoidDefault<S extends Schema.Top>(schema: S | undefined): S;
function withVoidDefault(schema: Schema.Top | undefined): Schema.Top {
  return schema ?? Schema.Void;
}

/** Mirror of {@link withVoidDefault} for the wire **error** schema (default {@link Schema.Never}). @internal */
function withNeverDefault<S extends Schema.Top>(schema: S | undefined): S;
function withNeverDefault(schema: Schema.Top | undefined): Schema.Top {
  return schema ?? Schema.Never;
}

/** Resolved wire schemas with RPC defaults applied. @internal */
const resolveRunWireSchemas = <
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  config: GateWireSchemas<I, A, E>,
): { readonly payload: I; readonly success: A; readonly error: E } => ({
  payload: withVoidDefault(config.payload),
  success: withVoidDefault(config.success),
  error: withNeverDefault(config.error),
});

/** Normalize bare unit-gate effects and thunk forms into `(input) => Effect`. @internal */
const toRunFn = <I, A, E, R>(
  effect: GateLayerEffect<I, A, E, R>,
): ((input: I) => Effect.Effect<A, E, R>) => {
  if (Effect.isEffect(effect)) {
    return (() => effect) as (input: I) => Effect.Effect<A, E, R>;
  }
  return effect as (input: I) => Effect.Effect<A, E, R>;
};

/**
 * Build the tag's static `.run` shortcut. Whether the gate is inputless (a bare {@link Effect}) or
 * parameterized (`(input) => Effect`) is decided by the resolved `payload` schema — no spec
 * introspection. Returns the concrete Effect-or-function union; {@link nameRunService}'s single cast
 * later blesses it as the deferred `GateStaticRun` conditional (which TS can't reduce for
 * generic params), so this builder needs no return cast. @internal
 */
const makeStaticRun = <
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  // Svc is left open (`any`) so the pre-naming `ServiceOf` tag (from {@link materializeRunTag}) is
  // accepted; `svc.run` is read below through a concrete union regardless. The result — a bare Effect
  // (unit) or an input function (parameterized) — is blessed as the deferred `GateStaticRun`
  // conditional by {@link nameRunService}'s single cast, so this builder needs no return cast.
  tag: HyperlinkTag<Self, RunInstanceSpec<I, A, E>, any>,
  payload: Schema.Top,
):
  | Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>, Self>
  | ((
      input: Schema.Schema.Type<I>,
    ) => Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>, Self>) => {
  type Out = Schema.Schema.Type<A>;
  type Err = Schema.Schema.Type<E>;
  // The gate's `run` is a deferred `[void] extends …` conditional — a bare Effect (unit) or an input
  // function (parameterized) — that TS can't reduce for generic params, so it is read through this one
  // documented boundary. The `Effect.isEffect` guard picks the runtime form, so both callers are safe.
  const runOf = (svc: { readonly run: unknown }) =>
    svc.run as
      | Effect.Effect<Out, Err>
      | ((input: unknown) => Effect.Effect<Out, Err>);
  const inputless: Effect.Effect<Out, Err, Self> = Effect.flatMap(tag, (svc) => {
    const run = runOf(svc);
    return Effect.isEffect(run) ? run : run(undefined);
  });
  const parameterized = (
    input: Schema.Schema.Type<I>,
  ): Effect.Effect<Out, Err, Self> =>
    Effect.flatMap(tag, (svc) => {
      const run = runOf(svc);
      return Effect.isEffect(run) ? run : run(input);
    });
  return payload === Schema.Void ? inputless : parameterized;
};

const isRunTagSchemaConfig = (value: unknown): value is GateTagSchemas =>
  typeof value === "object" && value !== null && !Schema.isSchema(value);

/**
 * Name the built run-gate tag's service as {@link Gate}. The single deliberate cast in this
 * module: `ServiceOf<RunInstanceSpec<I, A, E>>` and
 * `Gate<Decoded<I>, A["Type"], E["Type"], never>` are **mutually assignable** — proven
 * bidirectionally in `test/run-handle.test-d.ts` — but TS can't verify that equality for *generic*
 * params at the invariant service-`Shape` position, so the generic factory needs one assertion here.
 * The `.test-d.ts` is the soundness guard: if the shapes ever drift, it fails the build. @internal
 */
const nameRunService = <
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top,
>(
  // `run` is accepted loosely (the concrete Effect/function {@link makeStaticRun} builds): this one cast
  // blesses both the invariant service `Shape` (`ServiceOf ⇄ Gate`) *and* the static `.run`'s
  // deferred `[void] extends …` conditional in a single boundary.
  tag: HyperlinkTag<Self, RunInstanceSpec<I, A, E>> & { readonly run: unknown },
): RunTagWithStaticRun<Self, I, A, E> =>
  tag as unknown as RunTagWithStaticRun<Self, I, A, E>;

// Two-stage (`<Self>()` then the config): `Self` is provided by the caller (the outer `runTag<Self>`),
// so it is never left to infer from arguments — where it appears only in the return position and would
// resolve to `unknown`, leaking an unprovidable `unknown` requirement onto the tag's static `.run`
// (`Effect<…, Self>`) and tripping effect-LSP `missingEffectContext`. `I`/`A`/`E` still infer from the
// config in the second stage. @internal
const materializeRunTag = <Self>() =>
  <
    I extends Schema.Top = typeof Schema.Void,
    A extends Schema.Top = typeof Schema.Void,
    E extends Schema.Top = typeof Schema.Never,
  >(
    key: string,
    config: GateTagSchemas<I, A, E>,
  ): RunTagWithStaticRun<Self, I, A, E> => {
    const resolved = resolveRunWireSchemas(config);
    const spec = runSpec(resolved.payload, resolved.success, resolved.error);
    const tag = Hyperlink.Tag<Self>()(key, spec, {
      description: config.description,
      kind,
    });
    const ready = Hyperlink.withReadiness(tag, (svc) =>
      Effect.map(svc.status.get, () => ({ ready: true })),
    );
    const stamped = stampRunWireSchemas(ready, {
      success: config.success,
      error: config.error,
    });
    return nameRunService(
      Object.assign(stamped, { run: makeStaticRun(stamped, resolved.payload) }),
    );
  };

/**
 * Define a run (concurrency-gated effect) as a named service {@link Tag}:
 * `class Backup extends Gate.Tag<Backup>()("@app/Backup", { payload: ArgsSchema }) {}`. The
 * class *is* the Tag — `yield* Backup` resolves the {@link Gate} handle (its `.run` applies
 * the bounded-concurrency gate inline), while {@link layer} provides it and {@link serve} exposes it
 * over RPC. `payload` is the argument schema; optional `success` / `error` declare the result and
 * failure wire schemas.
 *
 * @public
 * @category constructors
 */
const runTag = <Self>() => {
  function build(key: string): RunTagWithStaticRun<Self, typeof Schema.Void, typeof Schema.Void, typeof Schema.Never>;
  function build<
    I extends Schema.Top,
    A extends Schema.Top,
    E extends Schema.Top = typeof Schema.Never,
  >(
    key: string,
    config: GateTagSchemas<I, A, E>,
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
    inputOrSchemas?: Schema.Top | GateTagSchemas,
    success?: Schema.Top,
    errorOrOptions?: Schema.Top | { readonly description?: string },
    maybeOptions?: { readonly description?: string },
  ): any {
    if (inputOrSchemas === undefined) {
      return materializeRunTag<Self>()(key, {});
    }
    if (isRunTagSchemaConfig(inputOrSchemas)) {
      return materializeRunTag<Self>()(key, inputOrSchemas);
    }
    const payload = inputOrSchemas;
    // `Schema.isSchema` is a type guard, so the 4th positional arg narrows cleanly into either the
    // `error` schema or the trailing `{ description }` options — no cast at either branch.
    const error =
      errorOrOptions !== undefined && Schema.isSchema(errorOrOptions)
        ? errorOrOptions
        : undefined;
    const options =
      errorOrOptions !== undefined && !Schema.isSchema(errorOrOptions)
        ? errorOrOptions
        : maybeOptions;
    return materializeRunTag<Self>()(key, {
      payload,
      success: success!,
      ...(error !== undefined ? { error } : {}),
      description: options?.description,
    });
  }
  return build;
};

/**
 * Whether the tag's `run` spec verb is an inputless unit gate — its `run` method carries no `payload`
 * (an inputless {@link Hyperlink.effect}) vs a parameterized {@link Hyperlink.effectFn}. A `LocalMethod`
 * has no `payload` field, so `"payload" in m` narrows the erased flat-spec member
 * (`AnyMethod | AnyLocalMethod`) to the wire {@link Hyperlink.Method} cast-free. @internal
 */
const runVerbIsInputless = (tag: {
  readonly [Hyperlink.specSym]: Hyperlink.FlatSpec;
}): boolean => {
  const method = tag[Hyperlink.specSym].run;
  return method !== undefined && "payload" in method && method.payload === undefined;
};

/**
 * Soft-default {@link Store.Storage} ({@link Store.withDefaultStorage}) — R fulfilled; override by
 * providing an app store into this layer. @internal
 */
const withDefaultStoreBridge = <A, E, R>(
  layer: Layer.Layer<A, E, R | Store.Storage>,
): Layer.Layer<A | Store.Storage, E, R> => Store.withDefaultStorage(layer);

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
  // Svc left open (`any`): the named {@link Gate} handle's `[Payload] extends [void]` `run`
  // conditional can't be reduced for generic params, so the redundant service slot (fully determined
  // by the pinned `RunInstanceSpec<I, A, E>`) is not re-checked here — the tag flows in cast-free.
  tag: HyperlinkTag<Self, RunInstanceSpec<I, A, E>, any>,
  config: GateLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
): Effect.Effect<
  Driver<RunInstanceSpec<I, A, E>, R>,
  never,
  R | Scope.Scope | Store.Storage
> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const provideR = <Out, Err>(
      effect: Effect.Effect<Out, Err, R>,
    ): Effect.Effect<Out, Err> => Effect.provide(effect, context);
    const effectiveConfig = yield* foldConfiguredSpec<
      GateLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>
    >(tag.key, { ...config, name: tag.key });
    const handle = yield* internal.makeGateHandleEffect({
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
    // The engine `handle.run` is a `[void] extends …` thunk for a unit gate (`() => Effect`) and an
    // input function otherwise; the contract's `run` wants a bare Effect (unit) or the same input
    // function. `Effect.suspend` lifts the unit thunk into a plain Effect; the parameterized form
    // passes through. Whether the gate is inputless is the tag's `run` spec verb — read cast-free via
    // {@link runVerbIsInputless}.
    const runImpl = runVerbIsInputless(tag)
      ? Effect.suspend(
          handle.run as () => Effect.Effect<Schema.Schema.Type<A>, Schema.Schema.Type<E>>,
        )
      : handle.run;

    // The observation members pass straight through (additive-only adapter); `run` is the engine→
    // contract boundary — the deferred unit-vs-parameterized conditional TS can't reduce for generic
    // params — so the assembled impl is typed at the {@link ImplOf} contract once here.
    const impl = {
      status: statusSub,
      waiting: handle.waiting,
      inFlight: handle.inFlight,
      completed: handle.completed,
      failed: handle.failed,
      interrupted: handle.interrupted,
      run: runImpl,
    } as Hyperlink.WithRequirement<ImplOf<RunInstanceSpec<I, A, E>>, R>;
    return Hyperlink.driver(tag, impl, context);
  });

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a scoped handle with `.run` only — no live observation, no RPC.
 *
 * @category constructors
 * @public
 */
export const make = internal.makeRunGateHandleEffect;

/**
 * Config-patch layer for a tag — merge with {@link layer} (Tag path).
 *
 * @category layers & serving
 * @public
 */
export const configure = <Self, I extends Schema.Top, A extends Schema.Top, E extends Schema.Top>(
  tag: HyperlinkTag<Self, RunInstanceSpec<I, A, E>, any>,
  patch: ConfigPatch<
    GateLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, never>
  >,
): Layer.Layer<never> => configureLayer(tag.key, patch);

/**
 * Build a `Layer` from a tag and config — yields an observable toolkit service.
 *
 * Soft-defaults {@link Store.Storage} (R fulfilled). Override with your app store:
 *
 * ```ts
 * Gate.layer(Tag, config).pipe(Layer.provideMerge(AppStore.layer({ filename })))
 * ```
 *
 * {@link layerMemory} is an alias for the same soft-default.
 *
 * @category layers & serving
 * @public
 */
export const layer = <
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: HyperlinkTag<Self, RunInstanceSpec<I, A, E>, any>,
  config: GateLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
): Layer.Layer<Self | Local<Self> | Store.Storage, never, R> =>
  withDefaultStoreBridge(
    Layer.unwrap(
      Effect.map(buildRunImpl(tag, config), (built) =>
        Hyperlink.layer(tag, Hyperlink.grantLocal(tag, built)),
      ),
    ),
  );

/**
 * Alias of {@link layer}.
 *
 * @category layers & serving
 * @public
 */
export const layerMemory = <
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: HyperlinkTag<Self, RunInstanceSpec<I, A, E>>,
  config: GateLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
): Layer.Layer<Self | Local<Self> | Store.Storage, never, R> =>
  layer(tag, config);

/**
 * Serve this run gate **remotely (served-only)** — RPC handlers without granting the local instance.
 *
 * Soft-defaults {@link Store.Storage}. Override with `Layer.provide` / `provideMerge(AppStore)`.
 *
 * @category layers & serving
 * @public
 */
export function serveRemote<
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: HyperlinkTag<Self, RunInstanceSpec<I, A, E>, any>,
  config: GateLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
): Layer.Layer<HandlerContextOf<RunInstanceSpec<I, A, E>> | Store.Storage, never, R>;
export function serveRemote(
  tag: HyperlinkTag<any, any, any>,
  config: GateLayerConfig<any, any, any, any>,
): Layer.Layer<any, any, any> {
  // Pin the loose impl-signature tag to its instance spec so `buildRunImpl`'s `Driver` and
  // `Hyperlink.serveRemote` line up cast-free (the `any` payload/success/error are fixed by the public
  // overload above). Mirrors `Daemon.serveRemote`.
  const baseTag: HyperlinkTag<any, RunInstanceSpec<any, any, any>> = tag;
  return withDefaultStoreBridge(
    Layer.unwrap(
      Effect.map(
        buildRunImpl(baseTag, config),
        (built) => Hyperlink.serveRemote(baseTag, built) as any,
      ),
    ) as any,
  ) as any;
}

/**
 * Alias of {@link serveRemote}.
 *
 * @category layers & serving
 * @public
 */
export function serveRemoteMemory<
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: HyperlinkTag<Self, RunInstanceSpec<I, A, E>>,
  config: GateLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
): Layer.Layer<HandlerContextOf<RunInstanceSpec<I, A, E>> | Store.Storage, never, R>;
export function serveRemoteMemory(
  tag: HyperlinkTag<any, any, any>,
  config: GateLayerConfig<any, any, any, any>,
): Layer.Layer<any, any, any> {
  return serveRemote(tag as any, config as any) as any;
}

/**
 * Serve this run gate **and** grant its local instance from one materialization.
 *
 * Soft-defaults {@link Store.Storage}. Override with `Layer.provide` / `provideMerge(AppStore)`.
 *
 * @category layers & serving
 * @public
 */
export function serve<
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: HyperlinkTag<Self, RunInstanceSpec<I, A, E>, any>,
  config: GateLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
): Layer.Layer<
  Self | Local<Self> | HandlerContextOf<RunInstanceSpec<I, A, E>> | Store.Storage,
  never,
  R
>;
export function serve(
  tag: HyperlinkTag<any, any, any>,
  config: GateLayerConfig<any, any, any, any>,
): Layer.Layer<any, any, any> {
  const baseTag: HyperlinkTag<any, RunInstanceSpec<any, any, any>> = tag;
  return withDefaultStoreBridge(
    Layer.unwrap(
      Effect.map(
        buildRunImpl(baseTag, config),
        (built) => Hyperlink.serve(baseTag, built) as any,
      ),
    ) as any,
  ) as any;
}

/**
 * Alias of {@link serve}.
 *
 * @category layers & serving
 * @public
 */
export function serveMemory<
  Self,
  I extends Schema.Top,
  A extends Schema.Top,
  E extends Schema.Top = typeof Schema.Never,
  R = never,
>(
  tag: HyperlinkTag<Self, RunInstanceSpec<I, A, E>>,
  config: GateLayerConfig<Schema.Schema.Type<I>, Schema.Schema.Type<A>, Schema.Schema.Type<E>, R>,
): Layer.Layer<
  Self | Local<Self> | HandlerContextOf<RunInstanceSpec<I, A, E>> | Store.Storage,
  never,
  R
>;
export function serveMemory(
  tag: HyperlinkTag<any, any, any>,
  config: GateLayerConfig<any, any, any, any>,
): Layer.Layer<any, any, any> {
  return serve(tag as any, config as any) as any;
}

/**
 * Class factory: tag + wire schemas + baked-in `.layer` + `.configure`.
 *
 * @category constructors
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
    config: GateServiceConfig<I, A, E, R>,
  ) {
    const wire = resolveRunWireSchemas(config);
    const tag = runTag<Self>()(name, config);
    const error = wire.error;
    const defaultSpec = { name, ...config, ...wire, error };
    const layerConfig: GateLayerConfig<
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
          GateLayerConfig<
            Schema.Schema.Type<I>,
            Schema.Schema.Type<A>,
            Schema.Schema.Type<E>,
            R
          >
        >,
      ) => configureLayer(name, patch),
      wrapGate: (
        fn: (
          previous: GateLayerConfig<
            Schema.Schema.Type<I>,
            Schema.Schema.Type<A>,
            Schema.Schema.Type<E>,
            R
          >["effect"],
        ) => GateLayerConfig<
          Schema.Schema.Type<I>,
          Schema.Schema.Type<A>,
          Schema.Schema.Type<E>,
          R
        >["effect"],
      ) => configureWrapEffectField(name, fn),
      layer: layer(tag, layerConfig),
      // `tag` already carries the named static `.run` (stamped by `materializeRunTag`), so it is not
      // re-set here — `Object.assign` preserves it.
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
 * @category layers & serving
 * @public
 */
export function store<const Tag extends StoreScopeTag>(tag: Tag): ReturnType<
  typeof facetStoreRegistration<Tag, GateStoreAnalyticsContract<Tag>>
>;
export function store<
  const Tag extends StoreScopeTag,
  const Shapes extends StoreShapes,
>(tag: Tag, extended: Shapes): ReturnType<
  typeof facetStoreRegistration<
    Tag,
    GateStoreAnalyticsContract<Tag>,
    Shapes
  >
>;
export function store(tag: StoreScopeTag, extended?: StoreShapes) {
  const contract = makeGateStoreAnalyticsContract(tag);
  return extended === undefined
    ? facetStoreRegistration(tag, contract)
    : facetStoreRegistration(tag, contract, extended);
}

/**
 * Generic runner tag + layer — no observation, no handle shape, no RPC.
 *
 * @category constructors
 * @public
 */
export const makeRunner = <const Name extends string>(
  config: GateRunnerConfig & { readonly name: Name },
) => {
  const tag = Context.Service<
    GateRunner & { readonly _tag: Name },
    GateRunner
  >(config.name);
  const runnerLayer = Layer.effect(tag)(internal.makeRunnerEffect(config));
  return Object.assign(tag, { layer: runnerLayer });
};

// ── HTTP API client ─────────────────────────────────────────────────────────
// A concurrency-gated typed HttpApiClient — the former HttpApiClient module folded into Gate.
// `httpApiClient` builds + gates the client from an HttpApi schema (a Semaphore gate over the
// HttpClient transport via HttpClientRunGate); the engine lives in ./internal/httpApiClient and is
// pulled in only when these are referenced.

export {
  make as httpApiClient,
  Service as httpApiClientService,
  layerEffect as httpApiClientLayer,
  acceptJson,
  instrumentEndpoints,
} from "./internal/httpApiClient";
export type {
  HttpApiClientConfig as HttpApiClientConfig,
  HttpApiClientLayerEffectConfig as HttpApiClientLayerEffectConfig,
} from "./internal/httpApiClient";
