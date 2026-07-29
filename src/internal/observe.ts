/**
 * Observe — unbound recipes / packs + bind. Name-mirrored by {@link ../Observe}.
 * @internal
 */
import {
  Cause,
  Duration,
  Effect,
  Predicate,
  Schedule,
  Stream,
  type Stream as StreamT,
} from "effect";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import {
  atom as hyperlinkAtom,
  fn as hyperlinkFn,
  query as hyperlinkQuery,
  channelKeyOf,
  type AtomTag,
  type LiveAtom,
} from "./atomHandle";

const edge = <T>(value: never): T => value;

const RecipeTypeId: unique symbol = Symbol.for("hyperlink/Observe/Recipe");
const PackTypeId: unique symbol = Symbol.for("hyperlink/Observe/Pack");

/** Bind context — caches parent recipe outputs so `map` shares one upstream atom. */
export type BindContext = {
  readonly runtime: Atom.AtomRuntime<never, never>;
  readonly tag: AtomTag<unknown, never>;
  readonly recipeOut: WeakMap<object, unknown>;
};

/** Unbound recipe. `_svc` is phantom so `Svc` stays in the type. */
export type Recipe<Svc, Out> = {
  readonly [RecipeTypeId]: typeof RecipeTypeId;
  readonly bind: (ctx: BindContext) => Out;
  readonly _svc?: Svc;
};

/** Unbound pack. `_svc` is phantom so `Svc` stays in the type. */
export type Pack<Svc, Out extends Record<string, unknown>> = {
  readonly [PackTypeId]: typeof PackTypeId;
  readonly bind: (ctx: BindContext) => Out;
  readonly _svc?: Svc;
  /** Optional stable id for HMR-safe memo (`Observe.named`). */
  readonly id?: string;
};

type FoldAtom<A> = Atom.Atom<
  AsyncResult.AsyncResult<A, Cause.NoSuchElementError>
>;

export type BoundOf<R> = R extends Recipe<infer _S, infer Out>
  ? Out
  : R extends Pack<infer _S, infer Out>
    ? Out
    : never;

type LiveSource<A, E = never> =
  | { readonly changes: StreamT.Stream<A, E> }
  | StreamT.Stream<A, E>;

const isRecipe = (u: unknown): u is Recipe<any, any> =>
  Predicate.hasProperty(u, RecipeTypeId);

const isPack = (u: unknown): u is Pack<any, any> =>
  Predicate.hasProperty(u, PackTypeId);

const isSubscribable = (
  u: unknown,
): u is { readonly get: unknown; readonly changes: StreamT.Stream<unknown, unknown> } =>
  Predicate.hasProperty(u, "get") &&
  Predicate.hasProperty(u, "changes") &&
  Effect.isEffect((u as { readonly get: unknown }).get) &&
  Stream.isStream((u as { readonly changes: unknown }).changes);

const toLiveStream = <A, E>(selected: LiveSource<A, E>): StreamT.Stream<A, E> => {
  if (Stream.isStream(selected)) return selected;
  if (isSubscribable(selected)) {
    return edge(selected.changes as never);
  }
  throw new Error(
    "Observe: select a Subscribable or Stream (e.g. q.status or q.metrics.stream)",
  );
};

const makeRecipe = <Svc, Out>(bind: (ctx: BindContext) => Out): Recipe<Svc, Out> => ({
  [RecipeTypeId]: RecipeTypeId,
  bind,
});

const makePack = <Svc, Out extends Record<string, unknown>>(
  bind: (ctx: BindContext) => Out,
  id?: string,
): Pack<Svc, Out> => ({
  [PackTypeId]: PackTypeId,
  bind,
  ...(id === undefined ? {} : { id }),
});

const runRecipe = <Svc, Out>(recipe: Recipe<Svc, Out>, ctx: BindContext): Out => {
  const existing = ctx.recipeOut.get(recipe);
  if (existing !== undefined) return existing as Out;
  const created = recipe.bind(ctx);
  ctx.recipeOut.set(recipe, created);
  return created;
};

const runField = <Svc>(
  field: Recipe<Svc, unknown> | Pack<Svc, Record<string, unknown>>,
  ctx: BindContext,
): unknown => {
  if (isPack(field)) return field.bind(ctx);
  if (isRecipe(field)) return runRecipe(field, ctx);
  throw new Error("Observe.struct: field must be a Recipe or Pack");
};

/**
 * Live Subscribable / Stream → `Atom<AsyncResult>` (unbound).
 */
export const atom = <Svc, A, E = never>(
  select: (svc: Svc) => LiveSource<A, E>,
): Recipe<Svc, LiveAtom<A, E>> =>
  makeRecipe((ctx) =>
    edge(
      hyperlinkAtom(ctx.runtime)(
        edge<AtomTag<Svc, never>>(ctx.tag as never),
        select,
      ) as never,
    ),
  );

/**
 * One-shot Effect read → `Atom<AsyncResult>` (unbound).
 */
export const query = <Svc, A, E = never>(
  select: (svc: Svc) => Effect.Effect<A, E>,
): Recipe<Svc, Atom.Atom<AsyncResult.AsyncResult<A, E>>> =>
  makeRecipe((ctx) =>
    edge(
      hyperlinkQuery(ctx.runtime)(
        edge<AtomTag<Svc, never>>(ctx.tag as never),
        select,
      ) as never,
    ),
  );

/**
 * Command → `AtomResultFn` (unbound).
 */
export const fn = <Svc, Arg = void, A = void, E = never>(
  select: (
    svc: Svc,
  ) => Effect.Effect<A, E> | ((arg: Arg) => Effect.Effect<A, E>),
): Recipe<Svc, Atom.AtomResultFn<Arg, A, E>> =>
  makeRecipe((ctx) =>
    edge(
      hyperlinkFn(ctx.runtime)(
        edge<AtomTag<Svc, never>>(ctx.tag as never),
        select,
      ) as never,
    ),
  );

export type FoldOptions<Svc, I, Acc> = {
  readonly initial: (tag: { readonly key: string }) => Acc;
  readonly step: (acc: Acc, item: I) => Acc;
  readonly tap?: (acc: Acc, tag: { readonly key: string }) => void;
  readonly seed?: (svc: Svc) => Effect.Effect<ReadonlyArray<I>>;
  /** Cache key for atom identity (defaults to select channel path). */
  readonly channel?: (tag: { readonly key: string }) => string;
};

/**
 * Fold a live stream (optional seed prefix) into one atom — shared parent for {@link map}.
 */
export const fold = <Svc, I, Acc>(
  select: (svc: Svc) => LiveSource<I, never>,
  options: FoldOptions<Svc, I, Acc>,
): Recipe<Svc, FoldAtom<Acc>> =>
  makeRecipe((ctx) => {
    const tag = edge<AtomTag<Svc, never>>(ctx.tag as never);
    const key =
      options.channel?.(tag) ?? `fold:${channelKeyOf(tag.key, select as never)}`;
    let map = foldCache.get(ctx.runtime);
    if (map === undefined) {
      map = new Map();
      foldCache.set(ctx.runtime, map);
    }
    const hit = map.get(`${tag.key}::${key}`);
    if (hit !== undefined) return edge(hit as never);

    const live = Stream.unwrap(Effect.map(tag, (svc) => toLiveStream(select(svc))));
    const seeded =
      options.seed === undefined
        ? live
        : Stream.concat(
            Stream.unwrap(
              Effect.flatMap(tag, (svc) => options.seed!(svc)).pipe(
                Effect.map((items) => Stream.fromIterable(items)),
              ),
            ),
            live,
          );
    const scanned = seeded.pipe(Stream.scan(options.initial(tag), options.step));
    const stream =
      options.tap === undefined
        ? scanned
        : scanned.pipe(Stream.tap((acc) => Effect.sync(() => options.tap!(acc, tag))));
    const created = ctx.runtime.atom(stream);
    map.set(`${tag.key}::${key}`, created);
    return edge(created as never);
  });

const foldCache = new WeakMap<object, Map<string, Atom.Atom<unknown>>>();

export type ScanOptions<Svc, I, A> = {
  readonly map: (item: I) => A;
  readonly cap: number;
  readonly cacheKey?: (tag: { readonly key: string }) => string;
  readonly seed?: (svc: Svc) => Effect.Effect<ReadonlyArray<I>>;
  readonly cache?: {
    readonly read: (key: string) => ReadonlyArray<A> | undefined;
    readonly write: (key: string, items: ReadonlyArray<A>) => void;
  };
};

/**
 * Scan a stream into a capped history array (optional local cache + seed).
 */
export const scan = <Svc, I, A>(
  select: (svc: Svc) => LiveSource<I, never>,
  options: ScanOptions<Svc, I, A>,
): Recipe<Svc, FoldAtom<ReadonlyArray<A>>> => {
  const cacheKey = options.cacheKey;
  return fold(select, {
    initial: (tag) => {
      if (cacheKey === undefined || options.cache === undefined) return [];
      return [...(options.cache.read(cacheKey(tag)) ?? [])];
    },
    step: (acc, item) => [...acc, options.map(item)].slice(-options.cap),
    tap:
      cacheKey === undefined || options.cache === undefined
        ? undefined
        : (acc, tag) => options.cache!.write(cacheKey(tag), acc),
    seed: options.seed,
    channel: cacheKey ?? ((tag) => `scan:${channelKeyOf(tag.key, select as never)}`),
  });
};

/**
 * Poll an Effect on a spaced schedule → live atom.
 */
export const poll = <Svc, A, E = never>(
  select: (svc: Svc) => Effect.Effect<A, E>,
  every: Duration.Input,
): Recipe<Svc, Atom.Atom<AsyncResult.AsyncResult<A, E | Cause.NoSuchElementError>>> =>
  makeRecipe((ctx) => {
    const tag = edge<AtomTag<Svc, never>>(ctx.tag as never);
    const key = `poll:${channelKeyOf(tag.key, select as never)}:${Duration.toMillis(every)}`;
    let map = foldCache.get(ctx.runtime);
    if (map === undefined) {
      map = new Map();
      foldCache.set(ctx.runtime, map);
    }
    const hit = map.get(`${tag.key}::${key}`);
    if (hit !== undefined) return edge(hit as never);
    const created = ctx.runtime.atom(
      Stream.unwrap(
        Effect.map(tag, (svc) =>
          Stream.fromEffect(select(svc)).pipe(Stream.repeat(Schedule.spaced(every))),
        ),
      ),
    );
    map.set(`${tag.key}::${key}`, created);
    return edge(created as never);
  });

/**
 * Project a recipe’s success value (shares upstream bind via context cache).
 */
export const map = <Svc, A, B, E>(
  recipe: Recipe<Svc, Atom.Atom<AsyncResult.AsyncResult<A, E>>>,
  f: (value: A) => B,
): Recipe<Svc, Atom.Atom<AsyncResult.AsyncResult<B, E>>> =>
  makeRecipe((ctx) => Atom.mapResult(runRecipe(recipe, ctx), f));

type StructField<Svc> =
  | Recipe<Svc, unknown>
  | Pack<Svc, Record<string, unknown>>;

type StructOut<Fields> = {
  readonly [K in keyof Fields]: BoundOf<Fields[K]>;
};

/**
 * Build a pack from named recipes (or nested packs).
 */
export const struct = <
  Svc,
  Fields extends { readonly [K in keyof Fields]: StructField<Svc> },
>(
  fields: Fields,
): Pack<Svc, StructOut<Fields> & Record<string, unknown>> =>
  makePack((ctx) => {
    const out: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(fields)) {
      if (typeof key !== "string") continue;
      out[key] = runField(
        (fields as Record<string, StructField<Svc>>)[key]!,
        ctx,
      );
    }
    return out as StructOut<Fields> & Record<string, unknown>;
  });

/**
 * Merge two packs (right wins on key clash).
 * Right pack may require a wider service (`SvcB`); left’s service must extend it.
 */
export const merge = <
  SvcA extends SvcB,
  SvcB,
  A extends Record<string, unknown>,
  B extends Record<string, unknown>,
>(
  left: Pack<SvcA, A>,
  right: Pack<SvcB, B>,
): Pack<SvcA, A & B> =>
  makePack((ctx) => ({ ...left.bind(ctx), ...right.bind(ctx) }));

/**
 * Pipe-friendly merge: `pipe(left, Observe.and(right))`.
 */
export const and =
  <SvcB, B extends Record<string, unknown>>(right: Pack<SvcB, B>) =>
  <SvcA extends SvcB, A extends Record<string, unknown>>(
    left: Pack<SvcA, A>,
  ): Pack<SvcA, A & B> =>
    merge(left, right);

/**
 * Stable pack id for HMR-safe memo keys.
 */
export const named = <Svc, Out extends Record<string, unknown>>(
  id: string,
  pack: Pack<Svc, Out>,
): Pack<Svc, Out> => makePack(pack.bind, id);

const bindMemo = new WeakMap<object, Map<string, unknown>>();

const packMemoKey = (tagKey: string, pack: Pack<any, any>): string =>
  pack.id !== undefined ? `${tagKey}::id:${pack.id}` : `${tagKey}::ref`;

/**
 * Discharge a pack against a tag under an explicit runtime.
 */
export const bind =
  <R, ER>(runtime: Atom.AtomRuntime<R, ER>) =>
  <Svc, Out extends Record<string, unknown>>(
    tag: AtomTag<Svc, R>,
    pack: Pack<Svc, Out>,
  ): Out => {
    let byTag = bindMemo.get(runtime);
    if (byTag === undefined) {
      byTag = new Map();
      bindMemo.set(runtime, byTag);
    }
    const key = packMemoKey(tag.key, pack);
    if (pack.id !== undefined) {
      const hit = byTag.get(key);
      if (hit !== undefined) return edge(hit as never);
    } else {
      // Reference-equality pack memo: nested WeakMap via object key in a side table.
      const refHit = bindRefMemo.get(runtime)?.get(tag.key)?.get(pack);
      if (refHit !== undefined) return edge(refHit as never);
    }
    const ctx: BindContext = {
      runtime: edge(runtime as never),
      tag: edge(tag as never),
      recipeOut: new WeakMap(),
    };
    const out = pack.bind(ctx);
    if (pack.id !== undefined) {
      byTag.set(key, out);
    } else {
      let byRuntime = bindRefMemo.get(runtime);
      if (byRuntime === undefined) {
        byRuntime = new Map();
        bindRefMemo.set(runtime, byRuntime);
      }
      let byPack = byRuntime.get(tag.key);
      if (byPack === undefined) {
        byPack = new WeakMap();
        byRuntime.set(tag.key, byPack);
      }
      byPack.set(pack, out);
    }
    return out;
  };

const bindRefMemo = new WeakMap<
  object,
  Map<string, WeakMap<object, unknown>>
>();

export {
  RecipeTypeId,
  PackTypeId,
  isRecipe,
  isPack,
  type AtomTag,
};
