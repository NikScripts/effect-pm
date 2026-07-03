/**
 * **Resource toolkit** — schema-defined service tags with local + remote (RPC) layers.
 *
 * @remarks
 * Lightweight by construction: imports only `Schema` and `effect/unstable/rpc`, never a
 * heavy implementation. A {@link Spec} is the single source for a resource's wire
 * contract — the inferred service interface, the client forwarder, and the server
 * handlers all derive from it.
 *
 * Each method is built by {@link effect} (idempotent read) or
 * {@link effectFn} (mutation); tool metadata (help text, destructive hint) rides
 * `.annotate({...})`:
 *
 * ```ts
 * class Counter extends Resource.Tag<Counter>()("@app/Counter", {
 *   current: Resource.effect(Schema.Number).annotate({ description: "Current value." }),
 *   add: Resource.effectFn(Schema.Void, { payload: Schema.Struct({ by: Schema.Number }) }),
 *   reset: Resource.effectFn(Schema.Void).annotate({ destructive: true }),
 * }) {}
 *
 * const c = yield* Counter;        // { current: Effect<number>; add: (p) => Effect<void>; reset: Effect<void> }
 * ```
 *
 * Define a tag with {@link Resource.Tag} (one resource) or {@link Resource.tagFor} (a
 * factory: many instances sharing one contract). The same `yield* Tag` code runs
 * anywhere; only the layer changes:
 * - {@link Resource.layer} — run it locally with a real implementation;
 * - {@link Resource.client} — drive it remotely over RPC, as if local;
 * - {@link Resource.server} — expose one local impl over RPC (transport-agnostic handlers);
 * - {@link Resource.serveInstances} — serve many factory instances behind one group,
 *   routed by the per-call instance-key header.
 *
 * Over **http**, the batteries-included pair collapses the transport boilerplate (ndjson by
 * default on both, so client/server can't disagree on the codec):
 * - {@link Resource.serveHttp} — expose a resource on an http `RpcServer` in one call;
 * - {@link Resource.connectHttp} — wire a {@link Resource.Node}'s transport from a `url`.
 *
 * A method is {@link effect} (one-shot read), {@link effectFn} (mutation), or
 * {@link Resource.stream} (a live `Stream` source, e.g. `changes`).
 *
 * @module Resource
 */
import {
  Clock,
  Context,
  Data,
  Effect,
  Fiber,
  Function as Fn,
  Layer,
  Match,
  Option,
  Pipeable,
  Predicate,
  Ref,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { FetchHttpClient, Headers, HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http";
import {
  Rpc,
  RpcClient,
  RpcGroup,
  RpcSchema,
  RpcSerialization,
  RpcServer,
} from "effect/unstable/rpc";
import { Combine, combineQuery } from "./MultiNode";

// ── typed errors (Data.TaggedError — never raw `Error`) ──

/**
 * Two resources declared the same **instance key**. Effect's `Context` is keyed by the key
 * string and silently last-write-wins, so we fail fast at declaration.
 *
 * @public
 */
export class DuplicateResourceKey extends Data.TaggedError(
  "DuplicateResourceKey",
)<{ readonly key: string }> {}

/**
 * Two resources declared the same **group id** (the wire prefix) — they'd collide on a
 * shared `RpcServer`.
 *
 * @public
 */
export class DuplicateGroupId extends Data.TaggedError("DuplicateGroupId")<{
  readonly groupId: string;
}> {}

/**
 * An instance was passed to {@link Resource.serveInstances} more than once.
 *
 * @public
 */
export class DuplicateInstance extends Data.TaggedError("DuplicateInstance")<{
  readonly key: string;
}> {}

/**
 * A family request reached the server with no routable instance key header — a
 * protocol-level fault (the contract was satisfied), surfaced as a defect.
 *
 * @public
 */
export class InstanceRoutingError extends Data.TaggedError(
  "InstanceRoutingError",
)<{
  readonly method: string;
  readonly reason: "missing-key" | "unknown-key";
  readonly key?: string;
}> {}

/**
 * A contract method was absent from the generated RPC client — a wiring bug (the group and
 * client derive from the same spec, so this should be unreachable).
 *
 * @public
 */
export class MissingContractMethod extends Data.TaggedError(
  "MissingContractMethod",
)<{ readonly method: string }> {}

/**
 * A {@link Resource.local} (local-only) method was reached through a client. Unreachable by
 * construction — the {@link LocalCapability} it requires is never granted to a client.
 *
 * @public
 */
export class LocalOnlyMethod extends Data.TaggedError("LocalOnlyMethod")<{
  readonly method: string;
}> {}

/** No transport url for a node — neither on the {@link Resource.Node} (`{ url }`) nor passed to
 *  {@link Resource.connectHttp}. @public */
export class MissingNodeUrl extends Data.TaggedError("MissingNodeUrl")<{
  readonly node: string;
}> {}

/**
 * How a method behaves, for tools (CLI/TUI/dashboard) — **explicit, never inferred**;
 * encoded by the constructor used ({@link effect} vs {@link effectFn}):
 * - **`query`** — an idempotent read (CLI prints it, dashboard reads it as an Atom);
 * - **`mutate`** — a mutation (CLI confirms, dashboard calls it as `runtime.fn`).
 *
 * @public
 */
export type MethodKind = "query" | "mutate";

/**
 * Tool metadata attached to a method via {@link Method.annotate} — the Effect annotation
 * idiom. Inert to the type inference and the wire contract; it only feeds the tools that
 * render this resource.
 *
 * @public
 */
export interface MethodAnnotations {
  /** Help text — CLI/TUI help, dashboard tooltips. */
  readonly description?: string;
  /** A `mutate` that loses state (`shutdown`/`clear`/`drop`) → confirm / danger styling. */
  readonly destructive?: boolean;
  /**
   * When `"pair"`, a 2-tuple payload is surfaced as two call arguments `(first, second?)`
   * instead of a single tuple (used by custom-queue `add(item, level?)`).
   */
  readonly callStyle?: "pair";
}

/** Identity brand for a {@link Method} (Effect-style string `TypeId`) — distinguishes a spec leaf from a
 *  plain object; guarded with `Predicate.hasProperty`. */
const MethodTypeId = "~nikscripts/effect-pm/Resource/Method" as const;

/**
 * One method of a resource contract — built by {@link effect} /
 * {@link effectFn} / {@link Resource.stream}. Carries its `kind`, schemas
 * (`payload` / `success` / `error`), whether it's a `stream` (a push source vs a one-shot
 * read), and tool annotations. `.annotate({...})` returns a copy with merged annotations,
 * mirroring Effect's schema idiom.
 *
 * For a streaming method, `success` is the **element** schema and `error` is the **stream
 * error** schema — they become an `RpcSchema.Stream` on the wire, and the service member
 * surfaces as a `Stream` rather than an `Effect`.
 *
 * @public
 */
export interface Method<
  Kind extends MethodKind,
  P extends Schema.Struct.Fields | Schema.Top | undefined,
  Su extends Schema.Top,
  E extends Schema.Top,
  Str extends boolean = false,
  Ann extends MethodAnnotations = MethodAnnotations,
> extends Pipeable.Pipeable {
  readonly [MethodTypeId]: typeof MethodTypeId;
  readonly kind: Kind;
  readonly payload: P;
  readonly success: Su;
  readonly error: E;
  /** A streaming read (`Stream` member) when `true`; a one-shot `Effect` otherwise. */
  readonly stream: Str;
  readonly annotations: Ann;
  readonly annotate: <A extends MethodAnnotations>(
    annotations: A,
  ) => Method<Kind, P, Su, E, Str, Ann & A>;
}

/** Any {@link Method}, erased — the element type of a {@link Spec}. @public */
export type AnyMethod = Method<
  MethodKind,
  Schema.Struct.Fields | Schema.Top | undefined,
  Schema.Top,
  Schema.Top,
  boolean,
  MethodAnnotations
>;

/** A {@link Method} marked as a **fleet** field (via {@link fleet}) — combined across the nodes (in the
 *  layer via {@link peers}); served + client-visible like any query, but excluded from {@link peers}.
 *  Marked with a readable `fleet: true`. @public */
export type FleetField<M extends AnyMethod> = Marked<M, { readonly fleet: true }>;

/**
 * Mark a contract method as a **fleet** field — one combined across the nodes (its layer impl folds
 * {@link peers} + its own value). It's served and client-visible like any query, but **excluded from
 * {@link peers}**, so a fold over peers can't call a peer's *own* fleet field (a fan-out, not what you
 * want). The one lightweight tag the plain-query model keeps, purely for this exclusion.
 *
 * ```ts
 * connections:      Resource.effect(Schema.Number),               // per-instance (leaf) — peers see it
 * totalConnections: Resource.fleet(Resource.effect(Schema.Number)), // fleet — peers don't
 * ```
 *
 * @public
 */
export const fleet = <M extends AnyMethod>(method: M): FleetField<M> =>
  marked(method, { fleet: true as const });

/** @internal */
declare const localCapabilityTypeId: unique symbol;

/**
 * A phantom **capability**, granted *only* by a resource's local layer
 * ({@link Resource.layer}) — never by {@link Resource.client}. A {@link LocalMethod} carries
 * it in its requirement channel, so calling a non-serializable method against a client is a
 * **compile error** (unsatisfied requirement); the same call resolves when the local layer
 * is provided. Branded by `Self` so one resource's local layer can't unlock another's.
 *
 * @public
 */
export interface LocalCapability<in out Self> {
  readonly [localCapabilityTypeId]: Self;
}

/** Identity brand for a {@link LocalMethod} (Effect-style string `TypeId`) — distinguishes an off-wire
 *  local member from a wire {@link Method}. */
const LocalMethodTypeId = "~nikscripts/effect-pm/Resource/LocalMethod" as const;

/**
 * A **local-only** member of a resource contract — built by {@link Resource.local}. It is
 * *not* part of the wire contract (no schema, no rpc): use it for things that can't cross
 * RPC simply (a returned function, a raw `Fiber`/`Scope`/`Ref`, a callback). Its declared
 * type `T` is given directly. In the service it surfaces as
 * `Effect<T, never, LocalCapability<Self>>` — you `yield*` it to obtain the value, which
 * requires the local layer's capability.
 *
 * @public
 */
export interface LocalMethod<T> {
  readonly [LocalMethodTypeId]: typeof LocalMethodTypeId;
  /** Phantom carrier of the member's local type — type-level only, never set at runtime. */
  readonly value?: T;
}

/** Any {@link LocalMethod}, erased. @public */
export type AnyLocalMethod = LocalMethod<unknown>;

/**
 * A resource contract: method name → wire {@link Method} or off-wire {@link LocalMethod}.
 * The single source of truth.
 *
 * @public
 */
export interface Spec {
  readonly [k: string]: AnyMethod | AnyLocalMethod | Spec;
}

/** A **flat** spec — a path-keyed record of leaves (no nested groups). The wire machinery runs on this;
 *  a (possibly nested) {@link Spec} flattens to it via {@link flattenSpec}. @internal */
export type FlatSpec = Record<string, AnyMethod | AnyLocalMethod>;

/** Union → intersection — folds the per-leaf records from {@link FlatSpecOf}. @internal */
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

/**
 * The **precise** flat spec for a (possibly nested) `S` — path-keyed leaves (`"group.leaf"`). Used only in
 * *return* positions ({@link specOf} / {@link forwardClient}), never a constraint, so the intersection is
 * fine. The `kind` check + {@link AsMethod} keep it reducing under a generic item schema. @internal */
export type FlatSpecOf<S, Prefix extends string = ""> = UnionToIntersection<
  {
    [K in keyof S & string]: S[K] extends { readonly kind: MethodKind }
      ? { readonly [P in `${Prefix}${K}`]: AsMethod<S[K]> }
      : S[K] extends AnyLocalMethod
        ? { readonly [P in `${Prefix}${K}`]: S[K] }
        : S[K] extends Spec
          ? FlatSpecOf<S[K], `${Prefix}${K}.`>
          : never;
  }[keyof S & string]
>;

/**
 * Reconstruct a proper {@link Method} from a leaf's parts via `infer` — prop-*presence* + `infer …
 * extends …` is **F-independent** (reduces under a generic item schema) and keeps the payload precise,
 * unlike `Extract`/`&`. Lets the recursive spec types feed the existing `ServiceMethod`/`ServeMethod`/
 * `RpcOf` under a nested, generic `Spec`. @internal
 */
type AsMethod<T> = T extends {
  readonly kind: infer K extends MethodKind;
  readonly payload: infer P extends Schema.Struct.Fields | Schema.Top | undefined;
  readonly success: infer Su extends Schema.Top;
  readonly error: infer E extends Schema.Top;
  readonly stream: infer Str extends boolean;
  readonly annotations: infer Ann extends MethodAnnotations;
}
  ? Method<K, P, Su, E, Str, Ann>
  : never;

/** Runtime guard: is a spec entry a {@link LocalMethod} (vs a wire {@link Method})? */
const isLocalMethod = (
  m: AnyMethod | AnyLocalMethod | Spec,
): m is AnyLocalMethod => Predicate.hasProperty(m, LocalMethodTypeId);

/** Runtime guard: is a spec entry a **leaf** (wire/local method) vs a nested **group**? @internal */
const isSpecLeaf = (
  v: AnyMethod | AnyLocalMethod | Spec,
): v is AnyMethod | AnyLocalMethod =>
  Predicate.hasProperty(v, MethodTypeId) ||
  Predicate.hasProperty(v, LocalMethodTypeId);

/** Flatten a nested spec to a flat path-keyed record (identity for a flat spec). @internal */
const flattenSpec = (spec: Spec, prefix = ""): FlatSpec => {
  const flat: Record<string, AnyMethod | AnyLocalMethod> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (isSpecLeaf(v)) flat[`${prefix}${k}`] = v;
    else Object.assign(flat, flattenSpec(v, `${prefix}${k}.`));
  }
  return flat;
};

/** Flatten a nested impl to a flat path-keyed record, walking each path from the (flat) spec's keys —
 *  identity for a flat spec. @internal */
const flattenImpl = (
  impl: Record<string, unknown>,
  flatSpec: FlatSpec,
): Record<string, unknown> => {
  const flat: Record<string, unknown> = {};
  for (const path of Object.keys(flatSpec)) {
    let node: unknown = impl;
    for (const part of path.split(".")) {
      node = (node as Record<string, unknown>)[part];
    }
    flat[path] = node;
  }
  return flat;
};

/** Nest a flat path-keyed service back into the tree. **Identity (same reference) when there's no nesting**
 *  — so `value` fields' in-place setters keep updating the *returned* object. @internal */
const nestService = (
  flat: Record<string, unknown>,
): Record<string, unknown> => {
  // no dotted keys → already the final shape; return it as-is so live `value` setters aren't orphaned.
  if (!Object.keys(flat).some((k) => k.includes("."))) return flat;
  const nested: Record<string, unknown> = {};
  for (const [path, val] of Object.entries(flat)) {
    const parts = path.split(".");
    const last = parts.pop();
    if (last === undefined) continue;
    let node = nested;
    for (const part of parts) {
      node[part] = (node[part] as Record<string, unknown> | undefined) ?? {};
      node = node[part] as Record<string, unknown>;
    }
    node[last] = val;
  }
  return nested;
};

/** Set a value at a (possibly dotted) path in the service tree, creating intermediate groups. Used to
 *  build the service **directly into its nested shape**, so live `value` setters write the object the
 *  consumer holds (rather than a pre-nesting copy). @internal */
const setPath = (
  obj: Record<string, unknown>,
  path: string,
  val: unknown,
): void => {
  const parts = path.split(".");
  const last = parts.pop();
  if (last === undefined) return;
  let node = obj;
  for (const part of parts) {
    node[part] = (node[part] as Record<string, unknown> | undefined) ?? {};
    node = node[part] as Record<string, unknown>;
  }
  node[last] = val;
};

/**
 * Declare a **local-only** member of type `T` (see {@link LocalMethod}). Not serialized,
 * not in the wire contract; usable only when the local layer is provided.
 *
 * ```ts
 * subscribe: Resource.local<(cb: (x: number) => void) => Effect.Effect<void>>(),
 * ```
 *
 * @public
 */
export const local = <T>(): LocalMethod<T> => ({
  [LocalMethodTypeId]: LocalMethodTypeId,
});

/**
 * The resolved tool metadata for one method — what CLI/TUI/dashboard read to render it.
 *
 * @public
 */
export interface MethodMeta {
  /** Query (read) vs mutate (mutation). */
  readonly kind: MethodKind;
  /** Help text, if declared. */
  readonly description: string | undefined;
  /** Whether the mutation loses state — only meaningful for `mutate`s. */
  readonly destructive: boolean;
  /** A streaming read (a live "watch" source) rather than a one-shot value. */
  readonly streaming: boolean;
}

/**
 * Read the tool metadata for a {@link Method}: its `kind`, `description`, `destructive`
 * flag, and whether it `streaming`s. Pure annotation — does not touch the wire contract.
 *
 * @public
 */
export const methodMeta = (m: AnyMethod): MethodMeta => ({
  kind: m.kind,
  description: m.annotations.description,
  destructive: m.annotations.destructive ?? false,
  streaming: m.stream,
});

/**
 * The single {@link Method} constructor — {@link effect}, {@link effectFn}, {@link constant},
 * {@link value}, and {@link stream} all go through it.
 */
const makeMethod = <
  Kind extends MethodKind,
  P extends Schema.Struct.Fields | Schema.Top | undefined,
  Su extends Schema.Top,
  E extends Schema.Top,
  Str extends boolean,
  Ann extends MethodAnnotations = MethodAnnotations,
>(
  kind: Kind,
  payload: P,
  success: Su,
  error: E,
  stream: Str,
  annotations: Ann,
): Method<Kind, P, Su, E, Str, Ann> =>
  Object.assign(Object.create(Pipeable.Prototype), {
    [MethodTypeId]: MethodTypeId,
    kind,
    payload,
    success,
    error,
    stream,
    annotations,
    annotate: <A extends MethodAnnotations>(a: A): Method<Kind, P, Su, E, Str, Ann & A> =>
      makeMethod(kind, payload, success, error, stream, { ...annotations, ...a } as Ann & A),
  });

/**
 * A {@link Method} carrying a shape marker `Mark` (`{ _tag: … }` / `{ fleet: true }`) whose `.annotate()`
 * **re-applies the marker** — so `value(x).annotate(…)` stays a value instead of silently degrading to a
 * plain stream method. @internal
 */
export type Marked<M extends AnyMethod, Mark> = Omit<M, "annotate"> &
  Mark & {
    readonly annotate: <A extends MethodAnnotations>(
      a: A,
    ) => Marked<
      Method<M["kind"], M["payload"], M["success"], M["error"], M["stream"], M["annotations"] & A>,
      Mark
    >;
  };

/** Attach a shape marker whose `.annotate()` preserves it (rebuilds the marker after annotating). @internal */
const marked = <M extends AnyMethod, Mark extends object>(
  method: M,
  mark: Mark,
): Marked<M, Mark> =>
  Object.assign(Object.create(Pipeable.Prototype), method, mark, {
    annotate: <A extends MethodAnnotations>(a: A) => marked(method.annotate(a), mark),
  }) as Marked<M, Mark>;

/**
 * Define an **`effect`** field — resolves to `Effect<Su, E>` in the service (a lazy, re-runnable read),
 * named for what it resolves to. Add a `payload` (a parameterized read becomes a function) and/or `error`
 * via options; attach help/metadata with `.annotate({ description, ... })`. The other shapes are
 * {@link value} / {@link constant} / {@link effectFn} / {@link stream}.
 *
 * `payload` is a single **schema** or struct **fields** — same as Effect's `Rpc.make`. Prefer a schema
 * (`Schema.Struct({ … })`, or any schema such as a union) so the input's shape is explicit.
 *
 * ```ts
 * size: Resource.effect(Schema.Number).annotate({ description: "Total pending." }),
 * get: Resource.effect(Schema.User, { payload: Schema.Struct({ id: Schema.String }) }),
 * ```
 *
 * @public
 */
export function effect<Su extends Schema.Top>(
  success: Su,
): Method<"query", undefined, Su, Schema.Never>;
export function effect<Su extends Schema.Top, const F extends Schema.Struct.Fields>(
  success: Su,
  options: { readonly payload: F },
): Method<"query", F, Su, Schema.Never>;
// whole-schema payload — the value is passed/decoded directly (mirrors `Rpc.make`'s schema form).
export function effect<Su extends Schema.Top, P extends Schema.Top>(
  success: Su,
  options: { readonly payload: P },
): Method<"query", P, Su, Schema.Never>;
export function effect<Su extends Schema.Top, E extends Schema.Top>(
  success: Su,
  options: { readonly error: E },
): Method<"query", undefined, Su, E>;
export function effect<
  Su extends Schema.Top,
  const F extends Schema.Struct.Fields,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: F; readonly error: E },
): Method<"query", F, Su, E>;
export function effect<
  Su extends Schema.Top,
  P extends Schema.Top,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: P; readonly error: E },
): Method<"query", P, Su, E>;
export function effect(
  success: Schema.Top,
  options?: {
    readonly payload?: Schema.Struct.Fields | Schema.Top;
    readonly error?: Schema.Top;
  },
): AnyMethod {
  return makeMethod(
    "query",
    options?.payload,
    success,
    options?.error ?? Schema.Never,
    false,
    {},
  );
}

/** A {@link Method} marked as a **constant** field (via {@link constant}) — resolved once at acquire,
 *  surfaced as a plain value. Tagged with a readable `_tag: "constant"`. @public */
export type ConstantField<M extends AnyMethod> = Marked<M, { readonly _tag: "constant" }>;

/** Runtime guard: is a spec entry a {@link constant} field? */
const isConstantMethod = (m: AnyMethod | AnyLocalMethod): boolean =>
  Predicate.hasProperty(m, "_tag") && m._tag === "constant";

/**
 * Define a **`constant`** field — a value resolved **once** when the resource is acquired, surfaced as a
 * **plain** property (`p.x: A`, no `yield*`), identical local and remote. For values fixed after startup.
 * The impl supplies the value as an `Effect<A>` (run once at acquire; use `Effect.succeed` for a literal).
 * Live values are `value`; on-demand reads are `effect`. See `docs/handoffs/service-shape-redesign.md`.
 *
 * @public
 */
export const constant = <Su extends Schema.Top>(
  success: Su,
): ConstantField<Method<"query", undefined, Su, typeof Schema.Never>> =>
  marked(effect(success), { _tag: "constant" as const });

/** A {@link Method} marked as a **ref** field (via {@link ref}) — surfaces as a {@link Subscribable}.
 *  Tagged with a readable `_tag: "ref"`. @public */
export type RefField<M extends AnyMethod> = Marked<M, { readonly _tag: "ref" }>;

/** Runtime guard: is a spec entry a {@link ref} field? */
const isRefMethod = (m: AnyMethod | AnyLocalMethod): boolean =>
  Predicate.hasProperty(m, "_tag") && m._tag === "ref";

/**
 * Define a **`ref`** field — reactive state surfaced as a {@link Subscribable}<A> (`get` + `changes`),
 * uniform local and remote. The impl **owns** a `SubscriptionRef` (writes it) and provides it via
 * {@link subscribable}; consumers **read** (`yield* svc.x.get`) and **observe** (`svc.x.changes`) — a read
 * is an honest `Effect`, not a synchronous peek. For values fixed at acquire use `constant`; for on-demand
 * calls use `effect`. See `docs/handoffs/2026-07-03-contract-serve-reform.md`.
 *
 * @public
 */
export const ref = <Su extends Schema.Top>(
  success: Su,
): RefField<Method<"query", undefined, Su, typeof Schema.Never, true>> =>
  marked(stream(success), { _tag: "ref" as const });

/**
 * A **read-only reactive value**: its current value ({@link Subscribable.get}, an `Effect`) plus a stream
 * of every change ({@link Subscribable.changes}). This is what a {@link ref} field surfaces — uniform local
 * and remote — and it's exactly the read side of a `SubscriptionRef` (Effect ships no `Subscribable` type in
 * this beta, so we name it here). @public
 */
export interface Subscribable<A> {
  readonly get: Effect.Effect<A>;
  readonly changes: Stream.Stream<A>;
}

/**
 * Build a {@link Subscribable} view over a `SubscriptionRef` — the impl side of a {@link ref} field: the
 * impl owns the ref (writes it), consumers get read + observe. @public
 */
export const subscribable = <A>(
  source: SubscriptionRef.SubscriptionRef<A>,
): Subscribable<A> => ({
  get: SubscriptionRef.get(source),
  changes: SubscriptionRef.changes(source),
});

/**
 * Derive a {@link Subscribable} from another by mapping both its current value and its changes — one source
 * of truth feeds every view (a queue's `size`/`isEmpty` from its `status`). @public
 */
export const mapSubscribable = <A, B>(
  source: Subscribable<A>,
  f: (a: A) => B,
): Subscribable<B> => ({
  get: Effect.map(source.get, f),
  changes: Stream.map(source.changes, f),
});

/**
 * Define an **`effectFn`** field — resolves to `(In) => Effect<Su, E>` in the service (a call with input),
 * named for what it resolves to. Use `Schema.Void` for `success` when it returns nothing. Add a `payload`
 * and/or `error` via options; attach help/metadata with `.annotate({ description, destructive })`.
 *
 * `payload` is a single **schema** or struct **fields** — same as Effect's `Rpc.make`. A bare schema (a
 * union, an item, `Schema.Struct({ … })`) is the input directly — e.g. `add(item | item[])`.
 *
 * ```ts
 * pause: Resource.effectFn(Schema.Void).annotate({ description: "Pause." }),
 * clear: Resource.effectFn(Schema.Number).annotate({ destructive: true }),
 * enqueue: Resource.effectFn(Schema.Void, { payload: Schema.Struct({ item: Item }), error: Full }),
 * ```
 *
 * @public
 */
export function effectFn<Su extends Schema.Top>(
  success: Su,
): Method<"mutate", undefined, Su, Schema.Never>;
export function effectFn<Su extends Schema.Top, const F extends Schema.Struct.Fields>(
  success: Su,
  options: { readonly payload: F },
): Method<"mutate", F, Su, Schema.Never>;
// whole-schema payload — the value is passed/decoded directly (e.g. `add(item)`).
export function effectFn<Su extends Schema.Top, P extends Schema.Top>(
  success: Su,
  options: { readonly payload: P },
): Method<"mutate", P, Su, Schema.Never>;
export function effectFn<Su extends Schema.Top, E extends Schema.Top>(
  success: Su,
  options: { readonly error: E },
): Method<"mutate", undefined, Su, E>;
export function effectFn<
  Su extends Schema.Top,
  const F extends Schema.Struct.Fields,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: F; readonly error: E },
): Method<"mutate", F, Su, E>;
export function effectFn<
  Su extends Schema.Top,
  P extends Schema.Top,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: P; readonly error: E },
): Method<"mutate", P, Su, E>;
export function effectFn(
  success: Schema.Top,
  options?: {
    readonly payload?: Schema.Struct.Fields | Schema.Top;
    readonly error?: Schema.Top;
  },
): AnyMethod {
  return makeMethod(
    "mutate",
    options?.payload,
    success,
    options?.error ?? Schema.Never,
    false,
    {},
  );
}

type PairMethodAnnotations = MethodAnnotations & { readonly callStyle: "pair" };

/**
 * Like {@link effectFn}, but the payload must be a 2-tuple schema surfaced as two call
 * arguments `(first, second?)` — used by custom-queue `add(item, level?)`.
 *
 * @public
 */
export function mutatePair<
  Su extends Schema.Top,
  H extends Schema.Top,
  T extends Schema.Top,
>(
  success: Su,
  head: H,
  tail: T,
): Method<"mutate", Schema.Tuple<readonly [H, T]>, Su, Schema.Never, false, PairMethodAnnotations>;
export function mutatePair<Su extends Schema.Top, P extends Schema.Tuple<readonly [Schema.Top, Schema.Top]>>(
  success: Su,
  payload: P,
): Method<"mutate", P, Su, Schema.Never, false, PairMethodAnnotations>;
export function mutatePair(
  success: Schema.Top,
  headOrPayload: Schema.Top,
  tail?: Schema.Top,
): Method<"mutate", Schema.Tuple<readonly [Schema.Top, Schema.Top]>, Schema.Top, Schema.Never, false, PairMethodAnnotations> {
  const payload =
    tail === undefined
      ? headOrPayload
      : Schema.Tuple([headOrPayload, tail]);
  return makeMethod(
    "mutate",
    payload as Schema.Tuple<readonly [Schema.Top, Schema.Top]>,
    success,
    Schema.Never,
    false,
    { callStyle: "pair" },
  );
}

/**
 * Define a **stream** (a live, idempotent push source) whose elements are `success`. The
 * service member surfaces as a `Stream<Success, Error>` (a property, or `(payload) => Stream`
 * when a `payload` is declared) rather than an `Effect` — drive dashboard atoms, a CLI
 * `--watch`, or a TUI from it. Conventionally named `changes` when it carries a resource's
 * whole observable state (a snapshot stream); back it with a `SubscriptionRef`'s `.changes`.
 *
 * Counts as a `query` for tools (an idempotent read). `success` is the **element** schema and
 * `error` (if any) is the **stream error** schema; both must be encodable (they cross RPC).
 * `payload` is a single **schema** or struct **fields** — same as Effect's `Rpc.make`.
 *
 * ```ts
 * changes: Resource.stream(QueueSnapshot).annotate({ description: "Live queue state." }),
 * tail: Resource.stream(LogLine, { payload: Schema.Struct({ since: Schema.Number }) }),
 * ```
 *
 * @public
 */
export function stream<Su extends Schema.Top>(
  success: Su,
): Method<"query", undefined, Su, Schema.Never, true>;
export function stream<Su extends Schema.Top, const F extends Schema.Struct.Fields>(
  success: Su,
  options: { readonly payload: F },
): Method<"query", F, Su, Schema.Never, true>;
// whole-schema payload — the value is passed/decoded directly (mirrors `Rpc.make`'s schema form).
export function stream<Su extends Schema.Top, P extends Schema.Top>(
  success: Su,
  options: { readonly payload: P },
): Method<"query", P, Su, Schema.Never, true>;
export function stream<Su extends Schema.Top, E extends Schema.Top>(
  success: Su,
  options: { readonly error: E },
): Method<"query", undefined, Su, E, true>;
export function stream<
  Su extends Schema.Top,
  const F extends Schema.Struct.Fields,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: F; readonly error: E },
): Method<"query", F, Su, E, true>;
export function stream<
  Su extends Schema.Top,
  P extends Schema.Top,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: P; readonly error: E },
): Method<"query", P, Su, E, true>;
export function stream(
  success: Schema.Top,
  options?: {
    readonly payload?: Schema.Struct.Fields | Schema.Top;
    readonly error?: Schema.Top;
  },
): AnyMethod {
  return makeMethod(
    "query",
    options?.payload,
    success,
    options?.error ?? Schema.Never,
    true,
    {},
  );
}

// ── type-level inference: one Spec → the service interface ──

type SuccessOf<M extends AnyMethod> = M["success"]["Type"];

type ErrorOf<M extends AnyMethod> = M["error"]["Type"];

// A payload is either a whole **schema** (the value is decoded directly — e.g. `add(item)`), a
// **fields record** (decoded as a struct), or `undefined` (no payload). The schema branch is
// checked first; a concrete-shaped schema type (`Schema.Struct<F>`, `Schema.Array<…>`) resolves
// `extends Schema.Top` even when its inner field/element params are abstract.
type PayloadOf<M extends AnyMethod> = M["payload"] extends Schema.Top
  ? M["payload"]["Type"]
  : M["payload"] extends infer F extends Schema.Struct.Fields
    ? Schema.Struct<F>["Type"]
    : never;

/**
 * The inferred shape of one method. A non-streaming method is an **`Effect`**; a streaming
 * method ({@link Resource.stream}) is a **`Stream`**. Either is a **property** when there is
 * no payload, or a **function** `(payload) => …` when there is.
 *
 * @internal
 */
// Payload presence is gated on `[M["payload"]] extends [undefined]` — the **absence** case —
// not on `extends [Schema.Struct.Fields]` (the presence case). This matters: `{ item: Sch }
// extends Schema.Struct.Fields` is *constraint-dependent* (it needs `Sch extends Schema.Top`),
// so TS defers it whenever `Sch` is a free parameter (the schemas in `M["payload"]` carry it) —
// and tuple-wrapping does **not** fix that (it only stops distribution). `… extends [undefined]`
// is instead decidable with `Sch` fully opaque (an object type is never `undefined`, regardless
// of `Sch`), so it resolves eagerly under a generic spec. `M["stream"]` is a literal boolean.
type MutateMethodFn<M extends AnyMethod> = M extends Method<
  MethodKind,
  infer _P,
  infer _Su,
  infer _E,
  infer _Str,
  infer Ann
>
  ? Ann extends { readonly callStyle: "pair" }
    ? PayloadOf<M> extends readonly [infer H, infer T]
      ? undefined extends T
        ? (arg0: H, arg1?: T) => Effect.Effect<SuccessOf<M>, ErrorOf<M>>
        : (arg0: H, arg1: T) => Effect.Effect<SuccessOf<M>, ErrorOf<M>>
      : (payload: PayloadOf<M>) => Effect.Effect<SuccessOf<M>, ErrorOf<M>>
    : (payload: PayloadOf<M>) => Effect.Effect<SuccessOf<M>, ErrorOf<M>>
  : (payload: PayloadOf<M>) => Effect.Effect<SuccessOf<M>, ErrorOf<M>>;

export type ServiceMethod<M extends AnyMethod> = M["stream"] extends true
  ? [M["payload"]] extends [undefined]
    ? Stream.Stream<SuccessOf<M>, ErrorOf<M>>
    : (payload: PayloadOf<M>) => Stream.Stream<SuccessOf<M>, ErrorOf<M>>
  : [M["payload"]] extends [undefined]
    ? Effect.Effect<SuccessOf<M>, ErrorOf<M>>
    : MutateMethodFn<M>;

/**
 * The full service interface inferred from a {@link Spec}. Wire {@link Method}s map to
 * `Effect`/function members; off-wire {@link LocalMethod}s surface as
 * `Effect<T, never, LocalCapability<Self>>` — `yield*` to obtain the value, requiring the
 * local layer's capability (so they're uncallable through {@link Resource.client}).
 *
 * @public
 */
// NOTE on the gates below: each entry is `AnyMethod | AnyLocalMethod`, so we branch **only** on
// the `LocalMethod` brand — a symbol check independent of the method's schemas. The old
// `: S[K] extends AnyMethod ? … : never` else-gate was always true (everything that isn't a
// local method *is* a method), so its `never` branch was dead — but checking `extends AnyMethod`
// drags the entry's payload schemas into the conditional, which makes TS **defer** the whole
// type whenever those schemas contain a free type parameter (e.g. inside a factory generic over
// the item schema). Dropping the dead gate and narrowing with `Exclude<…, AnyLocalMethod>`
// keeps the result identical for every concrete spec while letting it reduce under a generic
// spec too. See `docs/handoffs/resource-toolkit-new-features.md`.
export type ServiceOf<S extends Spec, Self = unknown> = {
  readonly [K in keyof S]: S[K] extends LocalMethod<infer T>
    ? Effect.Effect<T, never, LocalCapability<Self>>
    : S[K] extends { readonly _tag: "constant" }
      ? SuccessOf<AsMethod<S[K]>>
      : S[K] extends { readonly _tag: "ref" }
        ? Subscribable<SuccessOf<AsMethod<S[K]>>>
        : S[K] extends { readonly kind: MethodKind } // leaf (F-independent; reconstruct via AsMethod)
          ? ServiceMethod<AsMethod<S[K]>>
          : S[K] extends Spec
            ? ServiceOf<S[K], Self> // nested group → nested service
            : never;
};

/** The wire-only service: just the {@link Method}s (used by the server impl + forwarder). */
type WireServiceOf<S extends Spec> = {
  readonly [K in keyof S as S[K] extends AnyLocalMethod ? never : K]: S[K] extends {
    readonly _tag: "ref";
  }
    ? Subscribable<SuccessOf<AsMethod<S[K]>>> // impl provides the Subscribable; wire serves its .changes
    : S[K] extends { readonly kind: MethodKind }
      ? ServiceMethod<AsMethod<S[K]>>
      : S[K] extends Spec
        ? WireServiceOf<S[K]>
        : never;
};

/** A **peer's** service as seen by {@link peers} — the per-instance ("leaf") wire methods only:
 *  {@link FleetField}s and {@link LocalMethod}s are excluded, so a fold can't recurse into a peer's
 *  own fleet field. A full {@link ServiceOf} is assignable to it (width), so real clients fit. */
type PeerServiceOf<S extends Spec> = {
  readonly [K in keyof S as S[K] extends { readonly fleet: true }
    ? never
    : S[K] extends AnyLocalMethod
      ? never
      : K]: S[K] extends { readonly _tag: "ref" }
    ? // a peer reads a `ref` **one-shot** (its current value, lazily) — not a live subscription, so
      // folding it never opens a persistent connection at build (see buildPeerService).
      Effect.Effect<SuccessOf<AsMethod<S[K]>>>
    : S[K] extends { readonly kind: MethodKind }
      ? ServiceMethod<AsMethod<S[K]>>
      : S[K] extends Spec
        ? PeerServiceOf<S[K]>
        : never;
};

/**
 * The **implementation** a {@link localLayer} / {@link serverLayer} expects: wire members are their
 * `Effect`/`Stream`/function, and each {@link LocalMethod} is its **raw** value `T` (the toolkit wraps
 * it to require the {@link LocalCapability}). When an impl needs a capability (e.g. {@link peers}) to
 * build, provide it via the **`Effect` form** of {@link Resource.layer} / {@link Resource.serverEntry}
 * — resolve it once, and the members close over it.
 *
 * A `value` field's impl is the **`Stream`** that feeds it (typically a `SubscriptionRef`'s `.changes`),
 * and a `constant`'s is the `Effect<A>` resolved once — both differ from how they *surface* in
 * {@link ServiceOf} (a plain `A`), so annotate an impl with `ImplOf`, not `ServiceOf`.
 *
 * @public
 */
export type ImplOf<S extends Spec> = {
  readonly [K in keyof S]: S[K] extends LocalMethod<infer T>
    ? T
    : S[K] extends { readonly _tag: "ref" }
      ? Subscribable<SuccessOf<AsMethod<S[K]>>> // impl owns the SubscriptionRef, provided via subscribable()
      : S[K] extends { readonly kind: MethodKind }
        ? ServiceMethod<AsMethod<S[K]>>
        : S[K] extends Spec
          ? ImplOf<S[K]> // nested group → nested impl
          : never;
};

/**
 * Recover the (possibly nested) {@link Spec} a tag was built from — for annotating an extracted impl
 * without hand-threading it: `obj satisfies ImplOf<SpecOf<typeof MyTag>>`. Usually you don't need it —
 * {@link Resource.make} infers it. @public
 */
export type SpecOf<T> = T extends { readonly [specTypeSym]?: infer S extends Spec }
  ? S
  : never;

/**
 * Anchor a **reusable** impl to its contract at the definition site. Inline impls are already typed by
 * `layer` / `serverEntry` / `serve`; but the moment you hoist one to a `const` (to share it across the
 * local layer and a served entry, or across several serves) it loses that typing — the mistake then
 * surfaces far away at the serve call, with no autocomplete as you write it. `Resource.make(tag, impl)`
 * infers the tag's spec and constrains `impl` to its {@link ImplOf}, returning it typed. Runtime identity.
 *
 * ```ts
 * const scoresImpl = Resource.make(ScoresDb, { read: … }); // typed here — autocomplete + errors at the def
 * Resource.layer(ScoresDb, scoresImpl);                    // local
 * Resource.serveAllHttp([Resource.serverEntry(ScoresDb, scoresImpl)]); // served — same impl, both typed
 * ```
 *
 * @public
 */
export function make<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  impl: ImplOf<S>,
): ImplOf<S>;
export function make<Self, S extends Spec, R>(
  tag: ResourceTag<Self, S>,
  impl: Effect.Effect<ImplOf<S>, never, R>,
): Effect.Effect<ImplOf<S>, never, R>;
export function make(_tag: unknown, impl: unknown): unknown {
  return impl;
}

// ── type-level: one Spec → the precisely-typed RPC contract group ──

/** The rpc payload schema: the schema itself when the payload IS a schema, a `Schema.Struct<F>`
 * when it declares fields, else `Schema.Void`. */
type PayloadSchemaOf<M extends AnyMethod> = M["payload"] extends Schema.Top
  ? M["payload"]
  : M["payload"] extends infer F extends Schema.Struct.Fields
    ? Schema.Struct<F>
    : Schema.Void;

/**
 * The `Rpc` for one spec method — tag = the method name, schemas from the {@link Method}. A
 * streaming method mirrors `Rpc.make(tag, { …, stream: true })`: its success becomes an
 * `RpcSchema.Stream` (element + stream-error schemas) and its immediate error is `Never`.
 */
type RpcOf<K extends string, M extends AnyMethod> = M["stream"] extends true
  ? Rpc.Rpc<
      K,
      PayloadSchemaOf<M>,
      RpcSchema.Stream<M["success"], M["error"]>,
      typeof Schema.Never
    >
  : Rpc.Rpc<K, PayloadSchemaOf<M>, M["success"], M["error"]>;

/** The union of every wire method's {@link RpcOf} — **path-keyed** across nested groups (local methods
 *  excluded). The `kind` check + {@link AsMethod} keep it reducing under a generic item schema. */
type RpcUnionOf<S extends Spec, Prefix extends string = ""> = {
  readonly [K in keyof S & string]: S[K] extends { readonly kind: MethodKind }
    ? RpcOf<`${Prefix}${K}`, AsMethod<S[K]>>
    : S[K] extends AnyLocalMethod
      ? never
      : S[K] extends Spec
        ? RpcUnionOf<S[K], `${Prefix}${K}.`>
        : never;
}[keyof S & string];

/**
 * The **precisely-typed** RPC contract group for a {@link Spec}. Carrying this exact type
 * (rather than a loose `Rpc<string, …>`) is what keeps the remote client's requirement
 * channel honest: concrete schemas declare `never` encoding/decoding services, so
 * `RpcClient.make` infers a real `R` (just the transport `Protocol`) instead of `any`.
 *
 * @internal
 */
export type RpcGroupOf<S extends Spec> = RpcGroup.RpcGroup<RpcUnionOf<S>>;

/**
 * The context a server layer for a {@link Spec} provides: the handler for every method.
 * Used to pin the server layers' output type so their **requirement** channel stays
 * `never` — `RpcGroup`'s own `ToHandlerFn` defaults that channel to `any`, so without
 * this the inferred server layer would re-leak `any` into anything that consumes it.
 *
 * @internal
 */
export type HandlerContextOf<S extends Spec> = Rpc.ToHandler<RpcUnionOf<S>>;

// ── runtime: one Spec → the shared RPC contract group ──

/**
 * The wire tag of a method on the shared transport: the resource's **group id** prefixes
 * the bare method name (`queue/pause`, `process/stop`). The prefix namespaces a resource's
 * procedures so unrelated resource types sharing one `RpcServer` can't collide on a common
 * method name — it's a transport detail, never part of the logical contract (the type-level
 * tag and the `yield* Tag` service surface stay the bare method name).
 */
const wireTag = (groupId: string, method: string): string => `${groupId}/${method}`;

/**
 * Build the shared RPC contract group from a {@link Spec}, namespaced by `groupId`. A bare
 * `Schema` becomes a payload-free rpc returning that schema; a descriptor maps straight to
 * its parts. Every procedure's wire tag is {@link wireTag}-prefixed by `groupId`.
 *
 * @internal
 */
export const buildRpcGroup = (
  groupId: string,
  spec: FlatSpec,
): RpcGroup.RpcGroup<any> => {
  const rpcs = Object.entries(spec).flatMap(([method, m]) => {
    // local-only members are off-wire — they get no rpc.
    if (isLocalMethod(m)) return [];
    const tag = wireTag(groupId, method);
    const options: {
      payload?: Schema.Struct.Fields | Schema.Top;
      success: Schema.Top;
      error: Schema.Top;
      stream?: boolean;
    } = {
      success: m.success,
      error: m.error,
    };
    if (m.payload !== undefined) options.payload = m.payload;
    // streaming methods become an `RpcSchema.Stream` on the wire (element + stream-error).
    if (m.stream) options.stream = true;
    return [Rpc.make(tag, options)];
  });
  // Boundary assertion (runtime-correct): each entry is built to be exactly the `Rpc`
  // the type derives from the same `spec` — but `Object.entries` erases the literal keys
  // to `string` (and the wire tag carries the group prefix the logical type omits), so the
  // precise per-method type is reattached here. One single source (the spec) drives both.
  return RpcGroup.make(...rpcs) as unknown as RpcGroup.RpcGroup<any>;
};

// ── the Tag: a Context service whose value is `ServiceOf<Spec>` ──

/**
 * Where the contract spec is stowed on a Tag (hidden from the value surface). Exported so
 * the public {@link ResourceTag} type is nameable across modules.
 *
 * @internal
 */
export const specSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/spec",
);
/**
 * Phantom carrier of a tag's (possibly nested) spec type `S`, so functions can **infer** `S` from a tag —
 * {@link specSym} holds the *flat* spec at runtime and can't carry the nested `S`. Type-only, never set at
 * runtime. @internal
 */
declare const specTypeSym: unique symbol;
/** Where the built RPC group is stowed on a Tag. @internal */
export const groupSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/group",
);
/** Where the per-resource local-capability key is stowed on a Tag. @internal */
export const localCapSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/localCap",
);
/** Where a contract's **kind** (its canonical id, e.g. `@nikscripts/effect-pm/QueueResource`) is
 *  stowed on a Tag — set by each contract's `.Tag` factory so consumers (the dashboard) can
 *  classify a tag without sniffing its spec. Absent on a bare {@link Resource.Tag}. @internal */
export const kindSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/kind",
);
/** Where a resource's **readiness derivation** (status → ready) is stowed on a Tag — a sibling of
 *  {@link kindSym}, applied by {@link withReadiness}. Absent ⇒ the resource is ready by default.
 *  @internal */
export const readinessSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/readiness",
);
/** Where the resource's {@link Node} (if any) is stowed on a Tag. @internal */
export const nodeSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/node",
);

// ── readiness: a derived view of a resource's status, aggregated into node /health + NodeStatus ──

/**
 * A resource's readiness — derived from its own status (its single source of truth), aggregated
 * into a node's `/health` and `NodeStatus`. `ready: false` with a `detail` says *why* (surfaced in
 * the `/health` body and the dashboard health board).
 *
 * @public
 */
export interface Readiness {
  readonly ready: boolean;
  readonly detail?: string;
}

/**
 * Derive {@link Readiness} from a resource's materialized service — read its status, don't store new
 * state. The second argument, `base`, is the readiness **already** on the tag (e.g. a contract
 * factory's own check) — `yield* base` to extend it (a queue's `phase === "running"` **and** your
 * dependency checks), or ignore it to replace it. Stacks: each {@link withReadiness} wraps the prior.
 * Attach one with {@link withReadiness}; read the result with {@link readinessCheck}.
 *
 * @public
 */
export type ReadinessOf<Service> = (
  service: Service,
  base: Effect.Effect<Readiness, never, any>,
  // The derivation may depend on services (e.g. `Resource.readinessOf(Database)`); that requirement
  // is satisfied by the serve context the node runs readiness in, and erased at this storage seam.
) => Effect.Effect<Readiness, never, any>;

// ── node: the transport for a resource, carried in the Tag ──

/**
 * The value of a {@link Node} service: the RPC client transport `Protocol` for that node.
 * `Resource.connect(...)` produces a layer providing exactly this (re-keyed under the node),
 * and {@link Resource.client} feeds it to `RpcClient.make` as the `RpcClient.Protocol`.
 *
 * @internal
 */
type NodeProtocol = Context.Service.Shape<typeof RpcClient.Protocol>;

/**
 * The Context key of a {@link Node} (`HSelf` = its identity): a service whose value is the
 * transport {@link NodeProtocol}. Stored on a node-bearing tag under {@link nodeSym}; read by
 * {@link Resource.client} to resolve *where* to connect (its requirement channel).
 *
 * @public
 */
export type NodeKey<HSelf> = Context.Key<HSelf, NodeProtocol>;

/** A {@link Resource.Node} erased — a {@link NodeKey} that also carries its own transport `url`
 *  (decision 2), so a tag's `distributed` set is self-describing and {@link peersLayer} can reach each
 *  one. An element of a tag's fleet. @public */
export type AnyNode = NodeKey<unknown> & { readonly url: string | undefined };

/** Phantom brand for the per-resource {@link peers} capability, so distinct resources' peer sets
 *  don't collide in one context. @internal */
export interface PeersId<Self> {
  readonly _peers: Self;
}

/** Phantom brand for the per-resource {@link selfNode} capability (which node this instance runs as),
 *  so distinct resources' self-node identities don't collide in one context. @internal */
export interface SelfNodeId<Self> {
  readonly _selfNode: Self;
}

/** Holds a tag's `distributed` set (the fleet). @internal */
const nodesSym: unique symbol = Symbol.for("@nikscripts/effect-pm/Resource/distributed");

/** Holds a tag's per-resource {@link peers} capability key. @internal */
const peersSym: unique symbol = Symbol.for("@nikscripts/effect-pm/Resource/peers");

/** Holds a tag's per-resource {@link selfNode} capability key. @internal */
const selfNodeSym: unique symbol = Symbol.for("@nikscripts/effect-pm/Resource/selfNode");

/**
 * The type of a resource tag carrying spec `S` — what {@link Resource.Tag} / a
 * {@link Resource.tagFor} factory produce (and what you extend). Lets a consumer write
 * `<S extends Spec>(tag: ResourceTag<Self, S>)` and read the spec through named types
 * ({@link specOf} / {@link groupOf}) instead of a `Parameters<typeof specOf>` workaround.
 *
 * @public
 */
export interface ResourceTag<Self, S extends Spec>
  extends Context.ServiceClass<Self, string, ServiceOf<S, Self>> {
  /** Wire prefix — namespaces this resource's procedures on a shared `RpcServer`. */
  readonly groupId: string;
  /** Resource-level help text (CLI/TUI section help, dashboard panel title) — if declared. */
  readonly description: string | undefined;
  readonly [specSym]: FlatSpec;
  readonly [specTypeSym]?: S;
  readonly [groupSym]: RpcGroupOf<S>;
  readonly [localCapSym]: Context.Key<
    LocalCapability<Self>,
    { readonly granted: true }
  >;
  /**
   * The resource's {@link Node} (its transport), or `undefined` for a nodeless tag. Uniform
   * across all tags (always present) so a node-bearing tag stays assignable wherever a plain
   * {@link ResourceTag} is expected; the node-bearing tag constructors **narrow** this to a
   * concrete {@link NodeKey} in their return type, which is how {@link Resource.client}
   * discriminates the node-aware path.
   */
  readonly [nodeSym]: NodeKey<unknown> | undefined;
  /** The contract's kind (canonical id) — set by a contract `.Tag` factory, `undefined` for a bare
   *  {@link Resource.Tag}. Read it with {@link kindOf}. */
  readonly [kindSym]: string | undefined;
  /** The resource's readiness derivation, if any (applied by {@link withReadiness}); `undefined`
   *  ⇒ ready by default. Read it via {@link readinessCheck}. */
  readonly [readinessSym]: ReadinessOf<ServiceOf<S, Self>> | undefined;
  /** The per-resource {@link peers} capability key — its value is this resource's peer clients
   *  (the other nodes' leaf services), keyed by node. Provided by {@link peersLayer}, read via {@link peers}. */
  readonly [peersSym]: Context.Key<PeersId<Self>, Record<string, PeerServiceOf<S>>>;
  /** The per-resource {@link selfNode} capability key — its value is the node key this instance runs
   *  as (the same key its peers are keyed by). Provided by {@link peersLayer} / {@link selfNodeLayer},
   *  read via {@link selfNode}. */
  readonly [selfNodeSym]: Context.Key<SelfNodeId<Self>, string>;
  /** The fleet — the tag's `distributed` set, if declared (via {@link distributed}); else `undefined`. */
  readonly [nodesSym]?: ReadonlyArray<AnyNode>;
}

/**
 * A {@link ResourceTag} bound to a concrete {@link Node} — its `[nodeSym]` narrowed to that node's
 * `NodeKey<HSelf>`, which is how {@link Resource.client} discriminates the node-aware path. Returned
 * by the node-bearing tag constructors. It's a **named** type (not an inline `& { [nodeSym] }`) so a
 * consumer can `export` a node-bearing tag without leaking the internal symbol (TS4020).
 *
 * @public
 */
export interface NodeBoundTag<Self, S extends Spec, HSelf>
  extends ResourceTag<Self, S> {
  readonly [nodeSym]: NodeKey<HSelf>;
}

/** The contract kind a tag was built for (e.g. `@nikscripts/effect-pm/QueueResource`), or
 *  `undefined` for a bare {@link Resource.Tag} or any non-tag. The robust replacement for sniffing
 *  a tag's spec; accepts `unknown` so a `Group` member can be passed straight in. @since 1.0.0 */
export const kindOf = (tag: unknown): string | undefined => {
  // A resource tag is a class (so `typeof` is "function"), with the kind stamped as a static.
  if ((typeof tag === "object" || typeof tag === "function") && tag !== null && kindSym in tag) {
    const value = tag[kindSym];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
};

/** The {@link Node} a tag is bound to (its transport key), or `undefined` for a nodeless/bare tag
 *  or any non-tag. Accepts `unknown` so a `Group` member passes straight in — walk a group tree and
 *  collect the distinct nodes to know which nodes back its resources. @since 1.0.0 */
export const nodeOf = (tag: unknown): NodeKey<unknown> | undefined => {
  if ((typeof tag === "object" || typeof tag === "function") && tag !== null && nodeSym in tag) {
    const value = tag[nodeSym];
    return value === undefined ? undefined : (value as NodeKey<unknown>);
  }
  return undefined;
};

/**
 * Attach a {@link Readiness} derivation to a tag — the seam the node's `/health` and `NodeStatus`
 * aggregate over. Each contract applies it from its own status (so readiness can't drift from
 * status); a bare {@link Resource.Tag} can opt in the same way. Dual (data-first or `.pipe`):
 *
 * ```ts
 * class EdgeCache extends Resource.Tag<EdgeCache>()("edge/Cache", {
 *   warm: Resource.effect(Schema.Boolean),
 * }).pipe(
 *   Resource.withReadiness((svc) =>
 *     Effect.map(svc.warm, (warm) => ({ ready: warm, ...(warm ? {} : { detail: "cold" }) })),
 *   ),
 * ) {}
 * ```
 *
 * @public
 */
export const withReadiness: {
  // The input is "any resource tag, node-bound or not" — `NodeBoundTag` is a distinct interface, so
  // it isn't structurally assignable to a bare `ResourceTag<any, any>` (its one invariant member,
  // `[groupSym]`); naming both arms is the honest type for "accepts either variant" (`client` does the
  // same). `Self` is widened to `any` on the data-last form so it works in a class `extends` position
  // without TS resolving the class's own (still-being-declared) type — see test/resource-readiness.
  //
  // data-last (pipe): `tag.pipe(Resource.withReadiness(fn))` — service type derived from the piped tag.
  <T extends ResourceTag<any, any> | NodeBoundTag<any, any, any>>(
    readiness: ReadinessOf<
      T extends ResourceTag<any, infer S extends Spec> ? ServiceOf<S, any> : never
    >,
  ): (tag: T) => T;
  // data-first: `Resource.withReadiness(tag, fn)` — full `ServiceOf<S, Self>` (contracts use this).
  // Two **inferred** overloads (not a fixed `<any,any>` union) so a fully-defined *class* — a
  // `typeof X` constructor — is accepted, the way `client`/`layer` accept one; node-bound first so a
  // node-bound tag keeps its node in the return.
  <Self, S extends Spec, HSelf>(
    tag: NodeBoundTag<Self, S, HSelf>,
    readiness: ReadinessOf<ServiceOf<S, Self>>,
  ): NodeBoundTag<Self, S, HSelf>;
  <Self, S extends Spec>(
    tag: ResourceTag<Self, S>,
    readiness: ReadinessOf<ServiceOf<S, Self>>,
  ): ResourceTag<Self, S>;
} = Fn.dual(
  2,
  <T extends ResourceTag<any, any>>(tag: T, readiness: ReadinessOf<unknown>): T => {
    // Stack onto any readiness already on the tag (e.g. a contract factory's own check): the new
    // derivation receives the prior one (applied to the same service) as `base`, so it can extend
    // it (`yield* base`) or replace it (ignore `base`). `base` flows down the chain from the root.
    const prior = tag[readinessSym];
    const composed: ReadinessOf<ServiceOf<any, any>> = (service, base) =>
      readiness(service, prior === undefined ? base : prior(service, base));
    return Object.assign(tag, { [readinessSym]: composed });
  },
);

/**
 * Run a tag's readiness derivation against its built service. A tag that declares none is **ready by
 * default**, so an unaware or bare resource never falsely fails a node's readiness gate. Accepts
 * `unknown` so a served entry's tag + impl pass straight in. @since 1.0.0
 */
export const readinessCheck = (
  tag: unknown,
  service: unknown,
): Effect.Effect<Readiness> => {
  if ((typeof tag === "object" || typeof tag === "function") && tag !== null && readinessSym in tag) {
    const derive = tag[readinessSym];
    if (typeof derive === "function") {
      // Symbol-stored metadata is type-erased (as with specSym/groupSym); recover the derivation
      // `withReadiness` stored. This single assertion also erases the derivation's requirement (its
      // dependency services are ambient in the serve context the node runs readiness within).
      const fn = derive as (
        service: unknown,
        base: Effect.Effect<Readiness>,
      ) => Effect.Effect<Readiness>;
      // root of the chain: the innermost derivation sees `{ ready: true }` if it reads `base`.
      return fn(service, Effect.succeed({ ready: true }));
    }
  }
  return Effect.succeed({ ready: true });
};

/**
 * Readiness for a **served** resource, where all we have is the wire `impl` (a `value` field is a `Stream`
 * there, a `constant` an `Effect`). Resolve those to plain values first — so the derivation sees the same
 * service shape {@link readinessOf} gives it (the materialized service), not the raw wire impl. The `value`
 * head is read in a short-lived scope so no `Scope` leaks into the result. @internal
 */
const readinessCheckServed = (
  tag: { readonly [specSym]: FlatSpec },
  impl: unknown,
): Effect.Effect<Readiness> =>
  Effect.gen(function* () {
    const spec = tag[specSym];
    const flat = flattenImpl(impl as Record<string, unknown>, spec);
    const view: Record<string, unknown> = {};
    for (const [key, m] of Object.entries(spec)) {
      if (isConstantMethod(m)) {
        setPath(view, key, yield* (flat[key] as Effect.Effect<unknown>));
      } else {
        // ref → its Subscribable (the readiness derivation reads `.get` itself); other wire members as-is
        setPath(view, key, flat[key]);
      }
    }
    return yield* readinessCheck(tag, view);
  });

/**
 * Pull a resource's readiness **by tag** — yields its service and runs its derivation. Use it inside
 * another resource's {@link withReadiness} to make readiness *depend on* a resource it depends on:
 * `yield* Resource.readinessOf(Database)`. The dependency lands in the readiness Effect's
 * requirements, so it's **compile-time checked**, and it works local *or* remote (it re-derives from
 * the dependency's served status). @since 1.0.0
 */
export const readinessOf = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
): Effect.Effect<Readiness, never, Self> =>
  Effect.flatMap(tag, (service) => readinessCheck(tag, service));

/**
 * Combine readiness checks with **AND**: ready iff all are ready, else the first not-ready one (with
 * its detail). Sugar for extending a base with dependency checks:
 * `withReadiness((svc, base) => Resource.allReady([base, Resource.readinessOf(Database)]))`.
 * @since 1.0.0
 */
export const allReady = <R>(
  checks: ReadonlyArray<Effect.Effect<Readiness, never, R>>,
): Effect.Effect<Readiness, never, R> =>
  Effect.map(Effect.all(checks), (results) => {
    const notReady = results.find((r) => !r.ready);
    return notReady ?? { ready: true };
  });

/** Claimed instance keys — duplicate declarations fail fast (Effect won't catch same-key Tags). */
const claimedKeys = new Set<string>();
/** Claimed group ids — the wire prefixes; duplicates would collide on a shared `RpcServer`. */
const claimedGroupIds = new Set<string>();

/** Reserve a group id (wire prefix); a duplicate **throws** — two resources can't share a prefix. */
const claimGroupId = (groupId: string): void => {
  if (claimedGroupIds.has(groupId)) {
    throw new DuplicateGroupId({ groupId });
  }
  claimedGroupIds.add(groupId);
};

/**
 * The single tag-creation primitive: dup-key guard + `Context.Service` + stow groupId/spec/group.
 * Both {@link makeTag} (per-tag spec) and {@link tagFor} (shared spec) go through it. `key` is the
 * instance identity (Context key + routing header); `groupId` is the wire prefix.
 */
const buildInstanceTag = <Self, S extends Spec>(
  groupId: string,
  key: string,
  spec: S,
  group: RpcGroupOf<S>,
  description: string | undefined,
  node: NodeKey<unknown> | undefined,
  kind: string | undefined,
) => {
  if (claimedKeys.has(key)) {
    throw new DuplicateResourceKey({ key });
  }
  claimedKeys.add(key);
  const base = Context.Service<Self, ServiceOf<S, Self>>()(key);
  // per-resource local capability — granted only by localLayer, never the client.
  const localCap: Context.Key<LocalCapability<Self>, { readonly granted: true }> =
    Context.Service<LocalCapability<Self>, { readonly granted: true }>()(
      `${key}/__local`,
    );
  // per-resource peer capability — its value is this resource's other-node clients, provided
  // only by peersLayer (the opt-in mesh), never by default.
  const peersKey: Context.Key<PeersId<Self>, Record<string, PeerServiceOf<S>>> =
    Context.Service<PeersId<Self>, Record<string, PeerServiceOf<S>>>()(`${key}/__peers`);
  // per-resource self-node capability — its value is the node key this instance runs as, provided
  // by peersLayer / selfNodeLayer, never by default.
  const selfNodeKey: Context.Key<SelfNodeId<Self>, string> =
    Context.Service<SelfNodeId<Self>, string>()(`${key}/__selfNode`);
  return Object.assign(base, {
    groupId,
    description,
    [specSym]: flattenSpec(spec),
    [groupSym]: group,
    [localCapSym]: localCap,
    [nodeSym]: node,
    [kindSym]: kind,
    [readinessSym]: undefined,
    [peersSym]: peersKey,
    [selfNodeSym]: selfNodeKey,
  });
};

/**
 * Create a resource service tag from a {@link Spec}. Extend the result, like
 * `Context.Tag`, but the value type is **inferred from the spec**:
 *
 * ```ts
 * class Counter extends Resource.Tag<Counter>()("Counter", {
 *   increment: Resource.effectFn(Schema.Void, { payload: Schema.Struct({ by: Schema.Number }) }),
 *   current: Resource.effect(Schema.Number),
 * }) {}
 *
 * const c = yield* Counter; // { increment: (p) => Effect<void>; current: Effect<number> }
 * ```
 *
 * Keys must be unique: a duplicate **throws at declaration** — Effect's `Context` is
 * keyed by the key string and silently last-write-wins on collisions, so we guard it.
 * For a single resource the key is also its **group id** (the wire prefix for its
 * procedures), so a shared `RpcServer` can node it alongside other resource types.
 *
 * @public
 */
const makeTag = <Self>() => {
  // `Context.Service`-shaped: `Tag<Self>()(key, spec, options?)`. The spec (2nd arg) is the
  // inferring call; `options.node` rides the inferring call so its identity `HSelf` infers from the
  // argument, and the node-bearing overload narrows `[nodeSym]` to a concrete `NodeKey` — which is
  // how `Resource.client` discriminates the node-aware path.
  function build<const S extends Spec>(
    key: string,
    spec: S,
    options?: { readonly description?: string; readonly kind?: string },
  ): ResourceTag<Self, S>;
  function build<const S extends Spec, HSelf>(
    key: string,
    spec: S,
    options: {
      readonly description?: string;
      readonly kind?: string;
      readonly node: NodeKey<HSelf>;
    },
  ): NodeBoundTag<Self, S, HSelf>;
  function build<const S extends Spec>(
    key: string,
    spec: S,
    options?: {
      readonly description?: string;
      readonly kind?: string;
      readonly node?: NodeKey<unknown>;
    },
  ): ResourceTag<Self, S> {
    // single resource: key doubles as the group id (its wire prefix)
    claimGroupId(key);
    return buildInstanceTag<Self, S>(
      key,
      key,
      spec,
      buildRpcGroup(key, flattenSpec(spec)),
      options?.description,
      options?.node,
      options?.kind,
    );
  }
  return build;
};

/**
 * A {@link tagFor} factory: `<Self>(key) => tag`, plus the shared family metadata
 * (`groupId` / `description` / spec / group) that {@link serveInstances} reads without an
 * instance.
 *
 * @public
 */
export interface TagFactory<S extends Spec> {
  <Self>(key: string): ResourceTag<Self, S>;
  readonly groupId: string;
  readonly description: string | undefined;
  readonly [specSym]: FlatSpec;
  readonly [specTypeSym]?: S;
  readonly [groupSym]: RpcGroupOf<S>;
}

/**
 * A node-bearing {@link tagFor} factory: every instance it makes carries the family's
 * {@link Node}, so each is a node-bearing tag ({@link Resource.client} resolves the transport
 * from it). Otherwise identical to {@link TagFactory}.
 *
 * @public
 */
export interface NodeTagFactory<S extends Spec, HSelf> {
  <Self>(key: string): NodeBoundTag<Self, S, HSelf>;
  readonly groupId: string;
  readonly description: string | undefined;
  readonly [specSym]: FlatSpec;
  readonly [specTypeSym]?: S;
  readonly [groupSym]: RpcGroupOf<S>;
}

/**
 * Build a **factory** tag-maker that bakes a shared {@link Spec} once under a `groupId`:
 * every instance shares the same contract + RPC group, and callers **never pass the spec**
 * — only an instance key. Use for resource families (many instances, one contract). The
 * `groupId` (e.g. `"queue"`) is the wire prefix for the family's procedures, so a shared
 * `RpcServer` can node this family next to other resource types without tag collisions;
 * instances are told apart by the per-call `key` header.
 *
 * Pass `options.node` to bind the whole family to a {@link Node}: every instance becomes a
 * node-bearing tag and ships only-the-tag (see {@link Resource.client} / {@link Resource.connect}).
 *
 * ```ts
 * const Queue = Resource.tagFor("queue", { pause: Resource.effectFn(Schema.Void) });
 * class Jobs extends Queue<Jobs>("@app/Jobs") {}  // spec baked in; just the instance key
 * class Mail extends Queue<Mail>("@app/Mail") {}  // shares contract + group, routed by key
 * ```
 *
 * @public
 */
function tagFor<const S extends Spec, HSelf>(
  groupId: string,
  spec: S,
  options: { readonly description?: string; readonly kind?: string; readonly node: NodeKey<HSelf> },
): NodeTagFactory<S, HSelf>;
function tagFor<const S extends Spec>(
  groupId: string,
  spec: S,
  options?: { readonly description?: string; readonly kind?: string },
): TagFactory<S>;
function tagFor<const S extends Spec>(
  groupId: string,
  spec: S,
  options?: { readonly description?: string; readonly kind?: string; readonly node?: NodeKey<unknown> },
): TagFactory<S> {
  claimGroupId(groupId);
  const group = buildRpcGroup(groupId, flattenSpec(spec));
  const node = options?.node;
  const factory = <Self>(key: string) =>
    buildInstanceTag<Self, S>(
      groupId,
      key,
      spec,
      group,
      options?.description,
      node,
      options?.kind,
    );
  // Stow the shared groupId/description/spec/group on the factory too, so the family
  // server ({@link serveInstances}) can read the contract + prefix without an instance.
  return Object.assign(factory, {
    groupId,
    description: options?.description,
    [specSym]: flattenSpec(spec),
    [groupSym]: group,
  });
}

/**
 * Client side of a {@link ref} field: a {@link Subscribable} over the RPC changes stream — `changes` is the
 * stream itself; `get` takes its replayed current head (a `SubscriptionRef`'s changes emit the current value
 * on subscribe). No mirror, no block-for-initial. @internal
 */
// Client side of a ref field: ONE kept-open subscription to the RPC changes stream mirrors the latest into
// a local cache (never closing the wire stream — closing a `Never`-error RPC stream early trips its error
// decode). `get` reads the cache (waiting on the local cache stream for the first value if needed — safe to
// close); `changes` replays from the same cache, so a client opens exactly one wire stream per ref. No
// block-for-initial at build, so a slow/absent source never deadlocks acquisition.
const clientSubscribable = <A>(
  wire: Stream.Stream<A>,
): Effect.Effect<Subscribable<A>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const cache = yield* SubscriptionRef.make<Option.Option<A>>(Option.none());
    yield* Effect.forkScoped(
      Stream.runForEach(wire, (v) => SubscriptionRef.set(cache, Option.some(v))),
    );
    const present: Stream.Stream<A> = SubscriptionRef.changes(cache).pipe(
      Stream.filter(Option.isSome),
      Stream.map((o) => o.value),
    );
    return {
      changes: present,
      get: SubscriptionRef.get(cache).pipe(
        Effect.flatMap(
          Option.match({
            onSome: (v: A) => Effect.succeed(v),
            onNone: () =>
              Stream.runHead(present).pipe(Effect.scoped, Effect.map(Option.getOrThrow)),
          }),
        ),
      ),
    };
  });

/**
 * The **local** layer for a resource: provide a real implementation of its service. Grants
 * the resource's {@link LocalCapability}, so any {@link Resource.local} (local-only) members
 * become callable here — they're a compile error under {@link Resource.client}.
 *
 * Two forms, mirroring {@link serverEntry}: a **record** impl, or an **`Effect`** that builds the impl
 * — the latter for effectful construction (acquire a pool, resolve {@link peers}, …). The `Effect`'s
 * requirement `R` becomes the layer's, so its members close over whatever they need and stay
 * `R = never`; you provide `R` (e.g. `peersLayer`) alongside.
 *
 * @public
 */
function localLayer<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  impl: ImplOf<S>,
): Layer.Layer<Self | LocalCapability<Self>>;
function localLayer<Self, S extends Spec, R>(
  tag: ResourceTag<Self, S>,
  impl: Effect.Effect<ImplOf<S>, never, R>,
): Layer.Layer<Self | LocalCapability<Self>, never, Exclude<R, Scope.Scope>>;
function localLayer<Self, S extends Spec, R>(
  tag: ResourceTag<Self, S>,
  impl: ImplOf<S> | Effect.Effect<ImplOf<S>, never, R>,
): Layer.Layer<Self | LocalCapability<Self>, never, Exclude<R, Scope.Scope>> {
  const cap = tag[localCapSym];
  const spec = tag[specSym];
  // Build the service (from the record or the Effect), then hand back a Context carrying both the
  // service and the granted capability — one `effectContext` layer, so any `Scope` the impl's
  // construction needs is managed by the layer (not merged in separately).
  const build = Effect.gen(function* () {
    const builtImpl = (yield* (Effect.isEffect(impl)
      ? impl
      : Effect.succeed(impl))) as Record<string, unknown>;
    // impl may be nested (grouped) — flatten to path keys matching the flat spec, build the flat service,
    // then nest it back on the way out.
    const members = flattenImpl(builtImpl, spec);
    // build directly into the nested shape (via setPath); the impl was flattened to path keys, so `key`
    // here is the flat path.
    const service: Record<string, unknown> = {};
    for (const [key, m] of Object.entries(spec)) {
      // local members surface as `Effect<T, never, LocalCapability>` (require the cap to obtain the
      // value); constant fields are resolved once here into a plain value; ref fields and other wire
      // members (their `Subscribable` / `Effect` / `Stream` / function) pass through unchanged.
      if (isLocalMethod(m)) {
        setPath(service, key, Effect.as(cap, members[key]));
      } else if (isConstantMethod(m)) {
        setPath(service, key, yield* (members[key] as Effect.Effect<unknown>));
      } else {
        setPath(service, key, members[key]);
      }
    }
    // Boundary assertion (runtime-safe): built from the same spec, key-for-key.
    return Context.make(tag, service as ServiceOf<S, Self>).pipe(
      Context.add(cap, { granted: true }),
    );
  });
  return Layer.effectContext(build);
}

/**
 * The **server** handlers layer for a resource: expose a real implementation over RPC by
 * mounting the contract group's handlers, each delegating to `impl`. Compose with an
 * `RpcServer` + a `Protocol` layer to actually serve over a transport.
 *
 * @public
 */
/** Invoke a wire impl member — spreads 2-tuple payloads when `callStyle` is `"pair"`. @internal */
const invokeWireMethod = (
  member: unknown,
  method: AnyMethod,
  payload: unknown,
): unknown => {
  // a ref's impl is a Subscribable; the wire serves its changes stream (the client rebuilds get from it).
  if (isRefMethod(method)) {
    return (member as Subscribable<unknown>).changes;
  }
  if (typeof member !== "function") {
    return member;
  }
  if (method.annotations.callStyle === "pair" && Array.isArray(payload)) {
    return member(payload[0], payload[1]);
  }
  return member(payload);
};

const serverLayer = <S extends Spec>(
  tag: {
    readonly groupId: string;
    readonly [specSym]: FlatSpec;
    readonly [specTypeSym]?: S;
    readonly [groupSym]: RpcGroupOf<S>;
  },
  impl: WireServiceOf<S>,
): Layer.Layer<HandlerContextOf<S>> => {
  const group = tag[groupSym];
  const handlers: Record<string, (payload: unknown) => unknown> = {};
  // flatten a (possibly nested) impl to path keys matching the flat spec + path-keyed group procedures.
  const flatImpl = flattenImpl(impl as Record<string, unknown>, tag[specSym]);
  for (const [key, member] of Object.entries(flatImpl)) {
    // handlers are keyed by the wire tag (group-prefixed), matching the group's procedures.
    // runtime-checked: payload methods are functions (call them); no-payload methods
    // are `Effect` properties (return as-is, ignoring the payload arg).
    handlers[wireTag(tag.groupId, key)] = (payload) =>
      invokeWireMethod(member, tag[specSym][key] as AnyMethod, payload);
  }
  // Boundary assertion (runtime-safe): the handlers mirror the same spec the group was built from,
  // and RPC validates every payload/result against the spec schemas at the wire. The output pins
  // {@link HandlerContextOf}; any capability `R` the handlers require (e.g. peers) rides the layer's
  // requirement channel, discharged by the serve providing it.
  return group.toLayer(
    handlers as unknown as Parameters<(typeof group)["toLayer"]>[0],
  ) as unknown as Layer.Layer<HandlerContextOf<S>>;
};

/**
 * One served resource's registry entry — its group (folded into the shared server), wire id, kind, and
 * readiness derivation. {@link serve} appends it; {@link httpServer} reads them for the merged server +
 * `/health` + node-status.
 *
 * @public
 */
export interface ServedResource {
  readonly groupId: string;
  readonly group: RpcGroup.RpcGroup<any>;
  readonly kind: string;
  readonly readiness: Effect.Effect<Readiness>;
}

/**
 * The served-resources registry — an accumulator {@link serve} appends to and {@link httpServer} reads.
 * A plain `Ref`-backed list (not type-level state), so many `serve` layers compose under `Layer.mergeAll`
 * and the server sees every one. Provided by {@link httpServer} (or {@link servedResourcesLayer}); `serve`
 * registers **only if it's present** (so `serve` also works standalone).
 *
 * @public
 */
export class ServedResources extends Context.Service<
  ServedResources,
  {
    readonly register: (entry: ServedResource) => Effect.Effect<void>;
    readonly all: Effect.Effect<ReadonlyArray<ServedResource>>;
  }
>()("@nikscripts/effect-pm/Resource/ServedResources") {}

/**
 * A fresh {@link ServedResources} registry. {@link httpServer} bundles one; provide this standalone only
 * to collect `serve` registrations without the http server.
 *
 * @public
 */
export const servedResourcesLayer: Layer.Layer<ServedResources> = Layer.effect(
  ServedResources,
  Effect.gen(function* () {
    const ref = yield* Ref.make<ReadonlyArray<ServedResource>>([]);
    return {
      register: (entry) => Ref.update(ref, (all) => [...all, entry]),
      all: Ref.get(ref),
    };
  }),
);

/**
 * A {@link serve} handler for one wire method — like {@link ServiceMethod}, but the handler may carry a
 * **run-time requirement `R`** (a dependency it `yield*`s), which {@link serve} preserves so a
 * per-resource `Layer.provide` can discharge it in isolation.
 *
 * @public
 */
export type ServeMethod<M extends AnyMethod, R> = M["stream"] extends true
  ? [M["payload"]] extends [undefined]
    ? Stream.Stream<SuccessOf<M>, ErrorOf<M>, R>
    : (payload: PayloadOf<M>) => Stream.Stream<SuccessOf<M>, ErrorOf<M>, R>
  : [M["payload"]] extends [undefined]
    ? Effect.Effect<SuccessOf<M>, ErrorOf<M>, R>
    : (payload: PayloadOf<M>) => Effect.Effect<SuccessOf<M>, ErrorOf<M>, R>;

/**
 * The implementation {@link serve} expects — the tag's wire members, whose handlers may share a run-time
 * requirement `R`. `R` is inferred from the impl (via {@link ServeRequirements}, the union of every
 * handler's requirement) and preserved on the returned layer, so it's discharged **per resource** by
 * `Layer.provide`, not shared ambiently.
 *
 * @public
 */
export type ServeImplOf<S extends Spec, R> = {
  readonly [K in keyof S as S[K] extends AnyLocalMethod ? never : K]: S[K] extends {
    readonly _tag: "ref";
  }
    ? Subscribable<SuccessOf<AsMethod<S[K]>>>
    : S[K] extends { readonly kind: MethodKind }
      ? ServeMethod<AsMethod<S[K]>, R>
      : S[K] extends Spec
        ? ServeImplOf<S[K], R>
        : never;
};

/**
 * The union of every handler's run-time requirement `R` in a {@link serve} impl — extracted from the
 * impl value (not a mapped-type parameter), so `serve` can **infer** it. Each member is one of the four
 * {@link ServeMethod} forms; a member that requires nothing contributes `never`.
 *
 * @public
 */
export type ServeRequirements<Impl> = {
  [K in keyof Impl]: Impl[K] extends (payload: never) => Effect.Effect<unknown, unknown, infer R>
    ? R
    : Impl[K] extends (payload: never) => Stream.Stream<unknown, unknown, infer R>
      ? R
      : Impl[K] extends Effect.Effect<unknown, unknown, infer R>
        ? R
        : Impl[K] extends Stream.Stream<unknown, unknown, infer R>
          ? R
          : never;
}[keyof Impl];

/**
 * A resource's **handler layer** — mounts the tag's group handlers, with the handlers' requirement `R`
 * **preserved** (not erased). Unlike {@link serverLayer}, whose `R` is erased to `never` (so all handlers
 * share one ambient provide), `serve`'s `R` rides the layer's requirement channel, so a per-resource
 * `Layer.provide` discharges *this* resource's dependency in isolation:
 *
 * ```ts
 * Resource.serve(SeasonMatches, seasonMatchesImpl).pipe(Layer.provide(importHandlersLayer))
 * ```
 *
 * `R = never` (a handler that closes over its dependency at build) behaves exactly like `serverLayer`.
 * The point of `serve` is the run-time-requirement case: N resources needing different implementations of
 * the same tag, each isolated — merge the `serve` layers onto one `RpcServer` (groups are prefix-keyed).
 *
 * @public
 */
export const serve = <S extends Spec, Impl extends ServeImplOf<S, any>>(
  tag: {
    readonly groupId: string;
    readonly [specSym]: FlatSpec;
    readonly [specTypeSym]?: S;
    readonly [groupSym]: RpcGroupOf<S>;
  },
  impl: Impl,
): Layer.Layer<HandlerContextOf<S>, never, ServeRequirements<Impl>> => {
  const group = tag[groupSym];
  const handlers: Record<string, (payload: unknown) => unknown> = {};
  // flatten a (possibly nested) impl to path keys matching the flat spec + path-keyed group procedures.
  const flatImpl = flattenImpl(impl as Record<string, unknown>, tag[specSym]);
  for (const [key, member] of Object.entries(flatImpl)) {
    handlers[wireTag(tag.groupId, key)] = (payload) =>
      invokeWireMethod(member, tag[specSym][key] as AnyMethod, payload);
  }
  // dynamic handler construction (the same boundary `serverLayer` uses); the outer assertion **preserves**
  // the handlers' requirement `R` — extracted from `impl` by {@link ServeRequirements} — instead of
  // erasing it, so a per-resource `Layer.provide` can discharge it. `HandlerContextOf<S>` is the rpc
  // handler slots; the requirement is the union of the handlers' run-time needs.
  const handlerLayer = group.toLayer(
    handlers as unknown as Parameters<(typeof group)["toLayer"]>[0],
  );
  // register into the served-resources registry when one is present (`httpServer` provides it), so the
  // shared server + `/health` discover this resource without the caller listing it twice. Merged (not
  // provided) so it isn't pruned as unused; a no-op when no registry is in context (standalone `serve`).
  const registration = Layer.effectDiscard(
    Effect.serviceOption(ServedResources).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (registry) =>
            registry.register({
              groupId: tag.groupId,
              group,
              kind: kindOf(tag) ?? "resource",
              readiness: readinessCheckServed(tag, impl),
            }),
        }),
      ),
    ),
  );
  return Layer.merge(handlerLayer, registration) as unknown as Layer.Layer<
    HandlerContextOf<S>,
    never,
    ServeRequirements<Impl>
  >;
};

/**
 * Serve a resource **and** grant its local instance from **one** materialization — the co-located "expose
 * it over RPC AND consume it in-process" case (a node that serves its resources and also `yield*`s them,
 * e.g. to read a {@link Resource.local} member). The impl runs **once**, so its cells / pollers / resolved
 * {@link peers} are shared: the served view and the in-process view are the **same instance** — no double
 * materialization, no second `peersLayer`. Register onto a node with {@link httpServer} like any
 * {@link serve} layer; a served-**only** gateway (never consumed locally) uses {@link serve} directly.
 *
 * Use the **`Effect` form** when the impl needs a capability to build (resolve `peers` / a pool once; the
 * members close over it) — `R` is discharged here, shared by both the grant and the handlers.
 *
 * @public
 */
export const serveLocal = <Self, S extends Spec, R = never>(
  tag: ResourceTag<Self, S>,
  impl: ImplOf<S> | Effect.Effect<ImplOf<S>, never, R>,
): Layer.Layer<Self | LocalCapability<Self> | HandlerContextOf<S>, never, R> =>
  Layer.unwrap(
    Effect.map(Effect.isEffect(impl) ? impl : Effect.succeed(impl), (built) =>
      Layer.merge(
        localLayer(tag, built),
        // `built` is a valid serve impl, but `ImplOf` keeps `local` members that `ServeImplOf` omits
        // (off the wire) — a structural gap the compiler can't bridge, the same boundary `serve` casts at.
        // `R` was discharged by the Effect form above, so the handlers are requirement-free.
        serve(tag, built as unknown as ServeImplOf<S, never>) as unknown as Layer.Layer<
          HandlerContextOf<S>,
          never,
          never
        >,
      ),
    ),
  );

/** Options for {@link httpServer}. @public */
export interface HttpServerOptions {
  readonly path?: HttpRouter.PathInput;
  readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  readonly health?: { readonly path?: HttpRouter.PathInput };
}

const httpServerBase = (
  options?: HttpServerOptions,
): Layer.Layer<never, never, ServedResources | HttpServer.HttpServer> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const registry = yield* ServedResources;
      const entries = yield* registry.all;
      if (entries.length === 0) {
        throw new Error(
          "Resource.httpServer: no resources registered — provideMerge at least one Resource.serve(...) layer",
        );
      }
      const startedAt = yield* Clock.currentTimeMillis;
      const merged = entries
        .map((entry) => entry.group)
        .reduce((acc, group) => acc.merge(group));
      const readiness = Effect.forEach(entries, (entry) =>
        Effect.map(entry.readiness, (result) => ({
          key: entry.groupId,
          kind: entry.kind,
          ready: result.ready,
          ...(result.detail !== undefined ? { detail: result.detail } : {}),
        })),
      );
      const rpcAppLayer = RpcServer.layerHttp({
        group: merged,
        path: options?.path ?? "/rpc",
        protocol: "http",
      });
      const healthRoute = HttpRouter.add(
        "GET",
        options?.health?.path ?? "/health",
        Effect.gen(function* () {
          const ts = yield* Clock.currentTimeMillis;
          const resources = yield* readiness;
          const ok = resources.every((resource) => resource.ready);
          return yield* HttpServerResponse.json({
            status: ok ? "ok" : "degraded",
            listening: true,
            resources,
            uptimeMillis: ts - startedAt,
            ts,
          }).pipe(
            Effect.map((response) => HttpServerResponse.setStatus(response, ok ? 200 : 503)),
            Effect.orDie,
          );
        }),
      );
      return HttpRouter.serve(Layer.merge(rpcAppLayer, healthRoute)).pipe(
        Layer.provideMerge(options?.serialization ?? defaultSerialization),
      );
    }),
  ) as unknown as Layer.Layer<never, never, ServedResources | HttpServer.HttpServer>;

// Array form of `Layer.mergeAll` (which needs a non-empty *tuple*): fold the list into one layer. The
// `httpServer` overload guarantees a non-empty list; untyped plumbing behind that typed overload.
const mergeLayers = (
  layers: ReadonlyArray<Layer.Layer<any, never, any>>,
): Layer.Layer<any, never, any> =>
  layers.reduce((acc, layer) => Layer.merge(acc, layer));

/**
 * The shared http server for resources composed with {@link serve} — the multi-resource,
 * heterogeneous-dependency counterpart to {@link serveHttp} / {@link serveAllHttp}. Reads the
 * {@link ServedResources} registry, merges every registered group onto **one** `RpcServer` at `path`
 * (default `/rpc`), and mounts a `/health` route aggregating each resource's readiness. Because each
 * `serve` layer carries **its own** `Layer.provide`d dependency, resources needing different
 * implementations of the same tag stay isolated — no shared union-provide.
 *
 * Pass the `serve` layers as the first argument (recommended) — it bundles the `provideMerge` +
 * {@link servedResourcesLayer}, so you list resources and provide only the platform (and any shared
 * dependency):
 *
 * ```ts
 * const Node = Resource.httpServer([
 *   Resource.serve(A, implA).pipe(Layer.provide(depA)),
 *   Resource.serve(B, implB).pipe(Layer.provide(depB)),
 * ], { health: { path: "/health" } }).pipe(
 *   Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
 * );
 * ```
 *
 * The low-level `httpServer(options)` form requires you to `Layer.provideMerge` the `serve` layers (kept,
 * not pruned) + {@link servedResourcesLayer} yourself. Either way the handlers ride the context the
 * `serve` layers provide; if one is missing the `RpcServer` fails at **build** (a clear boot error), never
 * a silent runtime gap.
 *
 * @public
 */
export function httpServer(
  options?: HttpServerOptions,
): Layer.Layer<never, never, ServedResources | HttpServer.HttpServer>;
export function httpServer<R>(
  serves: readonly [
    Layer.Layer<any, never, R>,
    ...ReadonlyArray<Layer.Layer<any, never, R>>,
  ],
  options?: HttpServerOptions,
): Layer.Layer<never, never, R | HttpServer.HttpServer>;
export function httpServer(
  servesOrOptions?:
    | ReadonlyArray<Layer.Layer<any, never, any>>
    | HttpServerOptions,
  maybeOptions?: HttpServerOptions,
): Layer.Layer<never, never, unknown> {
  // the serves form bundles the boilerplate: provideMerge the serve layers (kept, not pruned) + the
  // shared registry, so the caller lists resources and provides only the platform (+ any shared dep).
  if (Array.isArray(servesOrOptions)) {
    return httpServerBase(maybeOptions).pipe(
      Layer.provideMerge(mergeLayers(servesOrOptions)),
      Layer.provide(servedResourcesLayer),
    ) as unknown as Layer.Layer<never, never, unknown>;
  }
  return httpServerBase(servesOrOptions as HttpServerOptions | undefined);
}

/**
 * Provide one dependency `Layer` to several {@link serve} layers at once — sugar for
 * `Layer.mergeAll(resources).pipe(Layer.provide(dependency))`. Reads as "these resources, on this
 * dependency," so a group that shares an implementation states it once:
 *
 * ```ts
 * Resource.provide(ImportHandlers.layer, [
 *   Resource.serve(SeasonMatches,   seasonMatchesImpl),
 *   Resource.serve(LiveScorePoller, pollerImpl),
 * ])
 * ```
 *
 * It's plain `Layer.provide` underneath — no config-embedded layer — so sharing stays governed by
 * memoization (same `dependency` value → one instance; `Layer.fresh` to isolate).
 *
 * @public
 */
export const provide = <ROut, EL, RL, A, E, R>(
  dependency: Layer.Layer<ROut, EL, RL>,
  resources: readonly [Layer.Layer<A, E, R>, ...ReadonlyArray<Layer.Layer<A, E, R>>],
): Layer.Layer<A, E | EL, Exclude<R, ROut> | RL> =>
  Layer.mergeAll(...resources).pipe(Layer.provide(dependency));

/**
 * Expose a resource over **http** in one call — the server mirror of {@link connectHttp}, and
 * the batteries-included form of {@link serverLayer}. Mounts the contract group on an http
 * `RpcServer` at `path` (default `/rpc`) with the impl's handlers and the serialization codec
 * (default {@link defaultSerialization}, matching the client). The only thing left to provide
 * is an `HttpServer` (platform-specific — e.g. `NodeHttpServer.layer({ port })`), since the
 * bind address is a deployment concern:
 *
 * ```ts
 * const JobsServer = Resource.serveHttp(Jobs, jobsImpl).pipe(
 *   Layer.provideMerge(NodeHttpServer.layer({ port: 3001 })),
 * );
 * ```
 *
 * @public
 */
const serveHttp = <S extends Spec>(
  tag: {
    readonly groupId: string;
    readonly [specSym]: FlatSpec;
    readonly [specTypeSym]?: S;
    readonly [groupSym]: RpcGroupOf<S>;
  },
  impl: WireServiceOf<S>,
  options?: {
    readonly path?: HttpRouter.PathInput;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
) =>
  HttpRouter.serve(
    RpcServer.layerHttp({
      group: tag[groupSym],
      path: options?.path ?? "/rpc",
      protocol: "http",
    }).pipe(Layer.provide(serverLayer(tag, impl))),
  ).pipe(Layer.provideMerge(options?.serialization ?? defaultSerialization));

/**
 * An entry for {@link serveAllHttp}: a resource tag + its built impl. Use {@link Resource.server}'s
 * impl shape (the same `WireServiceOf` you pass to {@link serveHttp}).
 *
 * @public
 */
export interface ServeEntry<R = never> {
  readonly tag: {
    readonly groupId: string;
    readonly [specSym]: FlatSpec;
    readonly [groupSym]: RpcGroup.RpcGroup<any>;
  };
  /**
   * The resource's impl — either the built service record (a plain resource), or an `Effect` that
   * builds it (a toolkit resource whose engine/worker is constructed at assembly, carrying its
   * worker requirement `R`). Use `QueueResource.serverEntry` / `ScheduledProcess.serverEntry` to
   * produce the effect form.
   */
  readonly impl:
    | Record<string, unknown>
    | Effect.Effect<Record<string, unknown>, never, R>;
}

/**
 * A typed {@link ServeEntry} for a **raw** custom resource — `serveAllHttp`'s counterpart to
 * {@link Resource.layer} for serving. The impl is **spec-checked** against the tag's {@link Spec}
 * (`WireServiceOf<S>`), so a typo or missing method is a compile error — a hand-written `{ tag, impl }`
 * literal is typed `Record<string, unknown>` and silently accepts them. Mirrors
 * `QueueResource.serverEntry` / `ScheduledProcess.serverEntry` / `ApiMetrics.serverEntry`. Note
 * {@link instance} is **not** this — it builds a `ResourceInstance` for the {@link serveInstances}
 * family and won't fit `serveAllHttp`.
 *
 * Two impl forms: a plain **record** (`R = never`), or an **`Effect`** that builds the record at
 * assembly and carries a requirement `R` (e.g. a pooled connection) — `R` is surfaced into the entry
 * so `serveAllHttp` demands + unions it, instead of erasing it as a bare `{ tag, impl }` literal would.
 *
 * ```ts
 * Resource.serveAllHttp([
 *   Resource.serverEntry(Database, { status: pingStatus }),        // record impl
 *   Resource.serverEntry(Cache, Effect.map(Pool, makeCacheImpl)),  // Effect impl, R = Pool
 *   QueueResource.serverEntry(RosterQueue, { effect }),
 * ]);
 * ```
 *
 * @public
 */
// record impl (plain resource — no requirement)
function serverEntry<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  impl: WireServiceOf<S>,
): ServeEntry<never>;
// Effect impl (built at assembly, carrying a requirement `R` — e.g. a pooled connection, or serving
// the resource's own provided service): `R` is surfaced into the entry, so `serveAllHttp` demands it
// (and unions it across entries) instead of it being erased.
function serverEntry<Self, S extends Spec, R>(
  tag: ResourceTag<Self, S>,
  impl: Effect.Effect<WireServiceOf<S>, never, R>,
): ServeEntry<R>;
function serverEntry<Self, S extends Spec, R>(
  tag: ResourceTag<Self, S>,
  impl: WireServiceOf<S> | Effect.Effect<WireServiceOf<S>, never, R>,
): ServeEntry<R> {
  return { tag, impl };
}

/** One entry's requirement `R`, with `any`/`unknown` collapsed to `never` — a plain `{ tag, impl }`
 *  literal (impl a `Record`, no `Effect`) leaves `R` unconstrained, so it infers `unknown` (or `any`);
 *  treat that as "no requirement" rather than poisoning the whole union. Typed entries (`serverEntry`,
 *  the contract `serverEntry`s) carry a real `R` that's kept. */
type EntryR<E> = E extends ServeEntry<infer R>
  ? 0 extends 1 & R
    ? never
    : unknown extends R
      ? never
      : R
  : never;

/** Union of every entry's requirement — `serveAllHttp`'s result `R` (see {@link EntryR}). */
type ServeEntriesR<Entries extends ReadonlyArray<ServeEntry<any>>> = EntryR<Entries[number]>;

/**
 * Serve **many** resources on **one** http `RpcServer` (one port) — the multi-resource counterpart
 * to {@link serveHttp}. Each resource's procedures are group-id-prefixed, so they coexist on the
 * one `/rpc` endpoint without collision; clients reach each via `Resource.client(Tag)` over a single
 * {@link connectHttp} transport (typically a shared {@link Node}). This is how a whole group runs
 * behind one port.
 *
 * ```ts
 * const LeagueServer = Resource.serveAllHttp([
 *   { tag: RosterQueue, impl: rosterImpl },
 *   { tag: SeasonMatches, impl: seasonImpl },
 * ]).pipe(Layer.provideMerge(NodeHttpServer.layer({ port: 3001 })));
 * ```
 *
 * @public
 */
const serveAllHttp = <const Entries extends ReadonlyArray<ServeEntry<any>>>(
  entries: Entries,
  options?: {
    readonly path?: HttpRouter.PathInput;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
    /** Readiness `/health` route (always mounted; set `path` to relocate it). A dumb probe gets
     *  `200`/`503`; the JSON body lists the node's resources for a dashboard health board. */
    readonly health?: {
      readonly path?: HttpRouter.PathInput;
    };
  },
  // Entries can carry *different* requirements (a queue's worker `R`, an ApiMetrics entry's `Scope`, a
  // plain resource's `never`); union them — like `Layer.mergeAll` — instead of pinning all to one `R`.
): Layer.Layer<never, never, ServeEntriesR<Entries> | HttpServer.HttpServer> => {
  if (entries.length === 0) {
    throw new Error("Resource.serveAllHttp: at least one resource is required");
  }
  // Build each impl (an Effect form carries the engine/worker requirement R; a plain record is
  // lifted with succeed), then merge every resource's RpcGroup into one (procedures are
  // group-id-prefixed → no collision) and merge their handler tables into one toLayer over the
  // combined group. The merge is dynamic (heterogeneous specs), so types are erased through
  // `unknown`; the result type is pinned to `R | HttpServer` — the union of worker requirements
  // plus the http server to listen on (same shape as a single `serveHttp`).
  return Layer.unwrap(
    Effect.gen(function* () {
      // Every node auto-serves the reserved node status resource (status / logs / ping) alongside
      // the user's resources, so a client can inspect any node without the author wiring it.
      // Dynamic import keeps `nodeStatusResource` (which imports this module) out of a static cycle;
      // the entry is folded in before building so all entries stay one (erased) type.
      const { nodeStatusServeEntry } = yield* Effect.promise(
        () => import("./internal/nodeStatusResource"),
      );
      const startedAt = yield* Clock.currentTimeMillis;
      const buildImpl = (entry: ServeEntry<any>) =>
        (Effect.isEffect(entry.impl)
          ? entry.impl
          : Effect.succeed(entry.impl)
        ).pipe(Effect.map((impl) => ({ tag: entry.tag, impl })));
      // Build the user's resources first so the readiness aggregate can close over their impls —
      // both the `/health` route and the node-status resource read this ONE aggregate (SSOT): each
      // resource's own `readiness` derivation (default: ready), keyed by tag + kind.
      const userBuilt = yield* Effect.forEach(entries, buildImpl);
      const readiness = Effect.forEach(userBuilt, ({ tag, impl }) =>
        Effect.map(readinessCheckServed(tag, impl), (r) => ({
          key: tag.groupId,
          kind: kindOf(tag) ?? "resource",
          ready: r.ready,
          ...(r.detail !== undefined ? { detail: r.detail } : {}),
        })),
      );
      const nodeBuilt = yield* buildImpl(
        nodeStatusServeEntry({ startedAt, resourceCount: entries.length, readiness }),
      );
      const built = [...userBuilt, nodeBuilt];
      const merged = built
        .map((b) => b.tag[groupSym])
        .reduce((acc, group) => acc.merge(group));
      const handlers: Record<string, (payload: unknown) => unknown> = {};
      for (const { tag, impl } of built) {
        // flatten a (possibly nested) impl to path keys matching the flat spec + path-keyed procedures.
        const flatImpl = flattenImpl(
          impl as Record<string, unknown>,
          tag[specSym],
        );
        for (const [key, member] of Object.entries(flatImpl)) {
          handlers[wireTag(tag.groupId, key)] = (payload) =>
            invokeWireMethod(member, tag[specSym][key] as AnyMethod, payload);
        }
      }
      const rpcAppLayer = RpcServer.layerHttp({
        group: merged,
        path: options?.path ?? "/rpc",
        protocol: "http",
      }).pipe(
        Layer.provide(
          merged.toLayer(
            handlers as unknown as Parameters<(typeof merged)["toLayer"]>[0],
          ),
        ),
      );
      // A plain HTTP readiness route alongside `/rpc` — a dumb probe (deploy gate, load balancer)
      // gets a status code; the JSON body lists the node's resources for a dashboard health board.
      // Readiness aggregates each resource's own derivation; if any is down the node is `degraded`
      // → 503 (so a deploy gate won't promote a half-booted node).
      const healthRoute = HttpRouter.add(
        "GET",
        options?.health?.path ?? "/health",
        Effect.gen(function* () {
          const ts = yield* Clock.currentTimeMillis;
          const resources = yield* readiness;
          const ok = resources.every((r) => r.ready);
          return yield* HttpServerResponse.json({
            status: ok ? "ok" : "degraded",
            listening: true,
            resources,
            uptimeMillis: ts - startedAt,
            ts,
          }).pipe(
            Effect.map((res) => HttpServerResponse.setStatus(res, ok ? 200 : 503)),
            Effect.orDie,
          );
        }),
      );
      return HttpRouter.serve(Layer.merge(rpcAppLayer, healthRoute)).pipe(
        Layer.provideMerge(options?.serialization ?? defaultSerialization),
      );
    }),
  ) as unknown as Layer.Layer<never, never, ServeEntriesR<Entries> | HttpServer.HttpServer>;
};

/** The header carrying the target instance key, set per-call by {@link forwardClient}. */
const INSTANCE_KEY_HEADER = "key";

/**
 * One instance of a factory paired with its implementation — the element of
 * {@link Resource.serveInstances}. Built by {@link Resource.instance}.
 *
 * @public
 */
export interface ResourceInstance<S extends Spec> {
  readonly key: string;
  readonly impl: WireServiceOf<S>;
}

/**
 * Pair a factory instance tag with its implementation, for {@link Resource.serveInstances}.
 *
 * **Not** how you serve a single custom resource on a shared node: this returns a
 * {@link ResourceInstance} for the {@link serveInstances} family, which `serveAllHttp` rejects. To
 * serve a custom `Resource.Tag` alongside queues/processes, use {@link Resource.serverEntry} (a
 * spec-checked `serveAllHttp` entry), then reach it with {@link Resource.client}.
 *
 * @public
 */
const instance = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  impl: WireServiceOf<S>,
): ResourceInstance<S> => ({ key: tag.key, impl });

/**
 * The **family server** layer: serve **many instances of one factory** behind a
 * single contract group, dispatching each request to the right instance by the
 * per-call `key` header. Instances share one {@link tagFor} factory (one spec, one
 * RPC group); each is passed once via {@link Resource.instance}.
 *
 * Why one variadic call rather than one-layer-per-instance: composing instances as
 * sibling layers would silently keep only the last (Effect's `Context` is a map —
 * same-key layers last-write-wins). Passing them together is the foolproof shape:
 * every instance is wired, and a duplicate key **throws at assembly**.
 *
 * ```ts
 * const Queue = Resource.tagFor("queue", { pause: Resource.effectFn(Schema.Void) });
 * class Jobs extends Queue<Jobs>("@app/Jobs") {}
 * class Mail extends Queue<Mail>("@app/Mail") {}
 *
 * const serveAll = Resource.serveInstances(
 *   Queue,
 *   Resource.instance(Jobs, jobsImpl),
 *   Resource.instance(Mail, mailImpl),
 * );
 * ```
 *
 * @public
 */
const serveInstances = <S extends Spec>(
  factory: {
    readonly groupId: string;
    readonly [specSym]: FlatSpec;
    readonly [specTypeSym]?: S;
    readonly [groupSym]: RpcGroupOf<S>;
  },
  ...instances: ReadonlyArray<ResourceInstance<S>>
): Layer.Layer<HandlerContextOf<S>> => {
  const group = factory[groupSym];
  const spec = factory[specSym];

  // Build the routing table once, at assembly: key → instance impl (flattened to path keys so nested
  // groups dispatch by the same path-keyed procedures the handlers use). A duplicate key is a wiring
  // mistake — fail loudly rather than silently shadow an instance.
  const table = new Map<string, Record<string, unknown>>();
  for (const { key, impl } of instances) {
    if (table.has(key)) {
      throw new DuplicateInstance({ key });
    }
    table.set(key, flattenImpl(impl as Record<string, unknown>, spec));
  }

  // One handler per contract method; each reads the instance-key header, looks up the
  // instance, and dispatches. A missing/unknown key is a protocol-level fault
  // (the contract is satisfied) → die, not a typed domain error.
  const handlers: Record<
    string,
    (payload: unknown, options: { readonly headers: Headers.Headers }) => unknown
  > = {};
  for (const key of Object.keys(spec)) {
    // handlers are keyed by the wire tag (group-prefixed), matching the group's procedures.
    handlers[wireTag(factory.groupId, key)] = (payload, options) => {
      const instanceKey = Option.getOrUndefined(Headers.get(options.headers, INSTANCE_KEY_HEADER));
      if (instanceKey === undefined) {
        return Effect.die(
          new InstanceRoutingError({ method: key, reason: "missing-key" }),
        );
      }
      const impl = table.get(instanceKey);
      if (impl === undefined) {
        return Effect.die(
          new InstanceRoutingError({ method: key, reason: "unknown-key", key: instanceKey }),
        );
      }
      const member = (impl as Record<string, unknown>)[key];
      return invokeWireMethod(member, spec[key] as AnyMethod, payload);
    };
  }

  // Boundary assertion (runtime-safe): handlers mirror the shared spec the group
  // was built from, and RPC validates every payload/result at the wire. Output pinned
  // to {@link HandlerContextOf} to keep the layer's requirement channel `never`.
  return group.toLayer(
    handlers as unknown as Parameters<(typeof group)["toLayer"]>[0],
  ) as unknown as Layer.Layer<HandlerContextOf<S>>;
};

/**
 * The RPC group built from a tag's spec — used to wire the client/server and tests.
 *
 * @internal
 */
export const groupOf = <S extends Spec>(tag: {
  readonly [specSym]: FlatSpec;
  readonly [specTypeSym]?: S;
  readonly [groupSym]: RpcGroupOf<S>;
}): RpcGroupOf<S> => tag[groupSym];

/**
 * The {@link Spec} a tag was built from — used to wire the client forwarder and tests.
 *
 * @internal
 */
export const specOf = <S extends Spec>(tag: {
  readonly [specSym]: FlatSpec;
  readonly [specTypeSym]?: S;
}): FlatSpecOf<S> => tag[specSym] as unknown as FlatSpecOf<S>;

/**
 * Map an RPC client + a spec into the typed service, forwarding each method to its
 * group-prefixed wire tag and pinning the instance key as a header. Shared by
 * {@link Resource.client} (production, over a real `Protocol`) and the in-memory
 * round-trip test (client from `RpcTest`).
 *
 * @internal
 */
export const forwardClient = <S extends Spec>(
  rpc: unknown,
  spec: S,
  groupId: string,
  instanceKey: string,
): WireServiceOf<S> => {
  const headers = { key: instanceKey };
  // narrowest possible assertion: keyed by string only — the precise per-tag signatures are
  // erased by the dynamic lookup, so we assert nothing about the values and instead verify
  // each is callable at runtime before use (a malformed client fails loudly, never mis-calls).
  const calls = rpc as Record<string, unknown>;
  const service: Record<string, unknown> = {};
  // iterate the FLAT (path-keyed) spec so members are leaves; the built flat service is nested by the
  // caller (buildClientService) when needed. Precise `WireServiceOf<S>` is restored at the return.
  for (const [key, m] of Object.entries(flattenSpec(spec as unknown as Spec))) {
    // local-only members aren't on the wire — the client stubs them (see clientLayer).
    if (isLocalMethod(m)) continue;
    // the wire tag is group-prefixed; the service surface keeps the bare method name
    const call = calls[wireTag(groupId, key)];
    // completeness + callability check — `typeof` narrows `call` to a callable, so the
    // invocations below need no further assertion.
    if (typeof call !== "function") {
      throw new MissingContractMethod({ method: key });
    }
    service[key] =
      m.payload === undefined
        ? call(undefined, { headers })
        : m.annotations.callStyle === "pair"
          ? (arg0: unknown, arg1?: unknown) => call([arg0, arg1], { headers })
          : (payload: unknown) => call(payload, { headers });
  }
  // Boundary assertion (runtime-safe): every method verified present above; RPC validates
  // every payload/result against the spec schemas at the wire.
  return service as unknown as WireServiceOf<S>;
};

/**
 * Declare a **node** — a named transport endpoint a resource connects to. A `Context.Service`
 * whose value is the RPC client {@link NodeProtocol}; extend it like any Effect service:
 *
 * ```ts
 * class EdgeNode extends Resource.Node<EdgeNode>("edge") {}
 * ```
 *
 * Attach it to a tag (`Resource.Tag<Self>(key)(spec, EdgeNode)`) to make the tag carry its own
 * transport — then ship only the tag: {@link Resource.client} reads the node to resolve where
 * to connect, and a consumer wires the transport once with {@link Resource.connect}.
 *
 * @public
 */
const makeNode = <Self>(name: string, options?: { readonly url?: string }) =>
  Object.assign(Context.Service<Self, NodeProtocol>()(name), {
    url: options?.url,
  });

/**
 * Wire a {@link Node}'s transport, **once**, from any RPC client `Protocol` layer — the
 * transport-agnostic primitive (use {@link connectHttp} for the batteries-included http case).
 * Re-keys that `Protocol` under the node, so {@link Resource.client} resolves it for every tag
 * bound to this node; provide one `Resource.connect(...)` per node an app talks to.
 *
 * ```ts
 * const EdgeLive = Resource.connect(EdgeNode, RpcClient.layerProtocolWebsocket({ url }).pipe(
 *   Layer.provide(RpcSerialization.layerNdjson),
 *   Layer.provide(socketLayer),
 * ));
 * ```
 *
 * @public
 */
const connectLayer = <Self, RIn>(
  node: NodeKey<Self>,
  protocol: Layer.Layer<RpcClient.Protocol, never, RIn>,
): Layer.Layer<Self, never, RIn> =>
  Layer.effect(node, RpcClient.Protocol).pipe(Layer.provide(protocol));

/** The default RPC serialization: newline-delimited JSON — handles both one-shot and
 * **streaming** responses, and is shared by {@link connectHttp} + {@link serveHttp} so a
 * client and server can't silently disagree on the codec. */
const defaultSerialization: Layer.Layer<RpcSerialization.RpcSerialization> =
  RpcSerialization.layerNdjson;

/**
 * Wire a {@link Node}'s transport over **http**, the common case — `Resource.connect` with
 * batteries included. Builds the http client `Protocol` (Fetch + serialization) from a `url`
 * and re-keys it under the node. Serialization defaults to {@link defaultSerialization}
 * (ndjson), matching {@link serveHttp}'s default so the two sides agree by construction.
 *
 * ```ts
 * const EdgeLive = Resource.connectHttp(EdgeNode, { url: "http://10.0.0.2:3002/rpc" });
 * ```
 *
 * @public
 */
const connectHttp = <Self>(
  node: NodeKey<Self> & { readonly url?: string },
  options?: {
    readonly url?: string;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self> => {
  // the url lives on the node by default (decision 2 — the node carries everything to reach it);
  // an explicit `options.url` overrides. One or the other must be present.
  const url = options?.url ?? node.url;
  if (url === undefined) {
    throw new MissingNodeUrl({ node: node.key });
  }
  return connectLayer(
    node,
    RpcClient.layerProtocolHttp({ url }).pipe(
      Layer.provide(options?.serialization ?? defaultSerialization),
      Layer.provide(FetchHttpClient.layer),
    ),
  );
};

// ── multi-node: the fleet + peer clients ──

/**
 * Declare a resource's **fleet** — the nodes it's served on — piped onto the tag (like
 * {@link withReadiness}). Variadic; each {@link Node} carries its own url (decision 2), so the tag is
 * self-describing. Read by {@link peersLayer} to reach the other nodes.
 *
 * ```ts
 * class Database extends Resource.Tag<Database>()("app/Database", spec).pipe(
 *   Resource.distributed(NwslNode, EbwslNode, WnbaNode),
 * ) {}
 * ```
 *
 * @public
 */
export const distributed: {
  // data-last (pipe): mirrors `withReadiness` — the data-first overloads (which infer `Self`/`S` and
  // return the *specific* tag) are what let a class `extends … .pipe(distributed(...))` resolve without
  // recursing on its own type, so `distributed` is `Fn.dual` too (not a bare curry).
  <T extends ResourceTag<any, any> | NodeBoundTag<any, any, any>>(
    nodes: ReadonlyArray<AnyNode>,
  ): (tag: T) => T;
  <Self, S extends Spec, HSelf>(
    tag: NodeBoundTag<Self, S, HSelf>,
    nodes: ReadonlyArray<AnyNode>,
  ): NodeBoundTag<Self, S, HSelf>;
  <Self, S extends Spec>(
    tag: ResourceTag<Self, S>,
    nodes: ReadonlyArray<AnyNode>,
  ): ResourceTag<Self, S>;
} = Fn.dual(
  2,
  <T extends ResourceTag<any, any>>(tag: T, nodes: ReadonlyArray<AnyNode>): T =>
    Object.assign(tag, { [nodesSym]: nodes }),
);

/**
 * Build a **peer** service — a fully **lazy** client for folding across nodes ({@link combineQuery} /
 * {@link combineStream}). Unlike {@link buildClientService} it never resolves `constant`s or subscribes
 * `value` fields at build: those open a connection and (for a `value`) block on the initial push, so a
 * co-booting or down peer would hang the whole serve. A `value` is read **one-shot** here (`Stream.runHead`
 * → its replayed current), so the network is touched only when a fold runs, and `combineQuery` drops an
 * unreachable peer instead of deadlocking at build. @internal
 */
const buildPeerService = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  rpc: unknown,
): PeerServiceOf<S> => {
  const wire = forwardClient(rpc, tag[specSym], tag.groupId, tag.key) as Record<
    string,
    unknown
  >;
  const service: Record<string, unknown> = {};
  for (const [key, m] of Object.entries(tag[specSym])) {
    if (isRefMethod(m)) {
      // one-shot current value: subscribe, take the first (the replayed current), close. Lazy — no
      // connection until folded; fails (dropped by combineQuery) if the peer is unreachable.
      setPath(
        service,
        key,
        Stream.runHead(wire[key] as Stream.Stream<unknown>).pipe(
          Effect.scoped,
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.die(new Error(`peer value "${key}" produced no value`)),
              onSome: (v) => Effect.succeed(v),
            }),
          ),
        ),
      );
    } else {
      // effect / effectFn / stream / constant — already their lazy wire form (Effect/Stream); no eager
      // resolve/subscribe. Locals aren't on the wire.
      setPath(service, key, wire[key]);
    }
  }
  return service as PeerServiceOf<S>;
};

/** Build a lazy client to one peer node over http (its own `url`), scoped to its transport. Fully lazy —
 *  see {@link buildPeerService} (nothing connects until a fold reads a field). */
const buildPeerClient = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  url: string,
): Effect.Effect<PeerServiceOf<S>, never, Scope.Scope> =>
  Effect.gen(function* () {
    // build the http protocol into the enclosing scope, then feed its value to the client (a value
    // provide, not a layer provide — so it doesn't break scope lifetimes; same shape as clientLayer).
    const context = yield* Layer.build(
      RpcClient.layerProtocolHttp({ url }).pipe(
        Layer.provide(defaultSerialization),
        Layer.provide(FetchHttpClient.layer),
      ),
    );
    const client: unknown = yield* Effect.provideService(
      RpcClient.make(tag[groupSym] as RpcGroup.RpcGroup<any>),
      RpcClient.Protocol,
      Context.get(context, RpcClient.Protocol),
    );
    return buildPeerService(tag, client);
  });

/**
 * The resource's **peer clients** — the OTHER nodes' full services, keyed by node — for a resource's
 * *own* cross-node logic. Requires the {@link peersLayer} capability. Fold them with `/MultiNode`'s
 * `combineQuery`/`combineStream` (or iterate) and add your own value:
 *
 * ```ts
 * totalConnections: combineQuery(peers, (p) => p.connections, Combine.sum).pipe(
 *   Effect.map((others) => pool.activeCount() + others), // self + peers — you write self in
 * )
 * ```
 *
 * **Fold over per-instance ("leaf") fields** (`p.connections`), not a peer's own fleet field
 * (`p.totalConnections`) — a peer client is the full service, so a fleet field is *callable* but would
 * make it re-gather *its* peers (a cross-node fan-out, not what you want in a fold). The plain-query
 * model has no type-level leaf/fleet distinction, so this is a convention, not a compile error.
 *
 * @public
 */
export const peers = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
): Effect.Effect<Record<string, PeerServiceOf<S>>, never, PeersId<Self>> => tag[peersSym];

/**
 * The node key this instance runs as — the **same key** its {@link peers} are keyed by. For folds that
 * key per node (`Combine.byNode`), so a resource's own logic can name its **own** row without
 * hand-threading the node key. Requires the {@link selfNodeLayer} / {@link peersLayer} capability:
 *
 * ```ts
 * fleetStatus: Effect.gen(function* () {
 *   const self = yield* Resource.selfNode(FleetDatabase); // the node key I am
 *   const peers = yield* Resource.peers(FleetDatabase);
 *   const byNode = yield* combineQuery(peers, (p) => p.status, Combine.byNode);
 *   return { ...byNode, [self]: yield* ownStatus }; // key my own row, consistently
 * })
 * ```
 *
 * @public
 */
export const selfNode = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
): Effect.Effect<string, never, SelfNodeId<Self>> => tag[selfNodeSym];

/**
 * Provide the {@link selfNode} capability on **this** node — the node key this instance runs as. Bundled
 * into {@link peersLayer} (so a mesh resource gets it for free); use this standalone when a resource
 * keys per node but doesn't gather peers, or alongside {@link peersFrom} in a test. No transport, no
 * failure path — just the identity.
 *
 * @public
 */
export const selfNodeLayer = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  self: AnyNode,
): Layer.Layer<SelfNodeId<Self>> => Layer.succeed(tag[selfNodeSym], self.key);

/**
 * Provide the {@link peers} capability on **this** node: connect every OTHER node in the tag's
 * {@link distributed} set and expose them as the peer clients. Also provides the {@link selfNode}
 * capability (this node's key) for `byNode`-style folds. The **opt-in mesh** — add it to a node's serve
 * only where the resource's own logic reaches across nodes. `self` is the node you are, so you're
 * excluded from your own peer set.
 *
 * **Peer urls:** each {@link Node}'s own `url` is the default (the standard practice — the node carries
 * how to reach it). Pass `options.url` to **override** per node — an env-specific port, a tunnel, or a
 * value from Effect `Config` — falling back to `Node.url` when the resolver returns `undefined`. A node
 * with no url from either source is **skipped** (never a throw), so a partial mesh degrades cleanly. The
 * resolver's error and requirements flow to the layer (typed): a `Config`-backed resolver surfaces a
 * `ConfigError` as a typed layer-build failure — fail-fast on a misconfigured url — or return `undefined`
 * (e.g. via `Config.option`) to skip that peer instead.
 *
 * @public
 */
export const peersLayer = <Self, S extends Spec, EIn = never, RIn = never>(
  tag: ResourceTag<Self, S>,
  self: AnyNode,
  options?: {
    /** The fleet (including `self`) — supply it **at the use site** so a shared resource can be defined
     *  node-free and exported; falls back to the tag's baked-in {@link distributed} set when omitted. */
    readonly nodes?: ReadonlyArray<AnyNode>;
    readonly url?: (node: AnyNode) => Effect.Effect<string | undefined, EIn, RIn>;
  },
): Layer.Layer<PeersId<Self> | SelfNodeId<Self>, EIn, RIn> =>
  Layer.merge(
    Layer.effect(
      tag[peersSym],
      Effect.gen(function* () {
        // fleet from the use site (`options.nodes`) or the tag's baked set; drop self to get the peers.
        const fleet = options?.nodes ?? tag[nodesSym] ?? [];
        const others = fleet.filter((node) => node.key !== self.key);
        // the node's own url is the default; an optional resolver overrides it, falling back to the url.
        const resolveUrl = (node: AnyNode): Effect.Effect<string | undefined, EIn, RIn> =>
          options?.url === undefined
            ? Effect.succeed(node.url)
            : Effect.map(options.url(node), (override) => override ?? node.url);
        const resolved = yield* Effect.forEach(others, (node) =>
          Effect.map(resolveUrl(node), (url) => ({ key: node.key, url })),
        );
        const entries = yield* Effect.forEach(
          // a node with no url anywhere is skipped — a partial mesh, not a failure
          resolved.filter(
            (entry): entry is { readonly key: string; readonly url: string } =>
              entry.url !== undefined,
          ),
          ({ key, url }) =>
            Effect.map(buildPeerClient(tag, url), (client) => [key, client] as const),
        );
        // Boundary: each peer client is a full `ServiceOf<S>` — a width-supertype of the leaf
        // `PeerServiceOf<S>` the capability exposes — but the mapped types don't reduce under a generic
        // `S`, so TS can't see the overlap; the erasure through `unknown` is the honest boundary.
        return Object.fromEntries(entries) as unknown as Record<string, PeerServiceOf<S>>;
      }),
    ),
    selfNodeLayer(tag, self),
  );

/**
 * Provide the {@link peers} capability from an **explicit** client map — for a holder that already
 * holds the per-node clients (a dashboard's per-node bundles), or for a test. {@link peersLayer} is
 * the auto-connecting form (from the tag's `distributed` set + urls); this one takes the clients as-is.
 *
 * @public
 */
export const peersFrom = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  peers: Record<string, PeerServiceOf<S>>,
): Layer.Layer<PeersId<Self>> => Layer.succeed(tag[peersSym], peers);

/**
 * A **fleet-health fold** — `pick` a leaf value from every peer, key it **by node** (`Combine.byNode`),
 * and add **this** node's own value keyed by {@link selfNode}. The canned form of the recurring
 * droplet-health-table pattern, on the {@link peers} + {@link selfNode} + `/MultiNode` primitives:
 *
 * ```ts
 * // in a resource's layer — a `fleet` field returning one row per node
 * fleetStatus: Resource.fleetHealth(FleetDatabase, (peer) => peer.status, ownStatus)
 * ```
 *
 * A down peer is skipped (its `pick` failure is captured, never thrown) — a partial table, not an error.
 * Requires the {@link peersLayer} capability (which bundles {@link selfNode}). The only error / requirement
 * is `own`'s.
 *
 * @public
 */
export const fleetHealth = <Self, S extends Spec, A, EPick, EOwn, ROwn>(
  tag: ResourceTag<Self, S>,
  pick: (peer: PeerServiceOf<S>) => Effect.Effect<A, EPick>,
  own: Effect.Effect<A, EOwn, ROwn>,
): Effect.Effect<
  Record<string, A>,
  EOwn,
  ROwn | PeersId<Self> | SelfNodeId<Self>
> =>
  Effect.gen(function* () {
    const self = yield* selfNode(tag);
    const peerClients = yield* peers(tag);
    const byNode = yield* combineQuery(peerClients, pick, Combine.byNode);
    const ownValue = yield* own;
    return { ...byNode, [self]: ownValue };
  });

/**
 * Build the client-side service for a tag from a wired RPC client: forward every wire method
 * (group-prefixed, id-pinned), and stub each {@link Resource.local} member with a value that
 * requires the never-granted {@link LocalCapability} (so calling one through a client is a
 * compile error, and unreachable at runtime). Shared by both {@link clientLayer} paths.
 */
const buildClientService = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  rpc: unknown,
): Effect.Effect<ServiceOf<S, Self>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wire = forwardClient(rpc, tag[specSym], tag.groupId, tag.key) as Record<
      string,
      unknown
    >;
    const cap = tag[localCapSym];
    // build directly into the nested shape (via setPath) so `value` setters write the object the consumer
    // holds; `wire` + `tag[specSym]` are flat path keys.
    const service: Record<string, unknown> = {};
    for (const [key, m] of Object.entries(tag[specSym])) {
      if (isLocalMethod(m)) {
        setPath(
          service,
          key,
          Effect.flatMap(cap, () => Effect.die(new LocalOnlyMethod({ method: key }))),
        );
      } else if (isConstantMethod(m)) {
        // resolve the constant's query once at acquire → a plain value
        setPath(service, key, yield* (wire[key] as Effect.Effect<unknown>));
      } else if (isRefMethod(m)) {
        // a Subscribable over the RPC changes stream (one kept-open subscription → local cache)
        setPath(service, key, yield* clientSubscribable(wire[key] as Stream.Stream<unknown>));
      } else {
        setPath(service, key, wire[key]);
      }
    }
    // Boundary assertion (runtime-safe): built from the spec, key-for-key.
    return service as ServiceOf<S, Self>;
  });

/**
 * The **client** layer for a resource: drive it over RPC **as if it were local** — the exact
 * same `yield* Tag` code as the local layer, only the provided layer differs, so it doesn't
 * matter where the resource actually runs.
 *
 * Three paths, by whether — and where — the tag names a {@link Node}:
 * - **node-bearing tag** — the transport is resolved from the tag's node; the layer's only
 *   requirement is that node (satisfied by {@link Resource.connect}). Ship just the tag.
 * - **nodeless tag, node at the client** — a multi-node resource is N instances (one per node), so
 *   the client names *which* instance: `client(tag, node)`. The transport is resolved from that node
 *   (like a node-bearing tag), so the layer requires the node — satisfied by {@link Resource.connect}.
 *   The requirement is enforced at compile time, so there's no way to wire it wrong at runtime.
 * - **nodeless tag, ambient transport** — the transport is taken from the ambient `RpcClient.Protocol`,
 *   supplied at wire-up. (Remote use stays optional: a nodeless resource can also just run locally via
 *   {@link Resource.layer}, or be served as its own process.)
 *
 * @public
 */
function clientLayer<Self, S extends Spec, HSelf>(
  tag: NodeBoundTag<Self, S, HSelf>,
): Layer.Layer<Self, never, HSelf>;
function clientLayer<Self, S extends Spec, HSelf>(
  tag: ResourceTag<Self, S>,
  node: NodeKey<HSelf>,
): Layer.Layer<Self, never, HSelf>;
function clientLayer<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
): Layer.Layer<Self, never, RpcClient.Protocol>;
function clientLayer<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  node?: NodeKey<unknown>,
): Layer.Layer<Self, never, RpcClient.Protocol> {
  const group = tag[groupSym];
  // an explicit `node` (for a nodeless tag) wins; otherwise the tag's own node, if any.
  const nodeKey = node ?? tag[nodeSym];
  // no node anywhere: take the transport from the ambient `RpcClient.Protocol` — fully typed, no cast.
  if (nodeKey === undefined) {
    return Layer.effect(
      tag,
      Effect.flatMap(RpcClient.make(group), (client) =>
        buildClientService(tag, client),
      ),
    );
  }
  // node chosen (from the tag or the argument): resolve the transport from that node service and
  // provide it locally to the client, so the layer requires the node rather than the ambient
  // Protocol. Reading a provided node service can't fail and `RpcClient.make` has no error channel,
  // so client construction never fails or dies — only the resulting method calls carry typed errors.
  // The node identity is erased to `unknown` on the base tag; the two node-typed overloads pin the
  // precise `HSelf` for callers, so this one contained boundary assertion restates the impl's return.
  const layer = Layer.effect(
    tag,
    Effect.flatMap(
      Effect.flatMap(nodeKey, (protocol) =>
        Effect.provideService(
          RpcClient.make(group),
          RpcClient.Protocol,
          protocol,
        ),
      ),
      (client) => buildClientService(tag, client),
    ),
  );
  return layer as Layer.Layer<Self, never, RpcClient.Protocol>;
}

/** A wire-only instance tag for {@link clientInstances} — keyed via the covariant
 * {@link Context.Key} base so distinct `Self`s are accepted without `any`. @internal */
type WireInstanceTag<S extends Spec> = Context.Key<unknown, WireServiceOf<S>> & {
  readonly key: string;
};

/** The instance identifiers a {@link clientInstances} layer provides (the union of tag `Self`s). */
type InstanceIdentifiers<
  Tags extends ReadonlyArray<unknown>,
  S extends Spec,
> = Tags[number] extends Context.Key<infer Self, WireServiceOf<S>> ? Self : never;

/**
 * The **client** layer for **many instances of one factory**, sharing a single RPC client —
 * the client mirror of {@link Resource.serveInstances}. Builds **one** `RpcClient` for the
 * family's group and provides every instance's handle from it, each pinned to its own instance-key
 * header. So 100 instances of one control shape cost **one** client (and one shared
 * connection), not one client each — the contract/group/schemas are already shared.
 *
 * Wire-only: instances declaring {@link Resource.local} members aren't accepted (their service
 * type is wider than the wire) — use {@link Resource.client} per instance for those.
 *
 * @public
 */
const clientInstances = <
  S extends Spec,
  const Tags extends ReadonlyArray<WireInstanceTag<S>>,
>(
  factory: {
    readonly groupId: string;
    readonly [specSym]: FlatSpec;
    readonly [specTypeSym]?: S;
    readonly [groupSym]: RpcGroupOf<S>;
  },
  ...tags: Tags
): Layer.Layer<InstanceIdentifiers<Tags, S>, never, RpcClient.Protocol> =>
  Layer.effectContext(
    Effect.map(RpcClient.make(factory[groupSym]), (rpc) => {
      let context = Context.empty();
      for (const tag of tags) {
        const service = nestService(
          forwardClient(rpc, factory[specSym], factory.groupId, tag.key),
        ) as WireServiceOf<S>;
        context = Context.add(context, tag, service);
      }
      // The only cast here: TS can't track the identifier union accumulated by the
      // per-instance `Context.add` loop. Runtime-safe — built key-for-key from `tags`.
      return context as Context.Context<InstanceIdentifiers<Tags, S>>;
    }),
  );

// ── stream helpers: tag-dispatched consumption of an event stream ──

/** Anything with a string discriminant `_tag` — the element of an event stream. @internal */
type TaggedEvent = { readonly _tag: string };

/**
 * A partial set of per-`_tag` handlers over a tagged-event union — the handler-map form of
 * {@link Resource.runForEachTag}. Each handler receives the **narrowed** event for its tag.
 *
 * @public
 */
export type TagHandlers<A extends TaggedEvent, E, R> = Partial<{
  readonly [K in A["_tag"]]: (
    event: Extract<A, { readonly _tag: K }>,
  ) => Effect.Effect<void, E, R>;
}>;

/** The union of every handler's error channel (extracted via `infer`, like `Effect.catchTags`). */
type HandlersError<Cases> = {
  [K in keyof Cases]: Cases[K] extends (
    event: never,
  ) => Effect.Effect<unknown, infer E, unknown>
    ? E
    : never;
}[keyof Cases];

/** The union of every handler's requirement channel — so `R` doesn't leak to `unknown`. */
type HandlersContext<Cases> = {
  [K in keyof Cases]: Cases[K] extends (
    event: never,
  ) => Effect.Effect<unknown, unknown, infer R>
    ? R
    : never;
}[keyof Cases];

/**
 * Consume a tagged-event {@link Stream}, dispatching each element to a handler by its `_tag` —
 * the stream-native replacement for lifecycle callbacks (one off-fiber consumer, not a fiber
 * per item). Pass a **single tag + handler** or a **handler map**; **data-first or pipeable**.
 * Built on `Match`, so handlers are fully typed with no casts; unhandled tags are ignored.
 *
 * ```ts
 * yield* jobs.events.pipe(Resource.runForEachTag({
 *   Failed:  ({ entry, cause }) => Effect.logError(`failed ${entry.entryId}`, cause),
 *   Drained: ({ completed })    => Effect.log(`drained @ ${completed}`),
 * }))
 * yield* Resource.runForEachTag(jobs.events, "Exit", (e) =>
 *   e.exit.pipe(Effect.catchTags({ Timeout: …, Rejected: … })),
 * )
 * ```
 *
 * @public
 */
export const runForEachTag: {
  // ── data-last (pipeable) ──
  // `Cases` is inferred from the literal; E/R are EXTRACTED from the handlers via `infer`
  // (not inferrable params), so `A` can unify at the pipe site without dragging R to `unknown`.
  <
    A extends TaggedEvent,
    Cases extends TagHandlers<A, unknown, unknown>,
  >(
    handlers: Cases,
  ): (
    self: Stream.Stream<A>,
  ) => Effect.Effect<void, HandlersError<Cases>, HandlersContext<Cases>>;
  <A extends TaggedEvent, const K extends A["_tag"], E, R>(
    tag: K,
    f: (event: Extract<A, { readonly _tag: K }>) => Effect.Effect<void, E, R>,
  ): (self: Stream.Stream<A>) => Effect.Effect<void, E, R>;
  // ── data-first ──
  <A extends TaggedEvent, const K extends A["_tag"], E, R>(
    self: Stream.Stream<A>,
    tag: K,
    f: (event: Extract<A, { readonly _tag: K }>) => Effect.Effect<void, E, R>,
  ): Effect.Effect<void, E, R>;
  <A extends TaggedEvent, Cases extends TagHandlers<A, unknown, unknown>>(
    self: Stream.Stream<A>,
    handlers: Cases,
  ): Effect.Effect<void, HandlersError<Cases>, HandlersContext<Cases>>;
} = Fn.dual(
  (args) => Stream.isStream(args[0]),
  // Impl is typed over the concrete `TaggedEvent` base so `Match` (which needs a concrete
  // union, not a generic) type-checks with no casts; the overload signatures above carry the
  // precise per-tag types to callers.
  <E, R>(
    self: Stream.Stream<TaggedEvent>,
    tagOrHandlers: string | TagHandlers<TaggedEvent, E, R>,
    f?: (event: TaggedEvent) => Effect.Effect<void, E, R>,
  ): Effect.Effect<void, E, R> => {
    const matcher =
      typeof tagOrHandlers === "string"
        ? Match.type<TaggedEvent>().pipe(
            Match.tag(tagOrHandlers, f ?? (() => Effect.void)),
            Match.orElse(() => Effect.void),
          )
        : Match.type<TaggedEvent>().pipe(
            Match.tags(tagOrHandlers),
            Match.orElse(() => Effect.void),
          );
    return Stream.runForEach(self, matcher);
  },
);

/**
 * Like {@link runForEachTag}, but **non-blocking**: it forks the consumer into the enclosing
 * {@link Scope} ({@link Effect.forkScoped}) and hands back the {@link Fiber}, instead of running
 * the stream to completion. This is the common case for live observation — start watching the
 * `events`/`status`/`metrics` of a queue (or any tagged stream) in the background while the rest
 * of your program runs; the fiber is **interrupted automatically when the scope closes** (the
 * `Effect.scoped` block ends, or the owning layer is torn down), so you never track or kill it.
 *
 * Each handler's error surfaces in the **fiber's** failure channel (not the caller's). If you
 * instead want to *block* until a (finite) stream drains — e.g. in a test — use
 * {@link runForEachTag} and `yield*` it directly, or `Fiber.join` the fiber this returns.
 *
 * ```ts
 * // no manual `Effect.forkScoped` — observation runs in the background, bound to the scope
 * yield* queue.events.pipe(Resource.runForEachTagScoped({
 *   Completed: ({ entry }) => Effect.log(`done ${entry.entryId}`),
 *   Failed:    ({ cause }) => Effect.logError("job failed", cause),
 * }))
 * ```
 *
 * @public
 */
export const runForEachTagScoped: {
  // ── data-last (pipeable) ──
  <A extends TaggedEvent, Cases extends TagHandlers<A, unknown, unknown>>(
    handlers: Cases,
  ): (
    self: Stream.Stream<A>,
  ) => Effect.Effect<
    Fiber.Fiber<void, HandlersError<Cases>>,
    never,
    HandlersContext<Cases> | Scope.Scope
  >;
  <A extends TaggedEvent, const K extends A["_tag"], E, R>(
    tag: K,
    f: (event: Extract<A, { readonly _tag: K }>) => Effect.Effect<void, E, R>,
  ): (
    self: Stream.Stream<A>,
  ) => Effect.Effect<Fiber.Fiber<void, E>, never, R | Scope.Scope>;
  // ── data-first ──
  <A extends TaggedEvent, const K extends A["_tag"], E, R>(
    self: Stream.Stream<A>,
    tag: K,
    f: (event: Extract<A, { readonly _tag: K }>) => Effect.Effect<void, E, R>,
  ): Effect.Effect<Fiber.Fiber<void, E>, never, R | Scope.Scope>;
  <A extends TaggedEvent, Cases extends TagHandlers<A, unknown, unknown>>(
    self: Stream.Stream<A>,
    handlers: Cases,
  ): Effect.Effect<
    Fiber.Fiber<void, HandlersError<Cases>>,
    never,
    HandlersContext<Cases> | Scope.Scope
  >;
} = Fn.dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(
    self: Stream.Stream<TaggedEvent>,
    tagOrHandlers: string | TagHandlers<TaggedEvent, E, R>,
    f?: (event: TaggedEvent) => Effect.Effect<void, E, R>,
  ): Effect.Effect<Fiber.Fiber<void, E>, never, R | Scope.Scope> =>
    // Delegate to the blocking consumer, then fork it into the enclosing scope. The two-arg
    // (single-tag) and one-arg (handler-map) shapes are dispatched by `runForEachTag` itself.
    Effect.forkScoped(
      f === undefined
        ? runForEachTag(self, tagOrHandlers as TagHandlers<TaggedEvent, E, R>)
        : runForEachTag(self, tagOrHandlers as string, f),
    ),
);

/**
 * Resource toolkit — schema-defined service tags. Same `yield* Tag` everywhere; only the
 * layer changes: {@link Resource.layer} runs it locally, {@link Resource.client} drives it
 * remotely, {@link Resource.server} exposes a local impl over RPC.
 *
 * @public
 */
export {
  makeTag as Tag,
  tagFor,
  makeNode as Node,
  connectLayer as connect,
  connectHttp,
  instance,
  localLayer as layer,
  serverLayer as server,
  serverEntry,
  serveHttp,
  serveAllHttp,
  serveInstances,
  clientLayer as client,
  clientInstances,
};
// `query`, `mutate`, `stream`, `local`, `runForEachTag`, `runForEachTagScoped` are already
// exported above under their public names. The whole surface is now a tree-shakeable module
// namespace: **`import * as Resource from "@nikscripts/effect-pm/Resource"`** — `Resource.Tag`
// / `Resource.Node` pull only what's used.

