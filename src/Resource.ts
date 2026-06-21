/**
 * **Resource toolkit** — schema-defined service tags with local + remote (RPC) layers.
 *
 * @remarks
 * Lightweight by construction: imports only `Schema` and `effect/unstable/rpc`, never a
 * heavy implementation. A {@link Spec} is the single source for a resource's wire
 * contract — the inferred service interface, the client forwarder, and the server
 * handlers all derive from it.
 *
 * Each method is built by {@link Resource.query} (idempotent read) or
 * {@link Resource.mutate} (mutation); tool metadata (help text, destructive hint) rides
 * `.annotate({...})`:
 *
 * ```ts
 * class Counter extends Resource.Tag<Counter>("@app/Counter")({
 *   current: Resource.query(Schema.Number).annotate({ description: "Current value." }),
 *   add: Resource.mutate(Schema.Void, { payload: { by: Schema.Number } }),
 *   reset: Resource.mutate(Schema.Void).annotate({ destructive: true }),
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
 * - {@link Resource.server} — expose one local impl over RPC;
 * - {@link Resource.serveInstances} — serve many factory instances behind one group,
 *   routed by the per-call `id` header.
 *
 * @module Resource
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Headers } from "effect/unstable/http";
import { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc";

/**
 * How a method behaves, for tools (CLI/TUI/dashboard) — **explicit, never inferred**;
 * encoded by the constructor used ({@link Resource.query} vs {@link Resource.mutate}):
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
}

/** Brands a {@link Method} so a spec entry is distinguishable from a plain object. */
const methodTypeId: unique symbol = Symbol.for("@nikscripts/effect-pm/Resource/method");

/**
 * One method of a resource contract — built by {@link Resource.query} / {@link Resource.mutate}.
 * Carries its `kind`, schemas (`payload` / `success` / `error`), and tool annotations.
 * `.annotate({...})` returns a copy with merged annotations, mirroring Effect's schema idiom.
 *
 * @public
 */
export interface Method<
  Kind extends MethodKind,
  P extends Schema.Struct.Fields | undefined,
  Su extends Schema.Top,
  E extends Schema.Top,
> {
  readonly [methodTypeId]: typeof methodTypeId;
  readonly kind: Kind;
  readonly payload: P;
  readonly success: Su;
  readonly error: E;
  readonly annotations: MethodAnnotations;
  readonly annotate: (annotations: MethodAnnotations) => Method<Kind, P, Su, E>;
}

/** Any {@link Method}, erased — the element type of a {@link Spec}. @public */
export type AnyMethod = Method<
  MethodKind,
  Schema.Struct.Fields | undefined,
  Schema.Top,
  Schema.Top
>;

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

/** Brands a {@link LocalMethod} so a spec entry is distinguishable from a wire {@link Method}. */
const localMethodTypeId: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/localMethod",
);

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
  readonly [localMethodTypeId]: typeof localMethodTypeId;
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
export type Spec = Record<string, AnyMethod | AnyLocalMethod>;

/** Runtime guard: is a spec entry a {@link LocalMethod} (vs a wire {@link Method})? */
const isLocalMethod = (m: AnyMethod | AnyLocalMethod): m is AnyLocalMethod =>
  localMethodTypeId in m;

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
  [localMethodTypeId]: localMethodTypeId,
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
}

/**
 * Read the tool metadata for a {@link Method}: its `kind`, `description`, and `destructive`
 * flag. Pure annotation — does not touch the wire contract.
 *
 * @public
 */
export const methodMeta = (m: AnyMethod): MethodMeta => ({
  kind: m.kind,
  description: m.annotations.description,
  destructive: m.annotations.destructive ?? false,
});

/** The single {@link Method} constructor — both {@link query} and {@link mutate} go through it. */
const makeMethod = <
  Kind extends MethodKind,
  P extends Schema.Struct.Fields | undefined,
  Su extends Schema.Top,
  E extends Schema.Top,
>(
  kind: Kind,
  payload: P,
  success: Su,
  error: E,
  annotations: MethodAnnotations,
): Method<Kind, P, Su, E> => ({
  [methodTypeId]: methodTypeId,
  kind,
  payload,
  success,
  error,
  annotations,
  annotate: (a) =>
    makeMethod(kind, payload, success, error, { ...annotations, ...a }),
});

/**
 * Define a **query** (idempotent read) returning `success`. Add a `payload` and/or `error`
 * via options; attach help/metadata with `.annotate({ description, ... })`.
 *
 * ```ts
 * size: Resource.query(Schema.Number).annotate({ description: "Total pending." }),
 * get: Resource.query(Schema.User, { payload: { id: Schema.String } }),
 * ```
 *
 * @public
 */
export function query<Su extends Schema.Top>(
  success: Su,
): Method<"query", undefined, Su, Schema.Never>;
export function query<Su extends Schema.Top, const F extends Schema.Struct.Fields>(
  success: Su,
  options: { readonly payload: F },
): Method<"query", F, Su, Schema.Never>;
export function query<Su extends Schema.Top, E extends Schema.Top>(
  success: Su,
  options: { readonly error: E },
): Method<"query", undefined, Su, E>;
export function query<
  Su extends Schema.Top,
  const F extends Schema.Struct.Fields,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: F; readonly error: E },
): Method<"query", F, Su, E>;
export function query(
  success: Schema.Top,
  options?: {
    readonly payload?: Schema.Struct.Fields;
    readonly error?: Schema.Top;
  },
): AnyMethod {
  return makeMethod(
    "query",
    options?.payload,
    success,
    options?.error ?? Schema.Never,
    {},
  );
}

/**
 * Define a **mutate** (mutation) returning `success` (use `Schema.Void` when it returns
 * nothing). Add a `payload` and/or `error` via options; attach help/metadata with
 * `.annotate({ description, destructive })`.
 *
 * ```ts
 * pause: Resource.mutate(Schema.Void).annotate({ description: "Pause." }),
 * clear: Resource.mutate(Schema.Number).annotate({ destructive: true }),
 * enqueue: Resource.mutate(Schema.Void, { payload: { item: Item }, error: Full }),
 * ```
 *
 * @public
 */
export function mutate<Su extends Schema.Top>(
  success: Su,
): Method<"mutate", undefined, Su, Schema.Never>;
export function mutate<Su extends Schema.Top, const F extends Schema.Struct.Fields>(
  success: Su,
  options: { readonly payload: F },
): Method<"mutate", F, Su, Schema.Never>;
export function mutate<Su extends Schema.Top, E extends Schema.Top>(
  success: Su,
  options: { readonly error: E },
): Method<"mutate", undefined, Su, E>;
export function mutate<
  Su extends Schema.Top,
  const F extends Schema.Struct.Fields,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: F; readonly error: E },
): Method<"mutate", F, Su, E>;
export function mutate(
  success: Schema.Top,
  options?: {
    readonly payload?: Schema.Struct.Fields;
    readonly error?: Schema.Top;
  },
): AnyMethod {
  return makeMethod(
    "mutate",
    options?.payload,
    success,
    options?.error ?? Schema.Never,
    {},
  );
}

// ── type-level inference: one Spec → the service interface ──

type SuccessOf<M extends AnyMethod> = M["success"]["Type"];

type ErrorOf<M extends AnyMethod> = M["error"]["Type"];

type PayloadOf<M extends AnyMethod> = M["payload"] extends Schema.Struct.Fields
  ? Schema.Struct<M["payload"]>["Type"]
  : never;

type HasPayload<M extends AnyMethod> = [M["payload"]] extends [
  Schema.Struct.Fields,
]
  ? true
  : false;

/**
 * The inferred shape of one method: a **property** `Effect<Success, Error>` when there
 * is no payload, or a **function** `(payload) => Effect<Success, Error>` when there is.
 *
 * @internal
 */
export type ServiceMethod<M extends AnyMethod> = HasPayload<M> extends true
  ? (payload: PayloadOf<M>) => Effect.Effect<SuccessOf<M>, ErrorOf<M>>
  : Effect.Effect<SuccessOf<M>, ErrorOf<M>>;

/**
 * The full service interface inferred from a {@link Spec}. Wire {@link Method}s map to
 * `Effect`/function members; off-wire {@link LocalMethod}s surface as
 * `Effect<T, never, LocalCapability<Self>>` — `yield*` to obtain the value, requiring the
 * local layer's capability (so they're uncallable through {@link Resource.client}).
 *
 * @public
 */
export type ServiceOf<S extends Spec, Self = unknown> = {
  readonly [K in keyof S]: S[K] extends LocalMethod<infer T>
    ? Effect.Effect<T, never, LocalCapability<Self>>
    : S[K] extends AnyMethod
      ? ServiceMethod<S[K]>
      : never;
};

/** The wire-only service: just the {@link Method}s (used by the server impl + forwarder). */
type WireServiceOf<S extends Spec> = {
  readonly [K in keyof S as S[K] extends AnyMethod ? K : never]: S[K] extends AnyMethod
    ? ServiceMethod<S[K]>
    : never;
};

/**
 * The **implementation** shape a {@link Resource.layer} expects: wire methods as
 * `Effect`/functions, and each {@link LocalMethod} as its **raw** value `T` (the toolkit
 * wraps it to require the {@link LocalCapability}).
 */
type ImplOf<S extends Spec> = {
  readonly [K in keyof S]: S[K] extends LocalMethod<infer T>
    ? T
    : S[K] extends AnyMethod
      ? ServiceMethod<S[K]>
      : never;
};

// ── type-level: one Spec → the precisely-typed RPC contract group ──

/** The payload schema of a method: `Schema.Struct<F>` when it declares fields, else `Schema.Void`. */
type PayloadSchemaOf<M extends AnyMethod> = M["payload"] extends Schema.Struct.Fields
  ? Schema.Struct<M["payload"]>
  : Schema.Void;

/** The `Rpc` for one spec method — tag = the method name, schemas from the {@link Method}. */
type RpcOf<K extends string, M extends AnyMethod> = Rpc.Rpc<
  K,
  PayloadSchemaOf<M>,
  M["success"],
  M["error"]
>;

/** The union of every wire method's {@link RpcOf} — the group's full RPC set (local methods excluded). */
type RpcUnionOf<S extends Spec> = {
  readonly [K in keyof S & string]: S[K] extends AnyMethod
    ? RpcOf<K, S[K]>
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
export const buildRpcGroup = <const S extends Spec>(
  groupId: string,
  spec: S,
): RpcGroupOf<S> => {
  const rpcs = Object.entries(spec).flatMap(([method, m]) => {
    // local-only members are off-wire — they get no rpc.
    if (isLocalMethod(m)) return [];
    const tag = wireTag(groupId, method);
    const options: {
      payload?: Schema.Struct.Fields;
      success: Schema.Top;
      error: Schema.Top;
    } = {
      success: m.success,
      error: m.error,
    };
    if (m.payload !== undefined) options.payload = m.payload;
    return [Rpc.make(tag, options)];
  });
  // Boundary assertion (runtime-correct): each entry is built to be exactly the `Rpc`
  // the type derives from the same `spec` — but `Object.entries` erases the literal keys
  // to `string` (and the wire tag carries the group prefix the logical type omits), so the
  // precise per-method type is reattached here. One single source (the spec) drives both.
  return RpcGroup.make(...rpcs) as unknown as RpcGroupOf<S>;
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
/** Where the built RPC group is stowed on a Tag. @internal */
export const groupSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/group",
);
/** Where the per-resource local-capability key is stowed on a Tag. @internal */
export const localCapSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/localCap",
);

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
  /** Instance identity — the Context key and the per-call routing header value. */
  readonly id: string;
  /** Wire prefix — namespaces this resource's procedures on a shared `RpcServer`. */
  readonly groupId: string;
  /** Resource-level help text (CLI/TUI section help, dashboard panel title) — if declared. */
  readonly description: string | undefined;
  readonly [specSym]: S;
  readonly [groupSym]: RpcGroupOf<S>;
  readonly [localCapSym]: Context.Key<
    LocalCapability<Self>,
    { readonly granted: true }
  >;
}

/** Claimed instance ids — duplicate declarations fail fast (Effect won't catch same-key Tags). */
const claimedIds = new Set<string>();
/** Claimed group ids — the wire prefixes; duplicates would collide on a shared `RpcServer`. */
const claimedGroupIds = new Set<string>();

/** Reserve a group id (wire prefix); a duplicate **throws** — two resources can't share a prefix. */
const claimGroupId = (groupId: string): void => {
  if (claimedGroupIds.has(groupId)) {
    throw new Error(
      `Resource group id "${groupId}" is already declared — group ids namespace the wire and must be unique.`,
    );
  }
  claimedGroupIds.add(groupId);
};

/**
 * The single tag-creation primitive: dup-id guard + `Context.Service` + stow id/groupId/spec/group.
 * Both {@link makeTag} (per-tag spec) and {@link tagFor} (shared spec) go through it. `id` is the
 * instance identity (Context key + routing header); `groupId` is the wire prefix.
 */
const buildInstanceTag = <Self, S extends Spec>(
  groupId: string,
  id: string,
  spec: S,
  group: RpcGroupOf<S>,
  description: string | undefined,
) => {
  if (claimedIds.has(id)) {
    throw new Error(
      `Resource id "${id}" is already declared — resource ids must be unique.`,
    );
  }
  claimedIds.add(id);
  const base = Context.Service<Self, ServiceOf<S, Self>>()(id);
  // per-resource local capability — granted only by localLayer, never the client.
  const localCap: Context.Key<LocalCapability<Self>, { readonly granted: true }> =
    Context.Service<LocalCapability<Self>, { readonly granted: true }>()(
      `${id}/__local`,
    );
  return Object.assign(base, {
    id,
    groupId,
    description,
    [specSym]: spec,
    [groupSym]: group,
    [localCapSym]: localCap,
  });
};

/**
 * Create a resource service tag from a {@link Spec}. Extend the result, like
 * `Context.Tag`, but the value type is **inferred from the spec**:
 *
 * ```ts
 * class Counter extends Resource.Tag<Counter>("Counter")({
 *   increment: Resource.mutate(Schema.Void, { payload: { by: Schema.Number } }),
 *   current: Resource.query(Schema.Number),
 * }) {}
 *
 * const c = yield* Counter; // { increment: (p) => Effect<void>; current: Effect<number> }
 * ```
 *
 * Ids must be unique: a duplicate **throws at declaration** — Effect's `Context` is
 * keyed by the id string and silently last-write-wins on collisions, so we guard it.
 * For a single resource the id is also its **group id** (the wire prefix for its
 * procedures), so a shared `RpcServer` can host it alongside other resource types.
 *
 * @public
 */
const makeTag =
  <Self>(id: string, options?: { readonly description?: string }) =>
  <const S extends Spec>(spec: S) => {
    // single resource: id doubles as the group id (its wire prefix)
    claimGroupId(id);
    return buildInstanceTag<Self, S>(
      id,
      id,
      spec,
      buildRpcGroup(id, spec),
      options?.description,
    );
  };

/**
 * Build a **factory** tag-maker that bakes a shared {@link Spec} once under a `groupId`:
 * every instance shares the same contract + RPC group, and callers **never pass the spec**
 * — only an instance id. Use for resource families (many instances, one contract). The
 * `groupId` (e.g. `"queue"`) is the wire prefix for the family's procedures, so a shared
 * `RpcServer` can host this family next to other resource types without tag collisions;
 * instances are told apart by the per-call `id` header.
 *
 * ```ts
 * const Queue = Resource.tagFor("queue", { pause: Schema.Void, resume: Schema.Void });
 * class Jobs extends Queue<Jobs>("@app/Jobs") {}  // spec baked in; just the instance id
 * class Mail extends Queue<Mail>("@app/Mail") {}  // shares contract + group, routed by id
 * ```
 *
 * @public
 */
const tagFor = <const S extends Spec>(
  groupId: string,
  spec: S,
  options?: { readonly description?: string },
) => {
  claimGroupId(groupId);
  const group = buildRpcGroup(groupId, spec);
  const factory = <Self>(id: string) =>
    buildInstanceTag<Self, S>(groupId, id, spec, group, options?.description);
  // Stow the shared groupId/description/spec/group on the factory too, so the family
  // server ({@link serveInstances}) can read the contract + prefix without an instance.
  return Object.assign(factory, {
    groupId,
    description: options?.description,
    [specSym]: spec,
    [groupSym]: group,
  });
};

/**
 * The **local** layer for a resource: provide a real implementation of its service. Grants
 * the resource's {@link LocalCapability}, so any {@link Resource.local} (local-only) members
 * become callable here — they're a compile error under {@link Resource.client}.
 *
 * @public
 */
const localLayer = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  impl: ImplOf<S>,
): Layer.Layer<Self | LocalCapability<Self>> => {
  const cap = tag[localCapSym];
  const spec = tag[specSym];
  const members = impl as Record<string, unknown>;
  const service: Record<string, unknown> = {};
  for (const [key, m] of Object.entries(spec)) {
    // local members surface as `Effect<T, never, LocalCapability>` — requiring the cap to
    // obtain the raw value; wire members pass through unchanged.
    service[key] = isLocalMethod(m)
      ? Effect.as(cap, members[key])
      : members[key];
  }
  return Layer.merge(
    // Boundary assertion (runtime-safe): service is built from the same spec, key-for-key.
    Layer.succeed(tag, service as ServiceOf<S, Self>),
    Layer.succeed(cap, { granted: true }),
  );
};

/**
 * The **server** handlers layer for a resource: expose a real implementation over RPC by
 * mounting the contract group's handlers, each delegating to `impl`. Compose with an
 * `RpcServer` + a `Protocol` layer to actually serve over a transport.
 *
 * @public
 */
const serverLayer = <S extends Spec>(
  tag: {
    readonly groupId: string;
    readonly [specSym]: S;
    readonly [groupSym]: RpcGroupOf<S>;
  },
  impl: WireServiceOf<S>,
): Layer.Layer<HandlerContextOf<S>> => {
  const group = tag[groupSym];
  const handlers: Record<string, (payload: unknown) => unknown> = {};
  for (const [key, member] of Object.entries(impl)) {
    // handlers are keyed by the wire tag (group-prefixed), matching the group's procedures.
    // runtime-checked: payload methods are functions (call them); no-payload methods
    // are `Effect` properties (return as-is, ignoring the payload arg).
    handlers[wireTag(tag.groupId, key)] = (payload) =>
      typeof member === "function" ? member(payload) : member;
  }
  // Boundary assertion (runtime-safe): the handlers mirror the same spec the group was
  // built from, and RPC validates every payload/result against the spec schemas at the
  // wire. The output type is pinned to {@link HandlerContextOf} so the layer's
  // requirement channel stays `never` (RpcGroup's `ToHandlerFn` defaults it to `any`).
  return group.toLayer(
    handlers as unknown as Parameters<(typeof group)["toLayer"]>[0],
  ) as Layer.Layer<HandlerContextOf<S>>;
};

/** The header carrying the target instance id, set per-call by {@link forwardClient}. */
const ID_HEADER = "id";

/**
 * One instance of a factory paired with its implementation — the element of
 * {@link Resource.serveInstances}. Built by {@link Resource.instance}.
 *
 * @public
 */
export interface ResourceInstance<S extends Spec> {
  readonly id: string;
  readonly impl: WireServiceOf<S>;
}

/**
 * Pair a factory instance tag with its implementation, for {@link Resource.serveInstances}.
 *
 * @public
 */
const instance = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  impl: WireServiceOf<S>,
): ResourceInstance<S> => ({ id: tag.id, impl });

/**
 * The **family server** layer: serve **many instances of one factory** behind a
 * single contract group, dispatching each request to the right instance by the
 * per-call `id` header. Instances share one {@link tagFor} factory (one spec, one
 * RPC group); each is passed once via {@link Resource.instance}.
 *
 * Why one variadic call rather than one-layer-per-instance: composing instances as
 * sibling layers would silently keep only the last (Effect's `Context` is a map —
 * same-key layers last-write-wins). Passing them together is the foolproof shape:
 * every instance is wired, and a duplicate id **throws at assembly**.
 *
 * ```ts
 * const Queue = Resource.tagFor("queue", { pause: Resource.mutate(Schema.Void) });
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
    readonly [specSym]: S;
    readonly [groupSym]: RpcGroupOf<S>;
  },
  ...instances: ReadonlyArray<ResourceInstance<S>>
): Layer.Layer<HandlerContextOf<S>> => {
  const group = factory[groupSym];
  const spec = factory[specSym];

  // Build the routing table once, at assembly: id → instance impl. A duplicate id
  // is a wiring mistake — fail loudly rather than silently shadow an instance.
  const table = new Map<string, WireServiceOf<S>>();
  for (const { id, impl } of instances) {
    if (table.has(id)) {
      throw new Error(
        `Resource server family: instance id "${id}" is listed more than once.`,
      );
    }
    table.set(id, impl);
  }

  // One handler per contract method; each reads the `id` header, looks up the
  // instance, and dispatches. A missing/unknown id is a protocol-level fault
  // (the contract is satisfied) → die, not a typed domain error.
  const handlers: Record<
    string,
    (payload: unknown, options: { readonly headers: Headers.Headers }) => unknown
  > = {};
  for (const key of Object.keys(spec)) {
    // handlers are keyed by the wire tag (group-prefixed), matching the group's procedures.
    handlers[wireTag(factory.groupId, key)] = (payload, options) => {
      const id = Option.getOrUndefined(Headers.get(options.headers, ID_HEADER));
      if (id === undefined) {
        return Effect.die(
          new Error(
            `Resource server family: request for "${key}" is missing the "${ID_HEADER}" header.`,
          ),
        );
      }
      const impl = table.get(id);
      if (impl === undefined) {
        return Effect.die(
          new Error(
            `Resource server family: no instance registered for id "${id}".`,
          ),
        );
      }
      const member = (impl as Record<string, unknown>)[key];
      return typeof member === "function" ? member(payload) : member;
    };
  }

  // Boundary assertion (runtime-safe): handlers mirror the shared spec the group
  // was built from, and RPC validates every payload/result at the wire. Output pinned
  // to {@link HandlerContextOf} to keep the layer's requirement channel `never`.
  return group.toLayer(
    handlers as unknown as Parameters<(typeof group)["toLayer"]>[0],
  ) as Layer.Layer<HandlerContextOf<S>>;
};

/**
 * The RPC group built from a tag's spec — used to wire the client/server and tests.
 *
 * @internal
 */
export const groupOf = <S extends Spec>(tag: {
  readonly [specSym]: S;
  readonly [groupSym]: RpcGroupOf<S>;
}): RpcGroupOf<S> => tag[groupSym];

/**
 * The {@link Spec} a tag was built from — used to wire the client forwarder and tests.
 *
 * @internal
 */
export const specOf = <S extends Spec>(tag: { readonly [specSym]: S }): S =>
  tag[specSym];

/**
 * Map an RPC client + a spec into the typed service, forwarding each method to its
 * group-prefixed wire tag and pinning the instance id as a header. Shared by
 * {@link Resource.client} (production, over a real `Protocol`) and the in-memory
 * round-trip test (client from `RpcTest`).
 *
 * @internal
 */
export const forwardClient = <S extends Spec>(
  rpc: unknown,
  spec: S,
  groupId: string,
  id: string,
): WireServiceOf<S> => {
  const headers = { id };
  const calls = rpc as Record<
    string,
    (
      payload: unknown,
      options?: { readonly headers?: Record<string, string> },
    ) => Effect.Effect<unknown, unknown>
  >;
  const service: Record<string, unknown> = {};
  for (const [key, m] of Object.entries(spec)) {
    // local-only members aren't on the wire — the client stubs them (see clientLayer).
    if (isLocalMethod(m)) continue;
    // the wire tag is group-prefixed; the service surface keeps the bare method name
    const call = calls[wireTag(groupId, key)];
    // completeness check — fail loudly if a contract method isn't on the client
    if (call === undefined) {
      throw new Error(
        `Resource client: contract method "${key}" is missing from the RPC client.`,
      );
    }
    service[key] =
      m.payload === undefined
        ? call(undefined, { headers })
        : (payload: unknown) => call(payload, { headers });
  }
  // Boundary assertion (runtime-safe): every method verified present above; RPC validates
  // every payload/result against the spec schemas at the wire.
  return service as WireServiceOf<S>;
};

/**
 * The **client** layer for a resource: drive it over RPC **as if it were local** —
 * the exact same `yield* Tag` code as the local layer, only the provided layer differs,
 * so it doesn't matter where the resource is actually running. Needs an ambient RPC
 * `Protocol` (the transport).
 *
 * @public
 */
const clientLayer = <Self, S extends Spec>(tag: ResourceTag<Self, S>) =>
  Layer.effect(
    tag,
    Effect.map(RpcClient.make(tag[groupSym]), (rpc) => {
      const wire = forwardClient(
        rpc,
        tag[specSym],
        tag.groupId,
        tag.id,
      ) as Record<string, unknown>;
      const cap = tag[localCapSym];
      const service: Record<string, unknown> = { ...wire };
      // local-only members: present in the type, but require the LocalCapability the client
      // never grants — so calling one through a client is a compile error (and unreachable).
      for (const [key, m] of Object.entries(tag[specSym])) {
        if (isLocalMethod(m)) {
          service[key] = Effect.flatMap(cap, () =>
            Effect.die(
              new Error(
                `Resource client: "${key}" is local-only and cannot be called remotely.`,
              ),
            ),
          );
        }
      }
      // Boundary assertion (runtime-safe): built from the spec, key-for-key.
      return service as ServiceOf<S, Self>;
    }),
  );

/**
 * Resource toolkit — schema-defined service tags. Same `yield* Tag` everywhere; only the
 * layer changes: {@link Resource.layer} runs it locally, {@link Resource.client} drives it
 * remotely, {@link Resource.server} exposes a local impl over RPC.
 *
 * @public
 */
export const Resource = {
  Tag: makeTag,
  tagFor,
  query,
  mutate,
  local,
  instance,
  layer: localLayer,
  server: serverLayer,
  serveInstances,
  client: clientLayer,
} as const;
