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
 * class Counter extends Resource.Tag<Counter>()("@app/Counter", {
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
 * - {@link Resource.server} — expose one local impl over RPC (transport-agnostic handlers);
 * - {@link Resource.serveInstances} — serve many factory instances behind one group,
 *   routed by the per-call instance-key header.
 *
 * Over **http**, the batteries-included pair collapses the transport boilerplate (ndjson by
 * default on both, so client/server can't disagree on the codec):
 * - {@link Resource.serveHttp} — expose a resource on an http `RpcServer` in one call;
 * - {@link Resource.connectHttp} — wire a {@link Resource.Host}'s transport from a `url`.
 *
 * A method is {@link Resource.query} (one-shot read), {@link Resource.mutate} (mutation), or
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
  Schema,
  Scope,
  Stream,
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
  /**
   * When `"pair"`, a 2-tuple payload is surfaced as two call arguments `(first, second?)`
   * instead of a single tuple (used by custom-queue `add(item, level?)`).
   */
  readonly callStyle?: "pair";
}

/** Brands a {@link Method} so a spec entry is distinguishable from a plain object. */
const methodTypeId: unique symbol = Symbol.for("@nikscripts/effect-pm/Resource/method");

/**
 * One method of a resource contract — built by {@link Resource.query} /
 * {@link Resource.mutate} / {@link Resource.stream}. Carries its `kind`, schemas
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
> {
  readonly [methodTypeId]: typeof methodTypeId;
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
 * The single {@link Method} constructor — {@link query}, {@link mutate}, and
 * {@link stream} all go through it.
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
): Method<Kind, P, Su, E, Str, Ann> => ({
  [methodTypeId]: methodTypeId,
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
    false,
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
// whole-schema payload — the value is passed/decoded directly (e.g. `add(item)`).
export function mutate<Su extends Schema.Top, P extends Schema.Top>(
  success: Su,
  options: { readonly payload: P },
): Method<"mutate", P, Su, Schema.Never>;
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
export function mutate<
  Su extends Schema.Top,
  P extends Schema.Top,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: P; readonly error: E },
): Method<"mutate", P, Su, E>;
export function mutate(
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
 * Like {@link mutate}, but the payload must be a 2-tuple schema surfaced as two call
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
 *
 * ```ts
 * changes: Resource.stream(QueueSnapshot).annotate({ description: "Live queue state." }),
 * tail: Resource.stream(LogLine, { payload: { since: Schema.Number } }),
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
export function stream(
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
    : ServiceMethod<Exclude<S[K], AnyLocalMethod>>;
};

/** The wire-only service: just the {@link Method}s (used by the server impl + forwarder). */
type WireServiceOf<S extends Spec> = {
  readonly [K in keyof S as S[K] extends AnyLocalMethod ? never : K]: ServiceMethod<
    Exclude<S[K], AnyLocalMethod>
  >;
};

/**
 * The **implementation** shape a {@link Resource.layer} expects: wire methods as
 * `Effect`/functions, and each {@link LocalMethod} as its **raw** value `T` (the toolkit
 * wraps it to require the {@link LocalCapability}).
 */
type ImplOf<S extends Spec> = {
  readonly [K in keyof S]: S[K] extends LocalMethod<infer T>
    ? T
    : ServiceMethod<Exclude<S[K], AnyLocalMethod>>;
};

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
/** Where a contract's **kind** (its canonical id, e.g. `@nikscripts/effect-pm/QueueResource`) is
 *  stowed on a Tag — set by each contract's `.Tag` factory so consumers (the dashboard) can
 *  classify a tag without sniffing its spec. Absent on a bare {@link Resource.Tag}. @internal */
export const kindSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/kind",
);
/** Where the resource's {@link Host} (if any) is stowed on a Tag. @internal */
export const hostSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/host",
);

// ── host: the transport for a resource, carried in the Tag ──

/**
 * The value of a {@link Host} service: the RPC client transport `Protocol` for that host.
 * `Resource.connect(...)` produces a layer providing exactly this (re-keyed under the host),
 * and {@link Resource.client} feeds it to `RpcClient.make` as the `RpcClient.Protocol`.
 *
 * @internal
 */
type HostProtocol = Context.Service.Shape<typeof RpcClient.Protocol>;

/**
 * The Context key of a {@link Host} (`HSelf` = its identity): a service whose value is the
 * transport {@link HostProtocol}. Stored on a host-bearing tag under {@link hostSym}; read by
 * {@link Resource.client} to resolve *where* to connect (its requirement channel).
 *
 * @public
 */
export type HostKey<HSelf> = Context.Key<HSelf, HostProtocol>;

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
  readonly [specSym]: S;
  readonly [groupSym]: RpcGroupOf<S>;
  readonly [localCapSym]: Context.Key<
    LocalCapability<Self>,
    { readonly granted: true }
  >;
  /**
   * The resource's {@link Host} (its transport), or `undefined` for a hostless tag. Uniform
   * across all tags (always present) so a host-bearing tag stays assignable wherever a plain
   * {@link ResourceTag} is expected; the host-bearing tag constructors **narrow** this to a
   * concrete {@link HostKey} in their return type, which is how {@link Resource.client}
   * discriminates the host-aware path.
   */
  readonly [hostSym]: HostKey<unknown> | undefined;
  /** The contract's kind (canonical id) — set by a contract `.Tag` factory, `undefined` for a bare
   *  {@link Resource.Tag}. Read it with {@link kindOf}. */
  readonly [kindSym]: string | undefined;
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
  host: HostKey<unknown> | undefined,
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
  return Object.assign(base, {
    groupId,
    description,
    [specSym]: spec,
    [groupSym]: group,
    [localCapSym]: localCap,
    [hostSym]: host,
    [kindSym]: kind,
  });
};

/**
 * Create a resource service tag from a {@link Spec}. Extend the result, like
 * `Context.Tag`, but the value type is **inferred from the spec**:
 *
 * ```ts
 * class Counter extends Resource.Tag<Counter>()("Counter", {
 *   increment: Resource.mutate(Schema.Void, { payload: { by: Schema.Number } }),
 *   current: Resource.query(Schema.Number),
 * }) {}
 *
 * const c = yield* Counter; // { increment: (p) => Effect<void>; current: Effect<number> }
 * ```
 *
 * Keys must be unique: a duplicate **throws at declaration** — Effect's `Context` is
 * keyed by the key string and silently last-write-wins on collisions, so we guard it.
 * For a single resource the key is also its **group id** (the wire prefix for its
 * procedures), so a shared `RpcServer` can host it alongside other resource types.
 *
 * @public
 */
const makeTag = <Self>() => {
  // `Context.Service`-shaped: `Tag<Self>()(key, spec, options?)`. The spec (2nd arg) is the
  // inferring call; `options.host` rides the inferring call so its identity `HSelf` infers from the
  // argument, and the host-bearing overload narrows `[hostSym]` to a concrete `HostKey` — which is
  // how `Resource.client` discriminates the host-aware path.
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
      readonly host: HostKey<HSelf>;
    },
  ): ResourceTag<Self, S> & { readonly [hostSym]: HostKey<HSelf> };
  function build<const S extends Spec>(
    key: string,
    spec: S,
    options?: {
      readonly description?: string;
      readonly kind?: string;
      readonly host?: HostKey<unknown>;
    },
  ): ResourceTag<Self, S> {
    // single resource: key doubles as the group id (its wire prefix)
    claimGroupId(key);
    return buildInstanceTag<Self, S>(
      key,
      key,
      spec,
      buildRpcGroup(key, spec),
      options?.description,
      options?.host,
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
  readonly [specSym]: S;
  readonly [groupSym]: RpcGroupOf<S>;
}

/**
 * A host-bearing {@link tagFor} factory: every instance it makes carries the family's
 * {@link Host}, so each is a host-bearing tag ({@link Resource.client} resolves the transport
 * from it). Otherwise identical to {@link TagFactory}.
 *
 * @public
 */
export interface HostTagFactory<S extends Spec, HSelf> {
  <Self>(key: string): ResourceTag<Self, S> & {
    readonly [hostSym]: HostKey<HSelf>;
  };
  readonly groupId: string;
  readonly description: string | undefined;
  readonly [specSym]: S;
  readonly [groupSym]: RpcGroupOf<S>;
}

/**
 * Build a **factory** tag-maker that bakes a shared {@link Spec} once under a `groupId`:
 * every instance shares the same contract + RPC group, and callers **never pass the spec**
 * — only an instance key. Use for resource families (many instances, one contract). The
 * `groupId` (e.g. `"queue"`) is the wire prefix for the family's procedures, so a shared
 * `RpcServer` can host this family next to other resource types without tag collisions;
 * instances are told apart by the per-call `key` header.
 *
 * Pass `options.host` to bind the whole family to a {@link Host}: every instance becomes a
 * host-bearing tag and ships only-the-tag (see {@link Resource.client} / {@link Resource.connect}).
 *
 * ```ts
 * const Queue = Resource.tagFor("queue", { pause: Resource.mutate(Schema.Void) });
 * class Jobs extends Queue<Jobs>("@app/Jobs") {}  // spec baked in; just the instance key
 * class Mail extends Queue<Mail>("@app/Mail") {}  // shares contract + group, routed by key
 * ```
 *
 * @public
 */
function tagFor<const S extends Spec, HSelf>(
  groupId: string,
  spec: S,
  options: { readonly description?: string; readonly kind?: string; readonly host: HostKey<HSelf> },
): HostTagFactory<S, HSelf>;
function tagFor<const S extends Spec>(
  groupId: string,
  spec: S,
  options?: { readonly description?: string; readonly kind?: string },
): TagFactory<S>;
function tagFor<const S extends Spec>(
  groupId: string,
  spec: S,
  options?: { readonly description?: string; readonly kind?: string; readonly host?: HostKey<unknown> },
): TagFactory<S> {
  claimGroupId(groupId);
  const group = buildRpcGroup(groupId, spec);
  const host = options?.host;
  const factory = <Self>(key: string) =>
    buildInstanceTag<Self, S>(
      groupId,
      key,
      spec,
      group,
      options?.description,
      host,
      options?.kind,
    );
  // Stow the shared groupId/description/spec/group on the factory too, so the family
  // server ({@link serveInstances}) can read the contract + prefix without an instance.
  return Object.assign(factory, {
    groupId,
    description: options?.description,
    [specSym]: spec,
    [groupSym]: group,
  });
}

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
/** Invoke a wire impl member — spreads 2-tuple payloads when `callStyle` is `"pair"`. @internal */
const invokeWireMethod = (
  member: unknown,
  method: AnyMethod,
  payload: unknown,
): unknown => {
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
      invokeWireMethod(member, tag[specSym][key] as AnyMethod, payload);
  }
  // Boundary assertion (runtime-safe): the handlers mirror the same spec the group was
  // built from, and RPC validates every payload/result against the spec schemas at the
  // wire. The output type is pinned to {@link HandlerContextOf} so the layer's
  // requirement channel stays `never` (RpcGroup's `ToHandlerFn` defaults it to `any`).
  return group.toLayer(
    handlers as unknown as Parameters<(typeof group)["toLayer"]>[0],
  ) as Layer.Layer<HandlerContextOf<S>>;
};

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
    readonly [specSym]: S;
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
    readonly [specSym]: Spec;
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
 * Serve **many** resources on **one** http `RpcServer` (one port) — the multi-resource counterpart
 * to {@link serveHttp}. Each resource's procedures are group-id-prefixed, so they coexist on the
 * one `/rpc` endpoint without collision; clients reach each via `Resource.client(Tag)` over a single
 * {@link connectHttp} transport (typically a shared {@link Host}). This is how a whole group runs
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
const serveAllHttp = <R = never>(
  entries: ReadonlyArray<ServeEntry<R>>,
  options?: {
    readonly path?: HttpRouter.PathInput;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
    /** Readiness `/health` route (always mounted; set `path` to relocate it). A dumb probe gets
     *  `200`/`503`; the JSON body lists the host's resources for a dashboard health board. */
    readonly health?: {
      readonly path?: HttpRouter.PathInput;
    };
  },
): Layer.Layer<never, never, R | HttpServer.HttpServer> => {
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
      // Every host auto-serves the reserved host status resource (status / logs / ping) alongside
      // the user's resources, so a client can inspect any host without the author wiring it.
      // Dynamic import keeps `hostStatusResource` (which imports this module) out of a static cycle;
      // the entry is folded in before building so all entries stay one (erased) type.
      const { hostStatusServeEntry } = yield* Effect.promise(
        () => import("./internal/hostStatusResource"),
      );
      const startedAt = yield* Clock.currentTimeMillis;
      const allEntries = [
        ...entries,
        hostStatusServeEntry({ startedAt, resourceCount: entries.length }),
      ];
      const built = yield* Effect.forEach(allEntries, (entry) =>
        (Effect.isEffect(entry.impl)
          ? entry.impl
          : Effect.succeed(entry.impl)
        ).pipe(Effect.map((impl) => ({ tag: entry.tag, impl }))),
      );
      const merged = built
        .map((b) => b.tag[groupSym])
        .reduce((acc, group) => acc.merge(group));
      const handlers: Record<string, (payload: unknown) => unknown> = {};
      for (const { tag, impl } of built) {
        for (const [key, member] of Object.entries(impl)) {
          handlers[wireTag(tag.groupId, key)] = (payload) =>
            typeof member === "function" ? member(payload) : member;
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
      // gets a status code; the JSON body lists what this host serves for a dashboard health board.
      // Phase 1: the server answering proves it's listening, so report `ok` + the resource roster;
      // per-resource readiness (→ `503` when a resource is down) folds in once the `ready` seam lands.
      const resources = entries.map((entry) => ({
        key: entry.tag.groupId,
        kind: kindOf(entry.tag) ?? "resource",
      }));
      const healthRoute = HttpRouter.add(
        "GET",
        options?.health?.path ?? "/health",
        Effect.gen(function* () {
          const ts = yield* Clock.currentTimeMillis;
          return yield* HttpServerResponse.json({
            status: "ok",
            listening: true,
            resources,
            uptimeMillis: ts - startedAt,
            ts,
          }).pipe(Effect.orDie);
        }),
      );
      return HttpRouter.serve(Layer.merge(rpcAppLayer, healthRoute)).pipe(
        Layer.provideMerge(options?.serialization ?? defaultSerialization),
      );
    }),
  ) as unknown as Layer.Layer<never, never, R | HttpServer.HttpServer>;
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

  // Build the routing table once, at assembly: key → instance impl. A duplicate key
  // is a wiring mistake — fail loudly rather than silently shadow an instance.
  const table = new Map<string, WireServiceOf<S>>();
  for (const { key, impl } of instances) {
    if (table.has(key)) {
      throw new DuplicateInstance({ key });
    }
    table.set(key, impl);
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
  for (const [key, m] of Object.entries(spec)) {
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
  return service as WireServiceOf<S>;
};

/**
 * Declare a **host** — a named transport endpoint a resource connects to. A `Context.Service`
 * whose value is the RPC client {@link HostProtocol}; extend it like any Effect service:
 *
 * ```ts
 * class EdgeHost extends Resource.Host<EdgeHost>("edge") {}
 * ```
 *
 * Attach it to a tag (`Resource.Tag<Self>(key)(spec, EdgeHost)`) to make the tag carry its own
 * transport — then ship only the tag: {@link Resource.client} reads the host to resolve where
 * to connect, and a consumer wires the transport once with {@link Resource.connect}.
 *
 * @public
 */
const makeHost = <Self>(name: string) =>
  Context.Service<Self, HostProtocol>()(name);

/**
 * Wire a {@link Host}'s transport, **once**, from any RPC client `Protocol` layer — the
 * transport-agnostic primitive (use {@link connectHttp} for the batteries-included http case).
 * Re-keys that `Protocol` under the host, so {@link Resource.client} resolves it for every tag
 * bound to this host; provide one `Resource.connect(...)` per host an app talks to.
 *
 * ```ts
 * const EdgeLive = Resource.connect(EdgeHost, RpcClient.layerProtocolWebsocket({ url }).pipe(
 *   Layer.provide(RpcSerialization.layerNdjson),
 *   Layer.provide(socketLayer),
 * ));
 * ```
 *
 * @public
 */
const connectLayer = <Self, RIn>(
  host: HostKey<Self>,
  protocol: Layer.Layer<RpcClient.Protocol, never, RIn>,
): Layer.Layer<Self, never, RIn> =>
  Layer.effect(host, RpcClient.Protocol).pipe(Layer.provide(protocol));

/** The default RPC serialization: newline-delimited JSON — handles both one-shot and
 * **streaming** responses, and is shared by {@link connectHttp} + {@link serveHttp} so a
 * client and server can't silently disagree on the codec. */
const defaultSerialization: Layer.Layer<RpcSerialization.RpcSerialization> =
  RpcSerialization.layerNdjson;

/**
 * Wire a {@link Host}'s transport over **http**, the common case — `Resource.connect` with
 * batteries included. Builds the http client `Protocol` (Fetch + serialization) from a `url`
 * and re-keys it under the host. Serialization defaults to {@link defaultSerialization}
 * (ndjson), matching {@link serveHttp}'s default so the two sides agree by construction.
 *
 * ```ts
 * const EdgeLive = Resource.connectHttp(EdgeHost, { url: "http://10.0.0.2:3002/rpc" });
 * ```
 *
 * @public
 */
const connectHttp = <Self>(
  host: HostKey<Self>,
  options: {
    readonly url: string;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self> =>
  connectLayer(
    host,
    RpcClient.layerProtocolHttp({ url: options.url }).pipe(
      Layer.provide(options.serialization ?? defaultSerialization),
      Layer.provide(FetchHttpClient.layer),
    ),
  );

/**
 * Build the client-side service for a tag from a wired RPC client: forward every wire method
 * (group-prefixed, id-pinned), and stub each {@link Resource.local} member with a value that
 * requires the never-granted {@link LocalCapability} (so calling one through a client is a
 * compile error, and unreachable at runtime). Shared by both {@link clientLayer} paths.
 */
const buildClientService = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  rpc: unknown,
): ServiceOf<S, Self> => {
  const wire = forwardClient(rpc, tag[specSym], tag.groupId, tag.key) as Record<
    string,
    unknown
  >;
  const cap = tag[localCapSym];
  const service: Record<string, unknown> = { ...wire };
  for (const [key, m] of Object.entries(tag[specSym])) {
    if (isLocalMethod(m)) {
      service[key] = Effect.flatMap(cap, () =>
        Effect.die(new LocalOnlyMethod({ method: key })),
      );
    }
  }
  // Boundary assertion (runtime-safe): built from the spec, key-for-key.
  return service as ServiceOf<S, Self>;
};

/**
 * The **client** layer for a resource: drive it over RPC **as if it were local** — the exact
 * same `yield* Tag` code as the local layer, only the provided layer differs, so it doesn't
 * matter where the resource actually runs.
 *
 * Two paths, by whether the tag carries a {@link Host}:
 * - **host-bearing tag** — the transport is resolved from the tag's host; the layer's only
 *   requirement is that host (satisfied by {@link Resource.connect}). Ship just the tag.
 * - **hostless tag** — the transport is taken from the ambient `RpcClient.Protocol`, supplied
 *   at wire-up. (Remote use stays optional: a hostless resource can also just run locally via
 *   {@link Resource.layer}, or be served as its own process.)
 *
 * @public
 */
function clientLayer<Self, S extends Spec, HSelf>(
  tag: ResourceTag<Self, S> & { readonly [hostSym]: HostKey<HSelf> },
): Layer.Layer<Self, never, HSelf>;
function clientLayer<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
): Layer.Layer<Self, never, RpcClient.Protocol>;
function clientLayer<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
): Layer.Layer<Self, never, RpcClient.Protocol> {
  const group = tag[groupSym];
  const host = tag[hostSym];
  // hostless: take the transport from the ambient `RpcClient.Protocol` — fully typed, no cast.
  if (host === undefined) {
    return Layer.effect(
      tag,
      Effect.map(RpcClient.make(group), (client) =>
        buildClientService(tag, client),
      ),
    );
  }
  // host-bearing: resolve the transport from the host and provide it locally to the client, so
  // the layer requires the host rather than the ambient Protocol. The host's identity is erased
  // to `unknown` on the base tag; the `host`-overload pins the precise `HSelf` for callers, so
  // this one contained boundary assertion restates the impl's return type (runtime-safe).
  const layer = Layer.effect(
    tag,
    Effect.map(
      Effect.flatMap(host, (protocol) =>
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
    readonly [specSym]: S;
    readonly [groupSym]: RpcGroupOf<S>;
  },
  ...tags: Tags
): Layer.Layer<InstanceIdentifiers<Tags, S>, never, RpcClient.Protocol> =>
  Layer.effectContext(
    Effect.map(RpcClient.make(factory[groupSym]), (rpc) => {
      let context = Context.empty();
      for (const tag of tags) {
        const service = forwardClient(
          rpc,
          factory[specSym],
          factory.groupId,
          tag.key,
        );
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
  makeHost as Host,
  connectLayer as connect,
  connectHttp,
  instance,
  localLayer as layer,
  serverLayer as server,
  serveHttp,
  serveAllHttp,
  serveInstances,
  clientLayer as client,
  clientInstances,
};
// `query`, `mutate`, `stream`, `local`, `runForEachTag`, `runForEachTagScoped` are already
// exported above under their public names. The whole surface is now a tree-shakeable module
// namespace: **`import * as Resource from "@nikscripts/effect-pm/Resource"`** — `Resource.Tag`
// / `Resource.Host` pull only what's used.

