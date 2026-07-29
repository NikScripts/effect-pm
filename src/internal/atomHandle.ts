/**
 * Effect-reactive adapters over a Hyperlink Tag / live source — `atom` / `query` / `fn`.
 * Structural walk only (no import from the public Hyperlink module).
 * @internal
 */
import { Cause, Effect, Predicate, Stream } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

/** Narrow a type-erased value at the adapter edge without surfacing `unknown` channels. */
const edge = <T>(value: never): T => value;

/** Tag shape: yieldable service + stable key for atom identity. */
export type AtomTag<Svc, R = never> = Effect.Effect<Svc, never, R> & {
  readonly key: string;
};

/** Live atom from a push source. */
export type LiveAtom<A, E = never> = Atom.Atom<
  AsyncResult.AsyncResult<A, E | Cause.NoSuchElementError>
>;

type LiveSource<A, E> =
  | { readonly changes: Stream.Stream<A, E> }
  | Stream.Stream<A, E>;

type LiveSelect<Svc, A, E> = (svc: Svc) => LiveSource<A, E>;

/** Structural Subscribable — `get` Effect + `changes` Stream. */
const isSubscribable = (
  u: unknown,
): u is { readonly get: unknown; readonly changes: Stream.Stream<unknown, unknown> } =>
  Predicate.hasProperty(u, "get") &&
  Predicate.hasProperty(u, "changes") &&
  Effect.isEffect((u as { readonly get: unknown }).get) &&
  Stream.isStream((u as { readonly changes: unknown }).changes);

/**
 * Live push → Stream. Accepts a Subscribable (uses `.changes`) or a Stream.
 * Nested bags (`metrics`) must be selected to `.stream` / `.changes` explicitly.
 */
const toLiveStream = <A, E>(selected: LiveSource<A, E>): Stream.Stream<A, E> => {
  if (Stream.isStream(selected)) return selected;
  if (isSubscribable(selected)) {
    return edge(selected.changes as never);
  }
  throw new Error(
    "Hyperlink.atom: select a Subscribable or Stream (e.g. q.status or q.metrics.stream)",
  );
};

/**
 * Canonical channel id from a select lambda so `q.status` and `q.status.changes` share one atom.
 */
export const channelKeyOf = (tagKey: string, select: (...args: never) => unknown): string => {
  const s = Function.prototype.toString.call(select).replace(/\s+/g, "");
  const m = /=>\w+\.(.+)$/.exec(s);
  let path = m?.[1] ?? "channel";
  if (path.endsWith(".changes")) {
    path = path.slice(0, -".changes".length);
  }
  return `${tagKey}:${path}`;
};

const atomCache = new WeakMap<object, Map<string, Atom.Atom<unknown>>>();
const sourceCache = new WeakMap<object, WeakMap<object, Atom.Atom<unknown>>>();
const fnCache = new WeakMap<object, Map<string, Atom.AtomResultFn<unknown, unknown, unknown>>>();

const cachedAtom = <A>(
  runtime: object,
  key: string,
  create: () => Atom.Atom<A>,
): Atom.Atom<A> => {
  let map = atomCache.get(runtime);
  if (map === undefined) {
    map = new Map();
    atomCache.set(runtime, map);
  }
  const existing = map.get(key);
  if (existing !== undefined) return edge(existing as never);
  const created = create();
  map.set(key, created);
  return created;
};

const cachedSourceAtom = <A>(
  runtime: object,
  source: object,
  create: () => Atom.Atom<A>,
): Atom.Atom<A> => {
  let bySource = sourceCache.get(runtime);
  if (bySource === undefined) {
    bySource = new WeakMap();
    sourceCache.set(runtime, bySource);
  }
  const existing = bySource.get(source);
  if (existing !== undefined) return edge(existing as never);
  const created = create();
  bySource.set(source, created);
  return created;
};

const cachedFn = <Arg, A, E>(
  runtime: object,
  key: string,
  create: () => Atom.AtomResultFn<Arg, A, E>,
): Atom.AtomResultFn<Arg, A, E> => {
  let map = fnCache.get(runtime);
  if (map === undefined) {
    map = new Map();
    fnCache.set(runtime, map);
  }
  const existing = map.get(key);
  if (existing !== undefined) return edge(existing as never);
  const created = create();
  map.set(key, created as Atom.AtomResultFn<unknown, unknown, unknown>);
  return created;
};

export type AtomBound<R, ER> = {
  <A, E = never>(source: LiveSource<A, E>): LiveAtom<A, E | ER>;
  <Svc, A, E = never>(
    tag: AtomTag<Svc, R>,
    select: LiveSelect<Svc, A, E>,
  ): LiveAtom<A, E | ER>;
};

/**
 * `Hyperlink.atom(runtime)` — live Subscribable / Stream → `Atom<AsyncResult>`.
 */
export const atom = <R, ER>(runtime: Atom.AtomRuntime<R, ER>): AtomBound<R, ER> => {
  function bound<A, E>(source: LiveSource<A, E>): LiveAtom<A, E | ER>;
  function bound<Svc, A, E>(
    tag: AtomTag<Svc, R>,
    select: LiveSelect<Svc, A, E>,
  ): LiveAtom<A, E | ER>;
  function bound(
    tagOrSource: AtomTag<unknown, R> | LiveSource<unknown, unknown>,
    select?: LiveSelect<unknown, unknown, unknown>,
  ): LiveAtom<unknown, unknown> {
    if (select !== undefined) {
      const tag = tagOrSource as AtomTag<unknown, R>;
      const key = channelKeyOf(tag.key, select);
      return cachedAtom(runtime, key, () =>
        runtime.atom(
          Stream.unwrap(Effect.map(tag, (svc) => toLiveStream(select(svc)))),
        ),
      );
    }
    const source = tagOrSource as LiveSource<unknown, unknown>;
    const stream = toLiveStream(source);
    if (typeof source === "object" && source !== null) {
      return cachedSourceAtom(runtime, source, () => runtime.atom(stream));
    }
    return runtime.atom(stream);
  }
  return bound;
};

/**
 * `Hyperlink.query(runtime)` — one-shot Effect read → `Atom<AsyncResult>`.
 */
export const query =
  <R, ER>(runtime: Atom.AtomRuntime<R, ER>) =>
  <Svc, A, E>(
    tag: AtomTag<Svc, R>,
    select: (svc: Svc) => Effect.Effect<A, E, R>,
  ): Atom.Atom<AsyncResult.AsyncResult<A, E | ER>> => {
    const key = `query:${channelKeyOf(tag.key, select)}`;
    return cachedAtom(runtime, key, () => runtime.atom(Effect.flatMap(tag, select)));
  };

/**
 * `Hyperlink.fn(runtime)` — command → `AtomResultFn`.
 */
export const fn =
  <R, ER>(runtime: Atom.AtomRuntime<R, ER>) =>
  <Svc, A, E, Arg = void>(
    tag: AtomTag<Svc, R>,
    select: (
      svc: Svc,
    ) => Effect.Effect<A, E, R> | ((arg: Arg) => Effect.Effect<A, E, R>),
  ): Atom.AtomResultFn<Arg, A, E | ER> => {
    const key = `fn:${channelKeyOf(tag.key, select)}`;
    return cachedFn(runtime, key, () =>
      runtime.fn((arg: Arg) =>
        Effect.flatMap(tag, (svc) => {
          const selected = select(svc);
          if (Effect.isEffect(selected)) {
            return selected;
          }
          return selected(arg);
        }),
      ),
    );
  };
