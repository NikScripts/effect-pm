/**
 * Layer-composed configuration patches for resource and process services.
 *
 * @remarks
 * Defaults are declared on {@link QueueResource.Service}, {@link RunResource.Service},
 * and {@link Process.Service}. {@link configureLayer} returns a `Layer` that appends
 * patches; the resource `layer` folds patches once at acquisition (before runtime
 * construction such as {@link QueueResource}'s internal `makeQueueRuntime`).
 *
 * Patches are not hot-reloaded after start.
 *
 * @module ResourceConfigure
 */

import { Context, Effect, Layer, Option } from "effect";

/**
 * Patch for a resource/process spec: shallow partial fields, function updaters for
 * function-valued fields (e.g. `effect`), or a full-spec reducer.
 *
 * @public
 */
export type ConfigPatch<T> = PartialConfigPatch<T> | ((previous: T) => T);

type PartialConfigPatch<T> = {
  readonly [K in keyof T]?: PatchFieldValue<T, K>;
};

type PatchFieldValue<T, K extends keyof T> = T[K] extends (...args: never[]) => unknown
  ? T[K] | ((previous: T[K]) => T[K])
  : T[K];

const isFunction = (value: unknown): value is (...args: never) => unknown =>
  typeof value === "function";

const applyEffectPatch = <T extends object, K extends keyof T>(
  previousValue: T[K],
  patchValue: PatchFieldValue<T, K>,
): T[K] => {
  if (isFunction(patchValue) && !isFunction(previousValue)) {
    return (patchValue as (previous: T[K]) => T[K])(previousValue);
  }
  if (
    isFunction(patchValue) &&
    isFunction(previousValue) &&
    patchValue.length === 1 &&
    previousValue.length > 1
  ) {
    return (patchValue as (previous: T[K]) => T[K])(previousValue);
  }
  return patchValue as T[K];
};

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
    next = {
      ...next,
      [key]:
        key === "effect"
          ? applyEffectPatch(current[key], patchValue as PatchFieldValue<T, typeof key>)
          : patchValue,
    };
  }
  return next;
};

/**
 * Fold default spec and patches left-to-right (later patches see earlier results).
 *
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

/**
 * Context tag key for configure patches scoped to one resource id.
 *
 * @internal
 */
export const resourceConfigureTagKey = (resourceId: string): string =>
  `@nikscripts/effect-pm/ResourceConfigure/${resourceId}`;

const resourceConfigureTag = <T extends object>(resourceId: string) =>
  Context.Service<never, ReadonlyArray<ConfigPatch<T>>>()(
    resourceConfigureTagKey(resourceId),
  );

/**
 * Collect all configure patches provided for a resource id in the current context.
 *
 * @internal
 */
export const resourcePatches = <T extends object>(
  resourceId: string,
): Effect.Effect<ReadonlyArray<ConfigPatch<T>>> =>
  Effect.map(
    Effect.serviceOption(resourceConfigureTag<T>(resourceId)),
    (option) => Option.getOrElse(option, () => [] as ReadonlyArray<ConfigPatch<T>>),
  );

/**
 * Build a `Layer` that appends one configure patch for a resource id.
 *
 * Merge or `Layer.provide` this alongside the resource `layer` so patches are
 * visible when the resource layer is built.
 *
 * @public
 */
export const configureLayer = <T extends object>(
  resourceId: string,
  patch: ConfigPatch<T>,
): Layer.Layer<never> =>
  Layer.effect(
    resourceConfigureTag<T>(resourceId),
    Effect.map(
      Effect.serviceOption(resourceConfigureTag<T>(resourceId)),
      (existing): ReadonlyArray<ConfigPatch<T>> => [
        ...Option.getOrElse(existing, () => [] as ReadonlyArray<ConfigPatch<T>>),
        patch,
      ],
    ),
  );

/**
 * Fold the default spec with all configure patches in context for a resource id.
 *
 * @internal
 */
export const foldConfiguredSpec = <T extends object>(
  resourceId: string,
  defaultSpec: T,
): Effect.Effect<T> =>
  Effect.map(resourcePatches<T>(resourceId), (patches) =>
    foldConfig(defaultSpec, ...patches),
  );
