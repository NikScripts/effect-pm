/**
 * @module web/binding
 *
 * `makeResourceUI(runtime, tag)` — derive a reactive **UI binding** from any
 * `Resource` tag's contract. It is the web counterpart to the CLI/TUI generic
 * renderers: one entry per contract method, classified from `specOf` + `methodMeta`:
 *
 * - **streaming** (`status`/`metrics`/`logs`/`events`/`changes`) → a live `Atom`
 *   that holds the latest emission;
 * - **query, no payload** (`size`/`completed`/`statusNow`) → a read `Atom`;
 * - **anything with a payload, or a `mutate`** (`add`/`pause`/`reconcile`) → a
 *   command `fn` atom you trigger from the UI.
 *
 * Everything is derived from the tag — the widgets never hard-code a method list,
 * so a new contract method (or a whole new resource) renders automatically.
 *
 * @since 1.0.0
 */
import { Effect, Stream } from "effect";
import { Atom, type AsyncResult } from "effect/unstable/reactivity";
import { methodMeta, specOf } from "../Resource";
import type { MethodMeta, ResourceTag, Spec } from "../Resource";

/** Which built-in module a tag is, inferred from its contract shape. @since 1.0.0 */
export type ResourceKind = "queue" | "process" | "schedule" | "run" | "group" | "resource";

/** A live/read value atom (latest stream emission or one-shot read). @since 1.0.0 */
export type ValueAtom = Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>;
/** A command trigger derived from a `mutate`/payload method. @since 1.0.0 */
export type CommandAtom = Atom.AtomResultFn<unknown, unknown, unknown>;

/** The reactive UI surface of one resource, classified by contract. @since 1.0.0 */
export interface ResourceUI {
  readonly key: string;
  readonly displayName: string;
  readonly kind: ResourceKind;
  /** Streaming methods → an atom holding the latest emission. */
  readonly streams: Readonly<Record<string, ValueAtom>>;
  /** Streaming methods → an atom holding the recent window of emissions (for charts/logs). */
  readonly histories: Readonly<Record<string, ValueAtom>>;
  /** Query methods (no payload) → a read atom. */
  readonly reads: Readonly<Record<string, ValueAtom>>;
  /** Mutations / payload methods → a command you trigger. */
  readonly commands: Readonly<Record<string, CommandAtom>>;
  /** Per-method contract metadata (kind, description, destructive, streaming). */
  readonly meta: Readonly<Record<string, MethodMeta>>;
}

/** How many recent stream emissions to retain for charts/log panes. @since 1.0.0 */
const HISTORY = 120;

/** The trailing segment of a tag key (`@repo/pkg/RosterQueue` → `RosterQueue`). @since 1.0.0 */
export const displayName = (key: string): string => {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? key;
};

// detect by the contract's *method* names (not status fields).
const detectKind = (keys: ReadonlyArray<string>): ResourceKind => {
  const has = (k: string): boolean => keys.includes(k);
  if (has("enqueue") || has("prioritize") || (has("add") && has("sizes"))) return "queue";
  if (has("runImmediately") || (has("setSchedule") && has("stop"))) return "process";
  if (has("reconcile") || (has("entries") && has("changes"))) return "schedule";
  if (has("run") && has("result")) return "run";
  return "resource";
};

// Boundary: the contract is iterated dynamically, so a member resolved off the
// service is `unknown` until the spec's own metadata says how to treat it. `prop`
// is the single erasure seam (mirrors `examples/resource-atoms`); the classifiers
// above it decide whether the member is an Effect, a Stream, or a function.
const prop = (service: unknown, key: string): unknown =>
  (service as Record<string, unknown>)[key];

const memberEffect = (tag: ResourceTag<never, Spec>, key: string): Effect.Effect<unknown> =>
  Effect.flatMap(tag, (service) => prop(service, key) as Effect.Effect<unknown>);

const memberStream = (tag: ResourceTag<never, Spec>, key: string): Stream.Stream<unknown> =>
  Stream.unwrap(Effect.map(tag, (service) => prop(service, key) as Stream.Stream<unknown>));

const memberCall = (
  tag: ResourceTag<never, Spec>,
  key: string,
  arg: unknown,
): Effect.Effect<unknown> =>
  Effect.flatMap(tag, (service) => {
    const member = prop(service, key);
    return typeof member === "function"
      ? (member as (a: unknown) => Effect.Effect<unknown>)(arg)
      : (member as Effect.Effect<unknown>);
  });

/**
 * Build the UI binding for `tag` against a reactive `runtime` (which provides the
 * tag — locally via `Resource.layer` or remotely via `Resource.client` + `connect`).
 *
 * @since 1.0.0
 */
export const makeResourceUI = <Self extends R, S extends Spec, R, ER>(
  runtime: Atom.AtomRuntime<R, ER>,
  tag: ResourceTag<Self, S>,
): ResourceUI => {
  const erased = tag as unknown as ResourceTag<never, Spec>;
  const reactivityKey = [tag.key];
  const streams: Record<string, ValueAtom> = {};
  const histories: Record<string, ValueAtom> = {};
  const reads: Record<string, ValueAtom> = {};
  const commands: Record<string, CommandAtom> = {};
  const meta: Record<string, MethodMeta> = {};

  for (const [key, method] of Object.entries(specOf(tag))) {
    // local (off-wire) members carry no payload field and have no UI projection.
    if (!("payload" in method)) continue;
    const m = methodMeta(method);
    meta[key] = m;
    const hasPayload = method.payload !== undefined;
    if (m.streaming) {
      streams[key] = runtime.atom(memberStream(erased, key));
      histories[key] = runtime.atom(
        memberStream(erased, key).pipe(
          Stream.scan([] as ReadonlyArray<unknown>, (acc, x) => [...acc, x].slice(-HISTORY)),
        ),
      );
    } else if (!hasPayload && m.kind === "query") {
      reads[key] = Atom.withReactivity(reactivityKey)(runtime.atom(memberEffect(erased, key)));
    } else {
      commands[key] = runtime.fn((arg: unknown) => memberCall(erased, key, arg), {
        reactivityKeys: reactivityKey,
      });
    }
  }

  return {
    key: tag.key,
    displayName: displayName(tag.key),
    kind: detectKind(Object.keys(meta)),
    streams,
    histories,
    reads,
    commands,
    meta,
  };
};
