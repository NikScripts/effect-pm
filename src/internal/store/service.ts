/**
 * Internal factory powering {@link ProcessStoreBuilder.Service}.
 *
 * Each facet declares one `record` section (writes) and one `read` section
 * (queries) over a shared {@link ProcessStoreSpine}. The factory:
 *
 * - Builds the spine **once** per layer instantiation.
 * - Returns a `Context.ServiceClass` whose `Shape` is the **inferred**
 *   intersection of the record-section emit API and the read-section read API
 *   (no separate `Api` interface needed on the facet side).
 * - Attaches **static optional emitters** for every `record*` key: callers can
 *   invoke `FacetTag.recordX(...)` whether or not the facet layer is composed
 *   (silent no-op when absent, persistent write when present).
 * - Wraps every static emitter with a built-in
 *   `catchCause + Effect.logWarning` swallow so write failures never escape
 *   into the gated effect's success/error channel.
 *
 * @module ProcessStoreService
 * @internal
 */

import { Cause, Clock, Context, Effect, Layer, Option } from "effect";
import type { ProcessStoreWriteError } from "../../ProcessStoreEvent";
import { RuntimeStorage } from "../../RuntimeStorage";
import { makeProcessStoreSpine, makeRunId, type ProcessStoreSpine } from "./spine";

const RECORD_TAG = "ProcessStore/record" as const;
const READ_TAG = "ProcessStore/read" as const;

type PersistEffect = Effect.Effect<void, ProcessStoreWriteError>;

type EmitEffect = Effect.Effect<void>;

type EmitMethod<F> = F extends (...args: infer A) => unknown
  ? (...args: A) => EmitEffect
  : never;

/**
 * Record (write) section of a facet.
 *
 * @internal
 */
export interface ProcessStoreRecordSection<EmitApi> {
  readonly _tag: typeof RECORD_TAG;
  readonly fn: (s: ProcessStoreSpine) => EmitApi;
  readonly emitKeys: ReadonlyArray<string>;
}

/**
 * Read (query) section of a facet.
 *
 * @internal
 */
export interface ProcessStoreReadSection<ReadApi> {
  readonly _tag: typeof READ_TAG;
  readonly fn: (s: ProcessStoreSpine) => ReadApi;
}

const stubSpine = (): ProcessStoreSpine => ({
  append: () => Effect.void,
  appendBatch: () => Effect.void,
  events: () => Effect.succeed([]),
  records: () => Effect.succeed([]),
});

/** @internal */
export const processStoreRecord = <EmitApi>(
  fn: (s: ProcessStoreSpine) => EmitApi,
): ProcessStoreRecordSection<EmitApi> => {
  // The probe call captures the runtime method names so the static-emitter
  // loop doesn't need a hand-maintained key list. `fn` always returns an
  // EmitApi-shaped object at runtime; the internal cast bridges the gap
  // between the structural object and `Object.keys`.
  const probe = fn(stubSpine()) as Record<string, unknown>;
  return {
    _tag: RECORD_TAG,
    fn,
    emitKeys: Object.keys(probe),
  };
};

/** @internal */
export const processStoreRead = <ReadApi>(
  fn: (s: ProcessStoreSpine) => ReadApi,
): ProcessStoreReadSection<ReadApi> => ({
  _tag: READ_TAG,
  fn,
});

const buildStore = Effect.gen(function* () {
  const storage = yield* RuntimeStorage;
  const now = yield* Clock.currentTimeMillis;
  return makeProcessStoreSpine(storage, makeRunId(now));
});

/**
 * Optional emit shortcuts derived from a record-section's `EmitApi` shape — one
 * `(...args) => Effect<void>` per writer method.
 *
 * @internal
 */
export type OptionalEmitStatics<EmitApi> = {
  readonly [K in keyof EmitApi & string]: EmitMethod<EmitApi[K]>;
};

/**
 * Public shape of a facet class built by {@link defineProcessStoreService} —
 * the underlying `Context.ServiceClass` plus the two layer accessors, the
 * inferred static emit shortcuts, and two **type-only phantom statics**
 * (`Type` and `EmitType`) used by the sibling namespace block on each facet
 * to expose `<Facet>.Type` / `<Facet>.EmitType` as nominal type aliases.
 *
 * The phantoms exist only at the type level — accessing them at runtime
 * returns `undefined`. They are never read at runtime; their sole job is to
 * let `typeof Facet.Type` resolve to the shape without going through a
 * conditional-inference extractor (which TypeScript struggles to follow
 * through `Context.ServiceClass`'s `in out` variance markers when the user
 * extends the factory return type).
 *
 * @internal
 */
export type ProcessStoreServiceClass<
  Self,
  Id extends string,
  EmitApi,
  ReadApi,
> = Context.ServiceClass<Self, Id, EmitApi & ReadApi> & {
  readonly make: Effect.Effect<EmitApi & ReadApi, never, RuntimeStorage>;
  readonly layerRuntimeStorage: Layer.Layer<Self, never, RuntimeStorage>;
  readonly layer: Layer.Layer<Self, never, never>;
  /** Phantom type accessor — read via `typeof Facet.Type`, never at runtime. */
  readonly Type: EmitApi & ReadApi;
  /** Phantom emit-shape accessor — read via `typeof Facet.EmitType`. */
  readonly EmitType: EmitApi;
} & OptionalEmitStatics<EmitApi>;

/**
 * Extract the full service shape (`EmitApi & ReadApi`) from a facet class via
 * its `Type` phantom static.
 *
 * @internal
 */
export type ProcessStoreServiceShape<T> = T extends { readonly Type: infer S }
  ? S
  : never;

/**
 * Extract the record-section emit shape from a facet class via its `EmitType`
 * phantom static.
 *
 * @internal
 */
export type ProcessStoreServiceEmitShape<T> = T extends {
  readonly EmitType: infer E;
}
  ? E
  : never;

const wrapEmitForFacet = (id: string, method: string) =>
  (effect: PersistEffect): EmitEffect =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(`${id} write failed for ${method}`).pipe(
          Effect.annotateLogs("cause", Cause.pretty(cause)),
        ),
      ),
      Effect.asVoid,
    );

/** @internal */
export const defineProcessStoreService = <Self>() =>
  <const Id extends string, EmitApi, ReadApi>(
    id: Id,
    recordSection: ProcessStoreRecordSection<EmitApi>,
    readSection: ProcessStoreReadSection<ReadApi>,
  ): ProcessStoreServiceClass<Self, Id, EmitApi, ReadApi> => {
    // Both sections share a single spine (one `RuntimeStorage` resolution per
    // layer instantiation). The merged object IS the service value.
    const make: Effect.Effect<EmitApi & ReadApi, never, RuntimeStorage> = Effect.gen(
      function* () {
        const s = yield* buildStore;
        const recordPart = recordSection.fn(s) as Record<string, unknown>;
        const readPart = readSection.fn(s) as Record<string, unknown>;
        return { ...recordPart, ...readPart } as EmitApi & ReadApi;
      },
    );

    const Base = Context.Service<Self, EmitApi & ReadApi>()(id, { make });

    // Each record key gets a static emit shortcut on the class itself.
    // Calling `Facet.recordX(arg)` no-ops when the facet is absent, forwards
    // to the service method when present, and swallows write failures with a
    // warning log so observation never leaks into the caller's error channel.
    const emitStatics: Record<string, unknown> = {};
    for (const emitKey of recordSection.emitKeys) {
      const wrap = wrapEmitForFacet(id, emitKey);
      emitStatics[emitKey] = (...args: Array<unknown>): EmitEffect =>
        wrap(
          Effect.serviceOption(Base).pipe(
            Effect.flatMap(
              Option.match({
                onNone: (): PersistEffect => Effect.void,
                onSome: (api): PersistEffect => {
                  const method = (api as Record<string, unknown>)[emitKey];
                  if (typeof method !== "function") {
                    return Effect.die(
                      `ProcessStore emit method missing: ${emitKey}`,
                    );
                  }
                  return (
                    method as (...a: Array<unknown>) => PersistEffect
                  ).apply(api, args);
                },
              }),
            ),
          ),
        );
    }

    const layerRuntimeStorage = Layer.effect(Base, make);
    const layer = Layer.provide(layerRuntimeStorage, RuntimeStorage.layer);

    // Runtime keys on the assembled object match `OptionalEmitStatics<EmitApi>`
    // by construction (they come from `recordSection.emitKeys`), but TS can't
    // verify that link across the dynamic `Object.assign`. One documented
    // internal cast bridges the dynamic assembly to the typed class.
    return Object.assign(
      Base,
      { layerRuntimeStorage, layer },
      emitStatics,
    ) as unknown as ProcessStoreServiceClass<Self, Id, EmitApi, ReadApi>;
  };
