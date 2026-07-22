/**
 * Layer-composed configuration for {@link Daemon.Service}, {@link WorkPool.Service},
 * and {@link Gate.Service}.
 *
 * @remarks
 * - **Defaults** live on the service factory (`defaultSpec` / factory config).
 * - **`configureLayer`** appends a {@link ConfigPatch} under a resource id (Context tag).
 * - The resource **`layer`** calls {@link foldConfiguredSpec} once at acquisition, then builds
 *   runtime state (for example {@link WorkPool}'s `makeQueueRuntime`).
 * - Patches are **not** hot-reloaded after the layer is built.
 * - **`Layer.provide` / `Layer.provideMerge` order** is ordinary Effect layering for patch/service
 *   conflicts. Soft Storage override is **not** “later wins”: provide the app
 *   {@link Store.Service} **into** the toolkit `layer` / `serve` (see `docs/guides/stores.md`).
 *
 * @module HyperlinkConfigure
 */

import { Context, Effect, Layer, Option } from "effect";

const effectFieldKey = "effect" as const;

type Callable = (...args: never) => unknown;

const isCallable = (value: unknown): value is Callable => typeof value === "function";

const isUnaryUpdater = <F>(
  patch: F | ((previous: F) => F),
): patch is (previous: F) => F => isCallable(patch) && patch.length === 1;

/**
 * Patch for a resource or process spec.
 *
 * - **Partial object** — shallow-merge fields; use a function value to replace a field.
 * - **`effect` field** — a **unary** function `(previous) => next` updates the prior worker /
 *   supervised body; a **multi-argument** function value replaces `effect` outright (queue workers
 *   stay two-argument).
 * - **Full reducer** — `(previous) => next` over the whole spec (see {@link configureLayer}).
 *
 * @category models
 * @public
 */
export type ConfigPatch<T> = PartialConfigPatch<T> | ((previous: T) => T);

type PartialConfigPatch<T> = {
  readonly [K in keyof T]?: PatchFieldValue<T, K>;
};

type PatchFieldValue<T, K extends keyof T> = T[K] extends Callable
  ? T[K] | ((previous: T[K]) => T[K])
  : T[K];

const applyEffectFieldPatch = <F>(
  previous: F,
  patch: F | ((previous: F) => F),
): F => (isUnaryUpdater(patch) ? patch(previous) : patch);

type SpecWithEffectField = { readonly effect: unknown };

const applyPartialPatch = <T extends object>(
  current: T,
  partial: PartialConfigPatch<T>,
): T => {
  let next = { ...current };
  for (const key of Object.keys(partial) as Array<keyof T>) {
    const patchValue = partial[key];
    if (patchValue === undefined) {
      continue;
    }
    if (key === effectFieldKey && effectFieldKey in current) {
      const previousEffect = (current as T & SpecWithEffectField).effect;
      next = {
        ...next,
        [effectFieldKey]: applyEffectFieldPatch(
          previousEffect,
          patchValue as PatchFieldValue<T & SpecWithEffectField, typeof effectFieldKey>,
        ),
      };
      continue;
    }
    next = { ...next, [key]: patchValue };
  }
  return next;
};

/**
 * Fold `base` and `patches` left-to-right; later patches see earlier results.
 *
 * @category combinators
 * @public
 */
export const foldConfig = <T extends object>(
  base: T,
  ...patches: ReadonlyArray<ConfigPatch<T> | undefined>
): T => {
  let current = base;
  for (const patch of patches) {
    if (patch === undefined) {
      continue;
    }
    current =
      typeof patch === "function"
        ? patch(current)
        : applyPartialPatch(current, patch);
  }
  return current;
};

const emptyPatches = <T extends object>(): ReadonlyArray<ConfigPatch<T>> => [];

/**
 * Context tag key for configure patches scoped to one resource id.
 *
 * @internal
 */
export const resourceConfigureTagKey = (resourceId: string): string =>
  `hyperlink-ts/HyperlinkConfigure/${resourceId}`;

const resourceConfigureTag = <T extends object>(resourceId: string) =>
  Context.Service<never, ReadonlyArray<ConfigPatch<T>>>()(
    resourceConfigureTagKey(resourceId),
  );

/**
 * All configure patches in context for `resourceId`, in merge order.
 *
 * @internal
 */
export const resourcePatches = <T extends object>(
  resourceId: string,
): Effect.Effect<ReadonlyArray<ConfigPatch<T>>> =>
  Effect.serviceOption(resourceConfigureTag<T>(resourceId)).pipe(
    Effect.map(Option.getOrElse(() => emptyPatches<T>())),
  );

/**
 * `Layer` that appends one configure patch for `resourceId`.
 *
 * Provide or merge with the resource `.layer` so patches are visible when that layer builds.
 *
 * @category layers & serving
 * @public
 */
export const configureLayer = <T extends object>(
  resourceId: string,
  patch: ConfigPatch<T>,
): Layer.Layer<never> => {
  const tag = resourceConfigureTag<T>(resourceId);
  return Layer.effect(
    tag,
    resourcePatches<T>(resourceId).pipe(
      Effect.map((existing) => [...existing, patch]),
    ),
  );
};

/**
 * Fold `defaultSpec` with all configure patches in context for `resourceId`.
 *
 * @internal
 */
export const foldConfiguredSpec = <T extends object>(
  resourceId: string,
  defaultSpec: T,
): Effect.Effect<T> =>
  resourcePatches<T>(resourceId).pipe(
    Effect.map((patches) => foldConfig(defaultSpec, ...patches)),
  );

/**
 * {@link configureLayer} that replaces only `effect` via `fn(previous)`.
 *
 * @internal
 */
export const configureWrapEffectField = <
  T extends { readonly effect: F },
  F,
>(
  resourceId: string,
  fn: (previous: F) => F,
): Layer.Layer<never> =>
  configureLayer<T>(resourceId, (spec) => ({
    ...spec,
    effect: fn(spec.effect),
  }));

// Layer-composed configure patches for resource and process services. The module is the
// namespace (`import * as HyperlinkConfigure`): `configureLayer` / `foldConfig` /
// `foldConfiguredSpec` are the flat exports above; `tagKey` / `wrapEffectField` are aliased
// below so the namespace members match. Root imports match these bindings.

/**
 * Deterministic configure tag key for a resource id, aliased as `HyperlinkConfigure.tagKey`.
 *
 * @public
 */
export { resourceConfigureTagKey as tagKey };

/**
 * Wrap a configured spec's `effect` field, aliased as `HyperlinkConfigure.wrapEffectField`.
 *
 * @public
 */
export { configureWrapEffectField as wrapEffectField };
