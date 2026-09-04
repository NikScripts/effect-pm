/**
 * Promise / async adapter over a Hyperlink service handle — OS edge for non-Effect consumers.
 * Structural walk only (no import from the public Hyperlink module).
 * @internal
 */
import { Context, Effect, Predicate, Stream } from "effect";

/** Narrow a type-erased value at the Promise OS edge without surfacing `unknown`/`any` channels. */
const edge = <T>(value: never): T => value;

/**
 * Close a type-erased Effect before `runPromiseWith` — argument must stay `unknown` (never an
 * `Effect.isEffect`-narrowed `Effect<any, any, any>`, which trips anyUnknownInErrorContext).
 */
const closeEffect = <R>(value: unknown): Effect.Effect<unknown, never, R> =>
  edge(value as never);

const closeStream = <R>(value: unknown): Stream.Stream<unknown, never, R> =>
  edge(value as never);

const isPlainRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

/** Structural Subscribable guard — `get` Effect + `changes` Stream. */
const isSubscribable = (u: unknown): boolean =>
  Predicate.hasProperty(u, "get") &&
  Predicate.hasProperty(u, "changes") &&
  Effect.isEffect((u as { readonly get: unknown }).get) &&
  Stream.isStream((u as { readonly changes: unknown }).changes);

type Runner<R> = <A, E>(
  effect: Effect.Effect<A, E, R>,
  options?: { readonly signal?: AbortSignal } | undefined,
) => Promise<A>;

/** Adapt one handle member (or nested group) to Promise / async. */
const adaptMember = <R>(member: unknown, context: Context.Context<R>, run: Runner<R>): unknown => {
  if (isSubscribable(member)) {
    const sub = member as { readonly get: unknown; readonly changes: unknown };
    const out: Record<string, unknown> = {
      changes: Stream.toAsyncIterableWith(closeStream<R>(sub.changes), context),
    };
    Object.defineProperty(out, "get", {
      enumerable: true,
      configurable: true,
      get: (): Promise<unknown> => run(closeEffect<R>(sub.get)),
    });
    return out;
  }
  if (Stream.isStream(member)) {
    // Payload stays `unknown` — do not pass the `isStream`-narrowed binding into closeStream.
    const payload: unknown = member;
    return Stream.toAsyncIterableWith(closeStream<R>(payload), context);
  }
  if (typeof member === "function") {
    return (...args: ReadonlyArray<unknown>) => {
      const result: unknown = (member as (...a: ReadonlyArray<unknown>) => unknown)(...args);
      // Copy before narrowing so close* never sees Effect/Stream `any` channels.
      const payload: unknown = result;
      if (Stream.isStream(result)) {
        return Stream.toAsyncIterableWith(closeStream<R>(payload), context);
      }
      if (Effect.isEffect(result)) {
        return run(closeEffect<R>(payload));
      }
      return result;
    };
  }
  if (isPlainRecord(member)) {
    return adaptRecord(member, context, run);
  }
  return member;
};

const adaptRecord = <R>(
  service: Record<string, unknown>,
  context: Context.Context<R>,
  run: Runner<R>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(service)) {
    const member: unknown = service[key];
    if (Effect.isEffect(member)) {
      Object.defineProperty(out, key, {
        enumerable: true,
        configurable: true,
        // Getter so `await api.current` re-runs each access (mirrors `yield* api.current`).
        // Read `service[key]` (unknown) — not the `isEffect`-narrowed binding.
        get: (): Promise<unknown> => run(closeEffect<R>(service[key])),
      });
    } else {
      out[key] = adaptMember(member, context, run);
    }
  }
  return out;
};

/**
 * Adapt a service handle to Promise / async using `context` (default empty — wire clients with
 * `R = never`). Failures reject the Promise / async iterator.
 * @internal
 */
export const adaptPromiseHandle = <R = never>(
  service: object,
  context: Context.Context<R> = Context.empty() as Context.Context<R>,
): Record<string, unknown> => {
  const run = Effect.runPromiseWith(context);
  return adaptRecord(service as Record<string, unknown>, context, run);
};
