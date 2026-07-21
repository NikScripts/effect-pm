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
 *   add: Resource.effectFn({ by: Schema.Number }).annotate({ description: "Increment." }),
 *   reset: Resource.effect(Schema.Void).annotate({ destructive: true }),
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
 * - {@link Resource.httpServer} — expose one or more {@link Resource.serve} layers on an http
 *   `RpcServer` in one call;
 * - {@link Resource.httpClient} — wire a {@link Resource.Node}'s transport from a `url`.
 *
 * A method is {@link effect} (one-shot read), {@link effectFn} (mutation), or
 * {@link Resource.stream} (a live `Stream` source, e.g. `changes`).
 *
 * For a repeated dependency-monitor shape (`status` + `changes` + readiness from
 * status), {@link monitoredDependency} builds the spec and readiness together —
 * still a plain tag, not a new kind. Attach readiness with {@link withReadiness}.
 *
 * @module Resource
 */
import {
  Context,
  Data,
  Duration,
  Effect,
  Fiber,
  Result,
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
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpRouter,
} from "effect/unstable/http";
import * as Socket from "effect/unstable/socket/Socket";
import type { Simplify } from "effect/Types";
import {
  Rpc,
  RpcClient,
  RpcGroup,
  RpcSchema,
  RpcSerialization,
  RpcServer,
} from "effect/unstable/rpc";
import { combineByNode, combineQuery } from "./MultiNode";
import { facetStoreRegistration } from "./internal/store/facetStore";
import { builtInNodeStoreContract } from "./internal/store/nodeStoreSpec";
import type { StoreShapes } from "./internal/store/contractDef";
import {
  withRegistrationJournal,
  type StoreScopeTag,
} from "./internal/store/registration";
// Type-only — avoids a runtime Resource↔Lookup cycle; claim path dynamic-imports the module.
import type {
  Advice as LookupAdvice,
  Directory as LookupDirectory,
  DirectoryEntry as LookupDirectoryEntry,
  Identity as LookupIdentity,
} from "./Lookup";
import {
  AddressedNode,
  AnyNode,
  bindNodeStore,
  InvalidHttpTarget,
  isAddressedNode,
  ListenNode,
  NodeKey,
  NodeUnreachable,
  ProtocolKind,
  ProtocolUnanswered,
  resolveHttpTarget,
  ServiceNotReady,
  ServiceNotServed,
  Tag as makeNode,
  UnaddressedNode,
} from "./internal/nodeCore";
import {
  bindNodeProtocolBuilders,
  connectAddressed,
  connectLayer,
  invalidHttpTargetLayer,
  selectEndpoint,
  unaddressedLayer,
} from "./internal/nodeConnect";
// Node listen/connect used only inside functions via dynamic import where needed;
// clientLayerForEndpoint uses clientLayer auto-connect for dialable endpoints.

// ── typed errors (Data.TaggedError — never raw `Error`) ──

/**
 * Two resources declared the same **instance key**. Effect's `Context` is keyed by the key
 * string and silently last-write-wins, so we fail fast at declaration.
 *
 * @category errors
 * @public
 */
export class DuplicateResourceKey extends Data.TaggedError(
  "DuplicateResourceKey",
)<{ readonly key: string }> {}

/**
 * Two resources declared the same **group id** (the wire prefix) — they'd collide on a
 * shared `RpcServer`.
 *
 * @category errors
 * @public
 */
export class DuplicateGroupId extends Data.TaggedError("DuplicateGroupId")<{
  readonly groupId: string;
}> {}

/**
 * An instance was passed to {@link Resource.serveInstances} more than once.
 *
 * @category errors
 * @public
 */
export class DuplicateInstance extends Data.TaggedError("DuplicateInstance")<{
  readonly key: string;
}> {}

/**
 * A family request reached the server with no routable instance key header — a
 * protocol-level fault (the contract was satisfied), surfaced as a defect.
 *
 * @category errors
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
 * @category errors
 * @public
 */
export class MissingContractMethod extends Data.TaggedError(
  "MissingContractMethod",
)<{ readonly method: string }> {}

/**
 * A {@link Resource.local} (local-only) method was reached through a client. Unreachable by
 * construction — the {@link Local} it requires is never granted to a client.
 *
 * @category errors
 * @public
 */
export class LocalOnlyMethod extends Data.TaggedError("LocalOnlyMethod")<{
  readonly method: string;
}> {}

/**
 * {@link effectFn} was called without a payload — inputless members belong on {@link effect}.
 *
 * @category errors
 * @public
 */
export class EffectFnMissingPayload extends Data.TaggedError("EffectFnMissingPayload")<{
  readonly reason?: "missing" | "void" | "empty-fields";
}> {}

/**
 * An RPC call failed with a signature that means the client transport doesn't match the
 * server (classic: http client → WebSocket server → Effect's "empty HTTP response" defect).
 * Remapped at the {@link Resource.client} boundary so the failure is catchable by `_tag`
 * instead of looking like an opaque `RpcClientDefect`. Topology already designs this out on
 * the blessed path ({@link Node.connect} derives the transport); this is the legible backstop
 * when an escape-hatch protocol is still wrong.
 *
 * @category errors
 * @public
 */
export class ProtocolMismatch extends Data.TaggedError("ProtocolMismatch")<{
  readonly resource: string;
  readonly method: string;
  readonly cause: unknown;
}> {
  override get message() {
    return (
      `Resource "${this.resource}" method "${this.method}" hit a transport/protocol mismatch ` +
      `(often an http client dialing a WebSocket server). Use Node.connect / the node's declared ` +
      `kind (protocolWebsocket / socketClient), not a guessed transport.`
    );
  }
}

/**
 * A nodeless {@link Resource.client}`(tag)` was built with no ambient {@link RpcClient.Protocol}.
 * Replaces Effect's opaque "Service not found: …/Protocol" die with a remediation message naming
 * the three ways to connect. The Layer still *requires* `RpcClient.Protocol` in `R` (compile-time)
 * and keeps `E = never` (this replaces a defect, not a typed channel callers already matched);
 * catch via `Exit` / `_tag` when probing an unsatisfied build.
 *
 * @category errors
 * @public
 */
export class MissingClientProtocol extends Data.TaggedError("MissingClientProtocol")<{
  readonly resource: string;
}> {
  override get message() {
    return (
      `Resource.client("${this.resource}") has no ambient RpcClient.Protocol. ` +
      `Connect it with Node.connect(node) / Resource.client(tag, node), ` +
      `Resource.clientHttp(tag, target), or Resource.socketClient(node) ` +
      `(or Layer.provide a protocolHttp / protocolWebsocket / protocolIpc layer).`
    );
  }
}

/**
 * Effect's http RPC client surfaces a wrong-protocol peer as `RpcClientDefect` with these
 * fixed messages (see `effect/unstable/rpc/RpcClient`). Match the defect `_tag` + those
 * strings — the only discriminant the wire gives us.
 *
 * @internal
 */
const isHttpProtocolMismatchDefect = (err: unknown): boolean => {
  if (!Predicate.hasProperty(err, "_tag") || err._tag !== "RpcClientError") {
    return false;
  }
  if (!Predicate.hasProperty(err, "reason")) {
    return false;
  }
  const reason = err.reason;
  if (
    !Predicate.hasProperty(reason, "_tag") ||
    reason._tag !== "RpcClientDefect" ||
    !Predicate.hasProperty(reason, "message") ||
    typeof reason.message !== "string"
  ) {
    return false;
  }
  const msg = reason.message;
  return (
    msg.includes("Received empty HTTP response from RPC server") ||
    msg.includes("HTTP response ended before RPC request completed")
  );
};

/**
 * Remap known http↔ws mismatch defects on a wire Effect / Stream / thunk to
 * {@link ProtocolMismatch}. Identity for anything else.
 *
 * @internal
 */
const remapProtocolMismatch = (
  resource: string,
  method: string,
  value: unknown,
): unknown => {
  if (Effect.isEffect(value)) {
    return Effect.catch(value as Effect.Effect<unknown, unknown>, (err) =>
      isHttpProtocolMismatchDefect(err)
        ? new ProtocolMismatch({ resource, method, cause: err })
        : Effect.fail(err),
    );
  }
  if (Stream.isStream(value)) {
    return Stream.mapError(value as Stream.Stream<unknown, unknown>, (err) =>
      isHttpProtocolMismatchDefect(err)
        ? new ProtocolMismatch({ resource, method, cause: err })
        : err,
    );
  }
  return value;
};

/**
 * How a method behaves, for tools (CLI/TUI/dashboard) — **explicit, never inferred**;
 * encoded by the constructor used ({@link effect} vs {@link effectFn}):
 * - **`query`** — an idempotent read (CLI prints it, dashboard reads it as an Atom);
 * - **`mutate`** — a mutation (CLI confirms, dashboard calls it as `runtime.fn`).
 *
 * @category models
 * @public
 */
export type MethodKind = "query" | "mutate";

/**
 * Tool metadata attached to a method via {@link Method.annotate} — the Effect annotation
 * idiom. Inert to the type inference and the wire contract; it only feeds the tools that
 * render this resource.
 *
 * @category models
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

/** Sentinel for a {@link Method}'s `Client` type meaning "no explicit client type — **derive** the shape
 *  from the schema" (the default). Branded so nothing else structurally matches it. @public */
declare const deriveSym: unique symbol;
export interface Derive {
  readonly [deriveSym]: true;
}
/** Phantom key carrying a method's optional client-type override (set by the `effect`/`effectFn` two-stage
 *  forms). Type-only — runtime methods never hold it, so the property is optional. */
declare const clientSym: unique symbol;

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
 * @category models
 * @public
 */
export interface Method<
  P extends Schema.Struct.Fields | Schema.Top | undefined,
  Su extends Schema.Top,
  E extends Schema.Top,
  Str extends boolean = false,
  Ann extends MethodAnnotations = MethodAnnotations,
  Client = Derive,
> extends Pipeable.Pipeable {
  readonly [MethodTypeId]: typeof MethodTypeId;
  readonly kind: MethodKind;
  readonly payload: P;
  readonly success: Su;
  readonly error: E;
  /** A streaming read (`Stream` member) when `true`; a one-shot `Effect` otherwise. */
  readonly stream: Str;
  readonly annotations: Ann;
  /** Phantom: an explicit client-facing type (set via the `effect`/`effectFn` two-stage forms). `Derive`
   *  ⇒ the client shape is derived from the schema. Optional + type-only. */
  readonly [clientSym]?: (client: Client) => void;
  readonly annotate: <A extends MethodAnnotations>(
    annotations: A,
  ) => Method<P, Su, E, Str, Ann & A, Client>;
}

/**
 * Any {@link Method}, erased — the element type of a {@link Spec}.
 *
 * @category models
 * @public
 */
export type AnyMethod = Method<
  Schema.Struct.Fields | Schema.Top | undefined,
  Schema.Top,
  Schema.Top,
  boolean,
  MethodAnnotations,
  never
>;

/** A {@link Method} marked as a **fleet** field (via {@link fleet}) — combined across the nodes (in the
 *  layer via {@link peers}); served + client-visible like any query, but excluded from {@link peers}.
 *  Marked with a readable `fleet: true`. @public
 *
 * @category models
 */
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
 * @category spec fields
 * @public
 */
export const fleet = <M extends AnyMethod>(method: M): FleetField<M> =>
  marked(method, { fleet: true as const });

/** @internal */
declare const localTypeId: unique symbol;

/**
 * Granted *only* by a resource's local layer ({@link Resource.layer} / {@link serve}) — never by
 * {@link Resource.client}. Local to **this runtime's materialized impl** for the tag (not a remote
 * client, not a peer). A {@link LocalMethod} carries it in its requirement channel, so calling a
 * non-serializable method against a client is a **compile error** (unsatisfied requirement); the
 * same call resolves when the local layer is provided. Branded by `Self` so one resource's local
 * layer can't unlock another's.
 *
 * @category models
 * @public
 */
export interface Local<in out Self> {
  readonly [localTypeId]: Self;
}

/**
 * A local-only member as surfaced in {@link ServiceOf} — `Effect` requiring {@link Local} to
 * obtain the value.
 *
 * @category models
 * @public
 */
export type LocalEffect<A, E = never, Self = unknown> = Effect.Effect<A, E, Local<Self>>;

/** Identity brand for a {@link LocalMethod} (Effect-style string `TypeId`) — distinguishes an off-wire
 *  local member from a wire {@link Method}. */
const LocalMethodTypeId = "~nikscripts/effect-pm/Resource/LocalMethod" as const;

/**
 * A **local-only** member of a resource contract — built by {@link Resource.local}. It is
 * *not* part of the wire contract (no schema, no rpc): use it for things that can't cross
 * RPC simply (a returned function, a raw `Fiber`/`Scope`/`Ref`, a callback). Its declared
 * type `T` is given directly. In the service it surfaces as
 * `Effect<T, never, Local<Self>>` — you `yield*` it to obtain the value, which requires the
 * local layer ({@link Local}).
 *
 * @category models
 * @public
 */
export interface LocalMethod<T> {
  readonly [LocalMethodTypeId]: typeof LocalMethodTypeId;
  /** Phantom default at declaration — type-level / documentation; not on the wire. */
  readonly value?: T;
}

/**
 * Any {@link LocalMethod}, erased.
 *
 * @category models
 * @public
 */
export type AnyLocalMethod = LocalMethod<unknown>;

/**
 * A resource contract: method name → wire {@link Method} or off-wire {@link LocalMethod}.
 * The single source of truth.
 *
 * @category models
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
  readonly kind: MethodKind;
  readonly payload: infer P extends Schema.Struct.Fields | Schema.Top | undefined;
  readonly success: infer Su extends Schema.Top;
  readonly error: infer E extends Schema.Top;
  readonly stream: infer Str extends boolean;
  readonly annotations: infer Ann extends MethodAnnotations;
}
  ? Method<P, Su, E, Str, Ann>
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

/**
 * Flatten a resource {@link Spec} for structural validation (queue wire assert, etc.).
 *
 * @internal
 */
export const flattenResourceSpec = flattenSpec;

/** Flatten a nested impl to a flat path-keyed record, walking each path from the (flat) spec's keys —
 *  identity for a flat spec. @internal */
/** @internal */
export const flattenImpl = (
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

/** Implementation of {@link local}'s callable form (`local<T>()`); the public value is the branded
 *  {@link local} below (also usable **bare**). @internal */
const localFn = <T>(defaultValue?: T): LocalMethod<T> => ({
  [LocalMethodTypeId]: LocalMethodTypeId,
  ...(defaultValue !== undefined ? { value: defaultValue } : {}),
});

/** Brand marking the **bare** {@link local} value (used without `()`): a valid {@link LocalMethod}
 *  whose element type is supplied by the service interface position in a {@link fromService} contract.
 *  Distinct from a called `local<T>()` so the contract can reject a bare local that has no interface
 *  type to resolve from. @internal */
const bareLocalSym: unique symbol = Symbol.for(
  "~nikscripts/effect-pm/Resource/bareLocal",
);

/**
 * The **bare** {@link local} marker — `Resource.local` used *without* `()`. Valid only inside a
 * {@link fromService} contract, where the service interface at that key supplies its type. Using it
 * where no type can be resolved is a compile error (see {@link fromService}).
 *
 * @category models
 * @public
 */
export interface BareLocal {
  readonly [LocalMethodTypeId]: typeof LocalMethodTypeId;
  readonly [bareLocalSym]: true;
}

/**
 * Declare a **local-only** member (see {@link LocalMethod}). Two forms:
 *
 * - `Resource.local<T>()` — the element type `T` given explicitly (for a plain {@link Tag} contract).
 * - `Resource.local` — **bare**, no `()`; its type is taken from the service interface in a
 *   {@link fromService} contract. Rejected where no interface type is available.
 *
 * @category spec fields
 * @public
 */
export const local: typeof localFn & BareLocal = Object.assign(localFn, {
  [LocalMethodTypeId]: LocalMethodTypeId,
  [bareLocalSym]: true as const,
});

/**
 * The resolved tool metadata for one method — what CLI/TUI/dashboard read to render it.
 *
 * @category models
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
 * @category introspection
 * @public
 */
export const methodMeta = (m: AnyMethod): MethodMeta => ({
  kind: m.kind,
  description: m.annotations.description,
  destructive: m.annotations.destructive ?? false,
  streaming: m.stream,
});

/**
 * True when a spec member is an inputless void command (`Resource.effect(Schema.Void)`),
 * as opposed to an inputless value read (`Resource.effect` with a non-void success).
 *
 * @category guards
 * @public
 */
export const isVoidCommand = (m: AnyMethod): boolean => {
  if (m.payload !== undefined) {
    return false;
  }
  return (
    m.success === Schema.Void ||
    (typeof m.success === "object" &&
      m.success !== null &&
      "ast" in m.success &&
      typeof m.success.ast === "object" &&
      m.success.ast !== null &&
      "_tag" in m.success.ast &&
      m.success.ast._tag === "Void")
  );
};

/**
 * True when a wire member was built with {@link effect} (no payload schema) — including
 * unit run gates and value reads. Contrast {@link isVoidCommand}, which is only void commands.
 * Not {@link Effect.isEffect | `Effect.isEffect`} (runtime value guard).
 *
 * @category guards
 * @public
 */
export const isEffect = (m: AnyMethod): boolean =>
  m.payload === undefined;

/**
 * The single {@link Method} constructor — {@link effect}, {@link effectFn}, {@link constant},
 * {@link value}, and {@link stream} all go through it.
 */
const makeMethod = <
  P extends Schema.Struct.Fields | Schema.Top | undefined,
  Su extends Schema.Top,
  E extends Schema.Top,
  Str extends boolean,
  Ann extends MethodAnnotations = MethodAnnotations,
  Client = Derive,
>(
  kind: MethodKind,
  payload: P,
  success: Su,
  error: E,
  stream: Str,
  annotations: Ann,
): Method<P, Su, E, Str, Ann, Client> =>
  Object.assign(Object.create(Pipeable.Prototype), {
    [MethodTypeId]: MethodTypeId,
    kind,
    payload,
    success,
    error,
    stream,
    annotations,
    annotate: <A extends MethodAnnotations>(a: A): Method<P, Su, E, Str, Ann & A, Client> =>
      makeMethod<P, Su, E, Str, Ann & A, Client>(kind, payload, success, error, stream, {
        ...annotations,
        ...a,
      } as Ann & A),
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
      Method<M["payload"], M["success"], M["error"], M["stream"], M["annotations"] & A>,
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

/** Config-object wire slots for {@link effect}. @internal */
type EffectWireConfig = {
  readonly success?: Schema.Top;
  readonly error?: Schema.Top;
};

/** Config-object wire slots for {@link effectFn}. @internal */
type EffectFnWireConfig = {
  readonly payload: EffectFnPayload;
  readonly success?: Schema.Top;
  readonly error?: Schema.Top;
};

/** Non-void schema payload for {@link effectFn}. @internal */
type RequiredPayloadSchema<P extends Schema.Top> = [P] extends [typeof Schema.Void] ? never : P;

/** Non-empty struct fields payload for {@link effectFn}. @internal */
type RequiredPayloadFields<F extends Schema.Struct.Fields> = [keyof F] extends [never] ? never : F;

/** Runtime payload input after {@link assertEffectFnPayload}. @internal */
type EffectFnPayload = Exclude<Schema.Top, typeof Schema.Void> | Schema.Struct.Fields;

const isPlainConfigObject = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Schema.isSchema(u);

const isEffectWireConfig = (u: unknown): u is EffectWireConfig => {
  if (!isPlainConfigObject(u)) {
    return false;
  }
  const keys = Object.keys(u);
  return keys.length > 0 && keys.every((key) => key === "success" || key === "error");
};

const isEffectFnWireConfig = (u: unknown): u is EffectFnWireConfig => {
  if (!isPlainConfigObject(u)) {
    return false;
  }
  const keys = Object.keys(u);
  return (
    keys.includes("payload") &&
    keys.every((key) => key === "payload" || key === "success" || key === "error")
  );
};

const assertEffectFnPayload = (
  payload: EffectFnPayload | undefined,
): EffectFnPayload => {
  if (payload === undefined) {
    throw new EffectFnMissingPayload({ reason: "missing" });
  }
  if (payload === Schema.Void) {
    throw new EffectFnMissingPayload({ reason: "void" });
  }
  if (isPlainConfigObject(payload) && Object.keys(payload).length === 0) {
    throw new EffectFnMissingPayload({ reason: "empty-fields" });
  }
  return payload;
};

/**
 * Define an **`effect`** field — resolves to `Effect<Su, E>` in the service (inputless, lazy,
 * re-runnable read), named for what it resolves to. Members with per-invocation input use
 * {@link effectFn} instead. Attach help/metadata with `.annotate({ description, ... })`.
 * The other shapes are {@link value} / {@link constant} / {@link effectFn} / {@link stream}.
 *
 * ```ts
 * size: Resource.effect(Schema.Number).annotate({ description: "Total pending." }),
 * run: Resource.effect(success, error).annotate({ description: "Tracked manual run." }),
 * run: Resource.effect({ success, error }).annotate({ description: "Tracked manual run." }),
 * get: Resource.effectFn({ id: Schema.String }, Schema.User),
 * ```
 *
 * @public
 */
// A void query is now written **explicitly** as `effect(Schema.Void)` — the empty `effect()` is freed
// to be the two-stage entry (below), so `effect<Client>()(success)` works like `effectFn<Client>()`.
// The schema-derived client shape of a query — an `Effect<Success>` property; `effect<Client>()`
// constrains `Client` to NARROW it (a `Client` that widens the success makes the arg resolve to `never`).
type QueryDerived<Su extends Schema.Top> = Effect.Effect<PrettifyPayload<Su["Type"]>>;
type NarrowedSuccess<Su extends Schema.Top, Client> = [Client] extends [Derive]
  ? Su
  : [Client] extends [QueryDerived<Su>]
    ? Su
    : never;
/**
 * Two-stage {@link effect} — override the **client-facing** type with a `Client` (an **`Effect`** type;
 * a read surfaces as `Effect<Success>`) that must **narrow** the schema-derived shape:
 * `effect<Client>()(success)`. Widening the success fails to compile. For a free override, see
 * {@link unsafeEffect}. @public
 * @category spec fields
 */
export function effect<Client = Derive>(): <Su extends Schema.Top>(
  success: NarrowedSuccess<Su, Client>,
) => Method<undefined, Su, typeof Schema.Never, false, MethodAnnotations, Client>;
export function effect<Su extends Schema.Top>(success: Su): Method<undefined, Su, Schema.Never>;
export function effect<Su extends Schema.Top, E extends Schema.Top>(
  success: Su,
  error: E,
): Method<undefined, Su, E>;
export function effect<const C extends EffectWireConfig>(
  config: C,
): Method<
  undefined,
  C["success"] extends Schema.Top ? C["success"] : typeof Schema.Void,
  C["error"] extends Schema.Top ? C["error"] : typeof Schema.Never
>;
export function effect(
  successOrConfig?: Schema.Top | EffectWireConfig,
  error?: Schema.Top,
): AnyMethod | (<Su extends Schema.Top>(success: Su) => AnyMethod) {
  // two-stage form `effect<Client>()(success)` — 0 args on the first call; the client override is
  // type-only (phantom), so the returned builder is the ordinary schema-derived query builder.
  if (successOrConfig === undefined) {
    return <Su extends Schema.Top>(success: Su): AnyMethod =>
      makeMethod("query", undefined, success, Schema.Never, false, {});
  }
  let success: Schema.Top = Schema.Void;
  let errorSchema: Schema.Top = Schema.Never;
  if (isEffectWireConfig(successOrConfig)) {
    success = successOrConfig.success ?? Schema.Void;
    errorSchema = successOrConfig.error ?? Schema.Never;
  } else {
    success = successOrConfig;
    errorSchema = error ?? Schema.Never;
  }
  return makeMethod("query", undefined, success, errorSchema, false, {});
}

/**
 * Two-stage {@link effect} that lets you **override the client-facing type** with an **unconstrained**
 * `Client` — here an **`Effect`** type (a read surfaces as `Effect<Success>`, not a function):
 * `unsafeEffect<Client>()(success)`. The wire/impl stay schema-derived; only what `yield* Tag` reads is
 * replaced by `Client`. **Unsafe:** `Client` is not checked against the schema — you assert it matches.
 * For a *narrowing* (checked) read override, use the two-stage {@link effect} form instead.
 *
 * @category spec fields
 * @public
 */
export function unsafeEffect<Client = Derive>() {
  return <Su extends Schema.Top>(
    success: Su,
  ): Method<undefined, Su, typeof Schema.Never, false, MethodAnnotations, Client> =>
    makeMethod<undefined, Su, typeof Schema.Never, false, MethodAnnotations, Client>(
      "query",
      undefined,
      success,
      Schema.Never,
      false,
      {},
    );
}

/** A {@link Method} marked as a **constant** field (via {@link constant}) — resolved once at acquire,
 *  surfaced as a plain value. Tagged with a readable `_tag: "constant"`. @public
 *
 * @category models
 */
export type ConstantField<M extends AnyMethod> = Marked<M, { readonly _tag: "constant" }>;

/** Runtime guard: is a spec entry a {@link constant} field? */
const isConstantMethod = (m: AnyMethod | AnyLocalMethod): boolean =>
  Predicate.hasProperty(m, "_tag") && m._tag === "constant";

/**
 * Define a **`constant`** field — a value resolved **once** when the resource is acquired, surfaced as a
 * **plain** property (`p.x: A`, no `yield*`), identical local and remote. For values fixed after startup.
 * The impl supplies the value as an `Effect<A>` (run once at acquire; use `Effect.succeed` for a literal).
 * Live values are `value`; on-demand reads are `effect`. See `docs/handoffs/archive/2026-07/features/service-shape-redesign.md`.
 *
 * @category spec fields
 * @public
 */
export const constant = <Su extends Schema.Top>(
  success: Su,
): ConstantField<Method<undefined, Su, typeof Schema.Never>> =>
  marked(effect(success), { _tag: "constant" as const });

/** A {@link Method} marked as a **ref** field (via {@link ref}) — surfaces as a {@link Subscribable}.
 *  Tagged with a readable `_tag: "ref"`. @public
 *
 * @category models
 */
export type RefField<M extends AnyMethod> = Marked<M, { readonly _tag: "ref" }>;

/** Runtime guard: is a spec entry a {@link ref} field? */
const isRefMethod = (m: AnyMethod | AnyLocalMethod): boolean =>
  Predicate.hasProperty(m, "_tag") && m._tag === "ref";

/**
 * Define a **`ref`** field — reactive state surfaced as a {@link Subscribable}<A> (`get` + `changes`),
 * uniform local and remote. The impl **owns** a `SubscriptionRef` (writes it) and provides it via
 * {@link subscribable}; consumers **read** (`yield* svc.x.get`) and **observe** (`svc.x.changes`) — a read
 * is an honest `Effect`, not a synchronous peek. For values fixed at acquire use `constant`; for on-demand
 * calls use `effect`.
 *
 * @category spec fields
 * @public
 */
export const ref = <Su extends Schema.Top>(
  success: Su,
): RefField<Method<undefined, Su, typeof Schema.Never, true>> =>
  marked(stream(success), { _tag: "ref" as const });

/**
 * Narrow a resource contract object through the builder (prefer over `as const satisfies`).
 *
 * @category constructors
 * @public
 */
export const contract = <const S extends Spec>(spec: S): S => spec;

export { withStore } from "./Store";
export { logs, withLogExport, type LogsExportHandle } from "./internal/logs/resourceLogs";
export {
  logStreamLevel,
  logStreamLevelAll,
  logStreamLevelDebug,
  logStreamLevelInfo,
  logStreamLevelWarn,
  logStreamLevelError,
  logStreamLevelNone,
} from "./internal/logs/resourceStreamLevel";

/**
 * Register a {@link Node} on an app {@link Store.Service} — node-wide durable log journal
 * (match-all follower). Prefer {@link Node.logs} sugar (`WnbaNode.logs`).
 *
 * @example
 * ```ts
 * class AppStore extends Store.Service<AppStore>("@app/Store")(
 *   Resource.store(WnbaNode),
 *   Process.store(Daily),
 * ) {}
 * ```
 *
 * @category serving
 * @public
 */
export function store<const Tag extends StoreScopeTag>(
  tag: Tag,
): ReturnType<typeof facetStoreRegistration<Tag, ReturnType<typeof builtInNodeStoreContract>>>;
export function store<
  const Tag extends StoreScopeTag,
  const Shapes extends StoreShapes,
>(
  tag: Tag,
  extended: Shapes,
): ReturnType<
  typeof facetStoreRegistration<Tag, ReturnType<typeof builtInNodeStoreContract>, Shapes>
>;
export function store(tag: StoreScopeTag, extended?: StoreShapes) {
  const builtIn = builtInNodeStoreContract();
  const registered =
    extended === undefined
      ? facetStoreRegistration(tag, builtIn)
      : facetStoreRegistration(tag, builtIn, extended);
  return withRegistrationJournal(registered, "node");
}

bindNodeStore(store);

/**
 * A **read-only reactive value**: its current value ({@link Subscribable.get}, an `Effect`) plus a stream
 * of every change ({@link Subscribable.changes}). This is what a {@link ref} field surfaces — uniform local
 * and remote — and it's exactly the read side of a `SubscriptionRef` (Effect ships no `Subscribable` type in
 * this beta, so we name it here). @public
 * @category models
 */
export interface Subscribable<A> {
  readonly get: Effect.Effect<A>;
  readonly changes: Stream.Stream<A>;
}

/**
 * Build a {@link Subscribable} view over a `SubscriptionRef` — the impl side of a {@link ref} field: the
 * impl owns the ref (writes it), consumers get read + observe. @public
 * @category reactivity
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
 * @category reactivity
 */
export const mapSubscribable = <A, B>(
  source: Subscribable<A>,
  f: (a: A) => B,
): Subscribable<B> => ({
  get: Effect.map(source.get, f),
  changes: Stream.map(source.changes, f),
});

// ============================================================================
// Impl transform — walk an impl per its spec and map every Effect method
// ============================================================================

/**
 * Wrap a type-erased impl member so its returned {@link Effect} passes through `transform`. A member that
 * is a **function** `(...args) => Effect` → `(...args) => transform(fn(...args))`; a **bare** `Effect`
 * member → `transform(member)` directly. Only ever handed an **Effect method's** impl member — the
 * {@link mapEffects} walk skips `stream: true` leaves (streams and {@link ref} → {@link Subscribable}
 * members) before it reaches here. @internal
 */
const mapEffectMember = (
  member: unknown,
  transform: (
    effect: Effect.Effect<unknown, unknown, unknown>,
  ) => Effect.Effect<unknown, unknown, unknown>,
): unknown => {
  if (typeof member === "function") {
    // function → Effect: same call-then-transform idiom as `Store.mapMethod`.
    return (...args: ReadonlyArray<unknown>) => transform(member(...args));
  }
  // bare Effect member (e.g. a no-payload `effectFn` — `start`/`pause`): transform it directly. The
  // leaf is type-erased by the spec-driven walk, so the Effect type is asserted once here (the same
  // tree-walk/rebuild idiom as `flattenImpl` / `nestService`).
  return transform(member as Effect.Effect<unknown, unknown, unknown>);
};

/**
 * Remove the requirement channel `R` from every **Effect method** in an impl shape — the per-method-precise
 * result of {@link provideContext}. Mirrors `Store.CatchWriteError`, but **subtracts** the provided context
 * `Ctx` from each method's requirement rather than catching an error — sound like `Effect.provideContext`
 * (`R` → `Exclude<R, Ctx>`), so a requirement the context does **not** cover survives as a residual (and a
 * later `ImplOf` assignment catches it) instead of being silently claimed `never`. A method
 * `(...a) => Effect<S, E, R>` → `(...a) => Effect<S, E, Exclude<R, Ctx>>`; a bare `Effect<S, E, R>` →
 * `Effect<S, E, Exclude<R, Ctx>>`; a {@link Subscribable} (a {@link ref} field's impl) and a {@link Stream}
 * (a `stream` field's impl, or a group's `live`) pass through untouched; a nested method group recurses.
 * @category models
 * @public
 */
export type ProvidedContext<T, Ctx> = T extends Subscribable<infer A>
  ? Subscribable<A>
  : T extends Stream.Stream<infer A, infer E, infer R>
    ? Stream.Stream<A, E, R>
    : T extends (...args: infer Args) => Effect.Effect<infer S, infer E, infer R>
      ? (...args: Args) => Effect.Effect<S, E, Exclude<R, Ctx>>
      : T extends Effect.Effect<infer S, infer E, infer R>
        ? Effect.Effect<S, E, Exclude<R, Ctx>>
        : T extends (...args: ReadonlyArray<never>) => unknown
          ? T
          : T extends object
            ? { readonly [K in keyof T]: ProvidedContext<T[K], Ctx> }
            : T;

/**
 * Add `Req` to the requirement channel of every **Effect method** in an impl shape — the inverse of
 * {@link ProvidedContext}, and a parameterized cousin of `Store.AddStorageReq`. Use it to annotate a
 * **pre-provide** impl (each worker method still carrying its requirement `Req`) so every method's
 * destructured params still get their contextual types from the spec, before {@link provideContext}
 * strips `Req` back off to yield the {@link ImplOf} shape. A method `(...a) => Effect<S, E, R>` →
 * `(...a) => Effect<S, E, R | Req>`; a bare `Effect<S, E, R>` → `Effect<S, E, R | Req>`; a
 * {@link Subscribable} / {@link Stream} member passes through untouched; a nested group recurses.
 *
 * @category models
 * @public
 */
export type WithRequirement<T, Req> = T extends Subscribable<infer A>
  ? Subscribable<A>
  : T extends Stream.Stream<infer A, infer E, infer R>
    ? Stream.Stream<A, E, R>
    : T extends (...args: infer Args) => Effect.Effect<infer S, infer E, infer R>
      ? (...args: Args) => Effect.Effect<S, E, R | Req>
      : T extends Effect.Effect<infer S, infer E, infer R>
        ? Effect.Effect<S, E, R | Req>
        : T extends (...args: ReadonlyArray<never>) => unknown
          ? T
          : T extends object
            ? { readonly [K in keyof T]: WithRequirement<T[K], Req> }
            : T;

/**
 * The generic impl-transform primitive — the Resource counterpart to `Store.mapEffects`. Walk `impl`
 * **per its `spec`** ({@link flattenSpec} keys aligned onto the impl via {@link flattenImpl}) and pass each
 * **Effect method**'s returned {@link Effect} through `transform`, then re-nest ({@link nestService}). A
 * `stream: true` leaf — a {@link Resource.stream} member (a {@link Stream} impl) **or** a {@link ref} field
 * (a {@link Subscribable} impl) — is left untouched, as is a {@link LocalMethod} leaf.
 *
 * `transform` is applied uniformly; whether it changes types is expressed through the result:
 * - **Type-preserving** transforms (`withSpan` / `retry`) leave the type unchanged — `Out` defaults to
 *   `Impl`.
 * - **Type-changing** transforms (stripping `R`, like {@link provideContext}) supply an explicit `Out`
 *   computed per method by a mapped type (e.g. {@link ProvidedContext}).
 *
 * @example Type-preserving — trace every resource method
 * ```ts
 * const traced = Resource.mapEffects(impl, MyTag[Resource.specSym], (e) => Effect.withSpan(e, "resource"));
 * ```
 *
 * @category reactivity
 * @public
 */
export const mapEffects = <Impl, const S extends Spec, Out = Impl>(
  impl: Impl,
  spec: S,
  transform: (
    effect: Effect.Effect<unknown, unknown, unknown>,
  ) => Effect.Effect<unknown, unknown, unknown>,
): Out => {
  const flatSpec = flattenSpec(spec);
  // Tree-walk/rebuild idiom (as in `flattenImpl` at every wire call site): the impl is a type-erased
  // record here, walked by the spec's flat paths.
  const flatImpl = flattenImpl(impl as Record<string, unknown>, flatSpec);

  const mapped: Record<string, unknown> = {};
  for (const [path, member] of Object.entries(flatImpl)) {
    const leaf = flatSpec[path];
    // Leave streams (and `ref` → Subscribable, which is `stream: true`) and local members untouched;
    // map only the Effect methods.
    if (
      leaf === undefined ||
      isLocalMethod(leaf) ||
      (Predicate.hasProperty(leaf, "stream") && leaf.stream === true)
    ) {
      mapped[path] = member;
    } else {
      mapped[path] = mapEffectMember(member, transform);
    }
  }

  const built = nestService(mapped);
  // Same structural-rebuild idiom as `Store.mapEffects`: the reassembled object is asserted once here
  // (as `Out` — the caller-supplied per-method result, or `Impl`).
  return built as Out;
};

/**
 * Provide a {@link Context.Context} to **every Effect method** of an impl — the one-liner that replaces a
 * repetitive per-method `Effect.provideContext(...)` wrapping. One-liner over {@link mapEffects}; the
 * result **subtracts** the provided context `Ctx` from each method's requirement (see
 * {@link ProvidedContext}) — `R` → `Exclude<R, Ctx>` — so a worker-`R`-carrying impl whose context fully
 * covers `R` becomes the `R`-free shape {@link ImplOf} expects, and a method needing more than `Ctx`
 * provides keeps a residual requirement (caught at the `ImplOf` assignment) rather than a false `never`.
 * Providing the context to a method that carries no `R` is a harmless no-op, so it applies uniformly.
 * {@link Stream} and {@link Subscribable} members are left untouched.
 *
 * ```ts
 * const context = yield* Effect.context<R | RR>();
 * return Resource.provideContext(impl, MyTag[Resource.specSym], context);
 * ```
 *
 * @category serving
 * @public
 */
export const provideContext = <Impl, const S extends Spec, Ctx>(
  impl: Impl,
  spec: S,
  context: Context.Context<Ctx>,
): ProvidedContext<Impl, Ctx> =>
  mapEffects<Impl, S, ProvidedContext<Impl, Ctx>>(impl, spec, (effect) =>
    Effect.provideContext(effect, context),
  );

/** Runtime marker for a {@link BuiltResource} bundle. @internal */
export const builtResourceSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/BuiltResource",
);

/**
 * A resource impl **before** worker-context discharge — the impl still carries requirement `R` on its
 * Effect methods, paired with the {@link Context.Context} captured at build time. Used by
 * {@link QueueResource}, {@link RunResource}, and {@link Process} (any toolkit resource that builds
 * its driver under ambient `R`). {@link layer} / {@link serve} grant locally via {@link grantLocal};
 * {@link serveRemote} defers discharge to each wire call via {@link invokeWireMethodWithContext} so
 * one materialization backs both paths.
 *
 * @category models
 * @public
 */
export interface BuiltResource<S extends Spec, R> {
  readonly [builtResourceSym]: true;
  readonly impl: WithRequirement<ImplOf<S>, R>;
  readonly workerContext: Context.Context<R>;
}

/**
 * True when `u` is a {@link BuiltResource} bundle.
 *
 * @category guards
 * @public
 */
export const isBuiltResource = (u: unknown): u is BuiltResource<Spec, unknown> =>
  Predicate.hasProperty(u, builtResourceSym);

/**
 * Pair a pre-provide impl with the worker context captured at build time. Pass `tag` so the concrete
 * {@link Spec} `S` is pinned for {@link BuiltResource} typing.
 *
 * @category constructors
 * @public
 */
export const builtResource = <Self, S extends Spec, R>(
  _tag: ResourceTag<Self, S>,
  impl: WithRequirement<ImplOf<S>, R>,
  workerContext: Context.Context<R>,
): BuiltResource<S, R> => ({
  [builtResourceSym]: true as const,
  impl,
  workerContext,
});

/**
 * Discharge a {@link BuiltResource}'s captured worker context into every Effect method — yields the
 * `R`-free {@link ImplOf} shape for {@link layer} / the local grant in {@link serve}.
 *
 * @category constructors
 * @public
 */
export const grantLocal = <Self, S extends Spec, R>(
  tag: ResourceTag<Self, S>,
  built: BuiltResource<S, R>,
): ImplOf<S> =>
  provideContext(built.impl, tag[specSym], built.workerContext) as ImplOf<S>;

/**
 * Define an **`effectFn`** field — resolves to `(In) => Effect<Su, E>` in the service (a call with
 * input), named for what it resolves to. Use `Schema.Void` for `success` when it returns nothing.
 * Attach help/metadata with `.annotate({ description, destructive })`.
 *
 * `payload` is a single **schema** or struct **fields** — same as Effect's `Rpc.make`. A bare schema
 * (a union, an item, `Schema.Struct({ … })`) is the input directly — e.g. `add(item | item[])`.
 *
 * ```ts
 * pause: Resource.effect(Schema.Void).annotate({ description: "Pause." }),
 * clear: Resource.effect(Schema.Number).annotate({ destructive: true }),
 * enqueue: Resource.effectFn({ item: Item }),
 * enqueue: Resource.effectFn({ payload: { item: Item }, success: Schema.Void, error: Full }),
 * ```
 *
 * `payload` is **required** — inputless members belong on {@link effect}, not `effectFn`.
 *
 * @public
 */
// The schema-derived client shape of a void mutation — the two-stage `effectFn<Client>()` constrains
// `Client` to **narrow** this (add overloads / refine), never widen it. A `Client` that would accept a
// payload the wire rejects makes {@link NarrowedPayload} resolve to `never`, so the call fails to compile.
type MutateDerived<P extends Schema.Top> = (payload: PrettifyPayload<P["Type"]>) => Effect.Effect<void>;
type NarrowedPayload<P extends Schema.Top, Client> = [Client] extends [Derive]
  ? RequiredPayloadSchema<P>
  : [Client] extends [MutateDerived<P>]
    ? RequiredPayloadSchema<P>
    : never;
/**
 * Two-stage {@link effectFn} — override the **client-facing** type with a `Client` that must **narrow**
 * the schema-derived shape: `effectFn<Client>()(payload)`. Reshape freely (e.g. add overloads), but a
 * `Client` that would accept payloads the wire rejects fails to compile (payload resolves to `never`).
 * For an override that can't be a narrowing (a generic library), use {@link unsafeEffectFn}. @public
 * @category spec fields
 */
export function effectFn<Client = Derive>(): <P extends Schema.Top>(
  payload: NarrowedPayload<P, Client>,
) => Method<P, typeof Schema.Void, typeof Schema.Never, false, MethodAnnotations, Client>;
export function effectFn<const C extends EffectFnWireConfig>(
  config: C,
): Method<
  C["payload"] extends Schema.Struct.Fields
    ? C["payload"]
    : C["payload"] extends Schema.Top
      ? C["payload"]
      : never,
  C["success"] extends Schema.Top ? C["success"] : typeof Schema.Void,
  C["error"] extends Schema.Top ? C["error"] : typeof Schema.Never
>;
export function effectFn<P extends Schema.Top>(
  payload: RequiredPayloadSchema<P>,
): Method<P, typeof Schema.Void, typeof Schema.Never>;
export function effectFn<P extends Schema.Top, Su extends Schema.Top>(
  payload: RequiredPayloadSchema<P>,
  success: Su,
): Method<P, Su, Schema.Never>;
export function effectFn<P extends Schema.Top, Su extends Schema.Top, E extends Schema.Top>(
  payload: RequiredPayloadSchema<P>,
  success: Su,
  error: E,
): Method<P, Su, E>;
export function effectFn<const F extends Schema.Struct.Fields>(
  payload: RequiredPayloadFields<F>,
): Method<F, typeof Schema.Void, typeof Schema.Never>;
export function effectFn<const F extends Schema.Struct.Fields, Su extends Schema.Top>(
  payload: RequiredPayloadFields<F>,
  success: Su,
): Method<F, Su, Schema.Never>;
export function effectFn<
  const F extends Schema.Struct.Fields,
  Su extends Schema.Top,
  E extends Schema.Top,
>(
  payload: RequiredPayloadFields<F>,
  success: Su,
  error: E,
): Method<F, Su, E>;
export function effectFn(
  payloadOrConfig?: EffectFnPayload | EffectFnWireConfig,
  success?: Schema.Top,
  error?: Schema.Top,
): AnyMethod | (<P extends Schema.Top>(payload: RequiredPayloadSchema<P>) => AnyMethod) {
  // two-stage form `effectFn<Client>()(payload)` — 0 args on the first call; the client override is
  // type-only (phantom), so the returned builder is identical to the single-stage void/never path.
  if (payloadOrConfig === undefined) {
    return <P extends Schema.Top>(payload: RequiredPayloadSchema<P>): AnyMethod =>
      makeMethod("mutate", assertEffectFnPayload(payload), Schema.Void, Schema.Never, false, {});
  }
  let payload: EffectFnPayload;
  let successSchema: Schema.Top = Schema.Void;
  let errorSchema: Schema.Top = Schema.Never;
  if (isEffectFnWireConfig(payloadOrConfig)) {
    payload = assertEffectFnPayload(payloadOrConfig.payload);
    successSchema = payloadOrConfig.success ?? Schema.Void;
    errorSchema = payloadOrConfig.error ?? Schema.Never;
  } else {
    payload = assertEffectFnPayload(payloadOrConfig);
    successSchema = success ?? Schema.Void;
    errorSchema = error ?? Schema.Never;
  }
  return makeMethod("mutate", payload, successSchema, errorSchema, false, {});
}

/**
 * Two-stage `effectFn` that lets you **override the client-facing type** with an **unconstrained** `Client`:
 * `unsafeEffectFn<Client>()(payload)`. The wire/impl still come from the schema; only what `yield* Tag`
 * reads is replaced by `Client`. **Unsafe:** unlike the narrowing `effectFn<Client>()` form, `Client` is
 * *not* checked against the schema — you assert it matches. Reach for it only when the derivation can't be
 * expressed (e.g. a generic library like the queue, whose correct overloads are unprovable under `<F>`).
 *
 * ```ts
 * add: Resource.unsafeEffectFn<{
 *   (item: Resource.Decoded<typeof itemSchema>): Effect.Effect<void>
 *   (items: readonly Resource.Decoded<typeof itemSchema>[]): Effect.Effect<void>
 * }>()(itemOrItems)
 * ```
 *
 * @category spec fields
 * @public
 */
export function unsafeEffectFn<Client = Derive>() {
  return <P extends Schema.Top>(
    payload: RequiredPayloadSchema<P>,
  ): Method<P, typeof Schema.Void, typeof Schema.Never, false, MethodAnnotations, Client> =>
    makeMethod<P, typeof Schema.Void, typeof Schema.Never, false, MethodAnnotations, Client>(
      "mutate",
      payload,
      Schema.Void,
      Schema.Never,
      false,
      {},
    );
}

type PairMethodAnnotations = MethodAnnotations & { readonly callStyle: "pair" };

/**
 * Like {@link effectFn}, but the payload must be a 2-tuple schema surfaced as two call
 * arguments `(first, second?)` — used by custom-queue `add(item, level?)`.
 *
 * @category spec fields
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
): Method<Schema.Tuple<readonly [H, T]>, Su, Schema.Never, false, PairMethodAnnotations>;
export function mutatePair<Su extends Schema.Top, P extends Schema.Tuple<readonly [Schema.Top, Schema.Top]>>(
  success: Su,
  payload: P,
): Method<P, Su, Schema.Never, false, PairMethodAnnotations>;
export function mutatePair(
  success: Schema.Top,
  headOrPayload: Schema.Top,
  tail?: Schema.Top,
): Method<Schema.Tuple<readonly [Schema.Top, Schema.Top]>, Schema.Top, Schema.Never, false, PairMethodAnnotations> {
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
 * @category spec fields
 * @public
 */
export function stream<Su extends Schema.Top>(
  success: Su,
): Method<undefined, Su, Schema.Never, true>;
export function stream<Su extends Schema.Top, const F extends Schema.Struct.Fields>(
  success: Su,
  options: { readonly payload: F },
): Method<F, Su, Schema.Never, true>;
// whole-schema payload — the value is passed/decoded directly (mirrors `Rpc.make`'s schema form).
export function stream<Su extends Schema.Top, P extends Schema.Top>(
  success: Su,
  options: { readonly payload: P },
): Method<P, Su, Schema.Never, true>;
export function stream<Su extends Schema.Top, E extends Schema.Top>(
  success: Su,
  options: { readonly error: E },
): Method<undefined, Su, E, true>;
export function stream<
  Su extends Schema.Top,
  const F extends Schema.Struct.Fields,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: F; readonly error: E },
): Method<F, Su, E, true>;
export function stream<
  Su extends Schema.Top,
  P extends Schema.Top,
  E extends Schema.Top,
>(
  success: Su,
  options: { readonly payload: P; readonly error: E },
): Method<P, Su, E, true>;
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
// Resolve the schema's decoded `.Type` alias (`Schema.Struct.ReadonlySide<…>`) to its plain object shape
// (`{ to: string }`) and strip the schema's `readonly`, at the payload position. Per union-member; genuine
// arrays keep their prettified element; tuples (pair call-style) are left intact; non-objects pass through.
type PrettyObject<T> = T extends object ? { -readonly [K in keyof T]: T[K] } : T;
type PrettifyPayload<P> = P extends readonly unknown[]
  ? number extends P["length"]
    ? P extends readonly (infer E)[]
      ? readonly PrettyObject<E>[]
      : P
    : P
  : PrettyObject<P>;

/**
 * A schema's decoded value type (`.Type`), **prettified** — `{ to: string }`, not the
 * `Schema.Struct.ReadonlySide<…>` alias, and with the schema's `readonly` dropped. Use it to spell out a
 * client-type override for the `effect`/`effectFn` two-stage forms without re-deriving the alias by hand.
 *
 * @category models
 * @public
 */
export type Decoded<S extends Schema.Top> = PrettifyPayload<S["Type"]>;

type PayloadOf<M extends AnyMethod> = M["payload"] extends Schema.Top
  ? PrettifyPayload<M["payload"]["Type"]>
  : M["payload"] extends infer F extends Schema.Struct.Fields
    ? PrettifyPayload<Schema.Struct<F>["Type"]>
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

// Extract a method's explicit `Client` override (the 6th `Method` param), or `Derive` if it carries none.
type ClientOverrideOf<T> = T extends Method<
  Schema.Struct.Fields | Schema.Top | undefined,
  Schema.Top,
  Schema.Top,
  boolean,
  MethodAnnotations,
  infer Client
>
  ? Client
  : Derive;
// The CLIENT projection: an explicit override (set via the two-stage `effect`/`effectFn`) is used
// verbatim; otherwise the shape is **derived** from the schema via {@link ServiceMethod}. `ImplOf` /
// wire / peer always use `ServiceMethod`, so an override reshapes only what `yield* Tag` reads.
type ClientMethod<M extends AnyMethod, Client> = [Client] extends [Derive] ? ServiceMethod<M> : Client;

/**
 * The full service interface inferred from a {@link Spec}. Wire {@link Method}s map to
 * `Effect`/function members; off-wire {@link LocalMethod}s surface as
 * `Effect<T, never, Local<Self>>` — `yield*` to obtain the value, requiring the local layer
 * ({@link Local}) (so they're uncallable through {@link Resource.client}).
 *
 * @category models
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
// spec too.
export type ServiceOf<S extends Spec, Self = unknown> = Simplify<{
  readonly [K in keyof S]: S[K] extends FromLocalMethod<infer M>
    ? InjectLocal<M, Self> // fromService local: interface-shaped, gains `Local`
    : S[K] extends LocalMethod<infer T>
    ? LocalEffect<T, never, Self>
    : S[K] extends { readonly _tag: "constant" }
      ? SuccessOf<AsMethod<S[K]>>
      : S[K] extends { readonly _tag: "ref" }
        ? Subscribable<SuccessOf<AsMethod<S[K]>>>
        : S[K] extends { readonly kind: MethodKind } // leaf (F-independent; reconstruct via AsMethod)
          ? ClientMethod<AsMethod<S[K]>, ClientOverrideOf<S[K]>> // client handle → override or derived
          : S[K] extends Spec
            ? ServiceOf<S[K], Self> // nested group → nested service
            : never;
}>;

// ── fromService: an existing service interface as the source of truth ────────────────────────────

/**
 * Inject the {@link Local} capability into a service member's requirement channel — how a
 * {@link fromService} local member surfaces. An `Effect`/`Stream`-returning member (or a function to
 * one) keeps its shape and gains `Local<Self>` in its requirements; any other value is obtained via
 * `Effect<T, never, Local<Self>>`. Regular (local) layers satisfy `Local`; a client layer can't, so
 * calling a local on a client is a compile error.
 *
 * @category models
 * @public
 */
export type InjectLocal<T, Self> = T extends Effect.Effect<infer A, infer E, infer R>
  ? Effect.Effect<A, E, R | Local<Self>>
  : T extends Stream.Stream<infer A, infer E, infer R>
    ? Stream.Stream<A, E, R | Local<Self>>
    : T extends (...args: infer Args) => Effect.Effect<infer A, infer E, infer R>
      ? (...args: Args) => Effect.Effect<A, E, R | Local<Self>>
      : T extends (...args: infer Args) => Stream.Stream<infer A, infer E, infer R>
        ? (...args: Args) => Stream.Stream<A, E, R | Local<Self>>
        : Effect.Effect<T, never, Local<Self>>;

/** @internal */
declare const localNeedsTypeSym: unique symbol;

/** The error surface a bare {@link local} resolves to when the service interface has no member at that
 *  key — a required, unsatisfiable field, so the whole contract argument fails to type-check at the
 *  call. @public
 *
 * @category models
 */
export interface LocalNeedsType<K extends PropertyKey> {
  readonly [localNeedsTypeSym]: `Resource.local at '${K & string}' has no type — add '${K &
    string}' to the service interface, or use local<T>()`;
}

/**
 * Validate a {@link fromService} contract `C` against its service interface `I`: a **bare**
 * {@link local} at a key absent from `I` (or with no `I` at all) becomes a {@link LocalNeedsType}
 * error the user's value can't satisfy, so the contract argument is rejected **at the call site**.
 * Every other entry (a wired method, an explicit `local<T>()`, a nested group) passes through.
 *
 * @category models
 * @public
 */
export type Validate<C, I> = {
  readonly [K in keyof C]: C[K] extends BareLocal
    ? K extends keyof I
      ? C[K]
      : LocalNeedsType<K>
    : C[K] extends Spec
      ? K extends keyof I
        ? Validate<C[K], I[K]>
        : LocalNeedsType<K>
      : C[K] extends { readonly kind: MethodKind } // a wired method
        ? K extends keyof I
          ? WireHonors<SuccessOf<AsMethod<C[K]>>, IfaceSuccess<I[K]>> extends true
            ? C[K]
            : WireMismatch<K>
          : C[K] // wired member absent from the interface — allowed (interface may be a subset view)
        : C[K];
};

/** The success (element) type of a service interface member — the `A` of its returned `Effect`/`Stream`
 *  (through a function), else the member itself. Used to check a wired contract member's schema against
 *  the interface. @internal */
type IfaceSuccess<T> = T extends (...args: any) => infer R
  ? R extends Effect.Effect<infer A, any, any>
    ? A
    : R extends Stream.Stream<infer A, any, any>
      ? A
      : R
  : T extends Effect.Effect<infer A, any, any>
    ? A
    : T extends Stream.Stream<infer A, any, any>
      ? A
      : T;

/** Does a wired member's success `W` honor the interface's success promise `I` (is it assignable to
 *  it)? Tuple-wrapped so neither side distributes. A schema subtype (e.g. `Array` for a `ReadonlyArray`
 *  interface member) still honors it; a genuine mismatch (`string` for `number`) does not. @internal */
type WireHonors<W, I> = [W] extends [I] ? true : false;

/** @internal */
declare const wireMismatchSym: unique symbol;

/** The error surface a wired {@link fromService} member resolves to when its success schema disagrees
 *  with the service interface at that key — rejected at the call, naming the key. @public
 *
 * @category models
 */
export interface WireMismatch<K extends PropertyKey> {
  readonly [wireMismatchSym]: `Resource.fromService: wired member '${K &
    string}' — its success type disagrees with the service interface`;
}

/** @internal */
declare const fromLocalSym: unique symbol;

/**
 * A {@link fromService} local member as it sits in the **resolved** spec: a {@link LocalMethod} that
 * additionally carries the service interface's member type `M`, so {@link ServiceOf} surfaces it via
 * {@link InjectLocal} (its own `Effect`/function + `Local`) instead of the value-obtain
 * {@link LocalEffect} a plain `local<T>()` gets. Type-only; at runtime it's an ordinary bare
 * {@link local}. @public
 * @category models
 */
export interface FromLocalMethod<M> extends LocalMethod<M> {
  readonly [fromLocalSym]: M;
}

/**
 * Resolve a {@link fromService} contract `C` into a runnable {@link Spec}: each **bare** {@link local}
 * becomes a {@link FromLocalMethod} carrying the service interface's type at that key, so the impl
 * ({@link ImplOf}) and service ({@link ServiceOf}) both derive from `I`. Wired methods and explicit
 * `local<T>()`s pass through unchanged. @public
 * @category models
 */
export type ResolveLocals<C, I> = {
  readonly [K in keyof C]: C[K] extends BareLocal
    ? FromLocalMethod<K extends keyof I ? I[K] : unknown>
    : C[K] extends Spec
      ? K extends keyof I
        ? ResolveLocals<C[K], I[K]>
        : C[K]
      : C[K];
};

/** The wire-only service: just the {@link Method}s (used by the server impl + forwarder). @internal */
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

/**
 * Wire-only {@link ServiceOf} — local members stripped.
 *
 * @category models
 * @public
 */
export type Wire<S extends Spec> = WireServiceOf<S>;

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
 * The **implementation** a {@link localLayer} / {@link serve} expects: wire members are their
 * `Effect`/`Stream`/function, and each {@link LocalMethod} is its **raw** value `T` (the toolkit wraps
 * it to require the {@link Local}). When an impl needs a capability (e.g. {@link peers}) to
 * build, provide it via the **`Effect` form** of {@link Resource.layer} / {@link Resource.serve}
 * — resolve it once, and the members close over it.
 *
 * A `value` field's impl is the **`Stream`** that feeds it (typically a `SubscriptionRef`'s `.changes`),
 * and a `constant`'s is the `Effect<A>` resolved once — both differ from how they *surface* in
 * {@link ServiceOf} (a plain `A`), so annotate an impl with `ImplOf`, not `ServiceOf`.
 *
 * @category models
 * @public
 */
export type ImplOf<S extends Spec> = {
  readonly [K in keyof S]: S[K] extends FromLocalMethod<infer M>
    ? M // fromService local: the impl provides the interface member itself
    : S[K] extends LocalMethod<infer T>
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
 * @category models
 */
export type SpecOf<T> = T extends { readonly [specTypeSym]?: infer S extends Spec }
  ? S
  : never;

/**
 * Anchor a **reusable** impl to its contract at the definition site. Inline impls are already typed by
 * `layer` / `serve`; but the moment you hoist one to a `const` (to share it across the
 * local layer and a served entry, or across several serves) it loses that typing — the mistake then
 * surfaces far away at the serve call, with no autocomplete as you write it. `Resource.make(tag, impl)`
 * infers the tag's spec and constrains `impl` to its {@link ImplOf}, returning it typed. Runtime identity.
 *
 * ```ts
 * const scoresImpl = Resource.make(ScoresDb, { read: … }); // typed here — autocomplete + errors at the def
 * Resource.layer(ScoresDb, scoresImpl);                    // local
 * Resource.httpServer([Resource.serve(ScoresDb, scoresImpl)]); // served — same impl, both typed
 * ```
 *
 * @category constructors
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
/** @internal */
export const wireTag = (groupId: string, method: string): string => `${groupId}/${method}`;

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
/** Marks a tag built by {@link fromService} — its local members are interface-shaped (the impl's own
 *  `Effect`/function, requiring {@link Local}), so {@link buildLocalContext} passes them through with
 *  the cap rather than wrapping a raw value. Absent on standard tags. @internal */
export const fromServiceSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/fromService",
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

/** Marks a Tag as identity-claiming ({@link identity} pipe) — layer/serve claim at Lookup first. @internal */
export const identitySym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/identity",
);

// ── readiness: a derived view of a resource's status, aggregated into node /health + NodeStatus ──

/**
 * A resource's readiness — derived from its own status (its single source of truth), aggregated
 * into a node's `/health` and `NodeStatus`. `ready: false` with a `detail` says *why* (surfaced in
 * the `/health` body and the dashboard health board).
 *
 * @category models
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
 * @category models
 * @public
 */
export type ReadinessOf<Service> = (
  service: Service,
  base: Effect.Effect<Readiness, never, any>,
  // The derivation may depend on services (e.g. `Resource.readinessOf(Database)`); that requirement
  // is satisfied by the serve context the node runs readiness in, and erased at this storage seam.
) => Effect.Effect<Readiness, never, any>;

// ── node: the transport for a resource, carried in the Tag ──

// [extracted to Node module — was Resource.ts:1764-1845]

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
 * @category models
 * @public
 */
export interface ResourceTag<Self, S extends Spec, Svc = ServiceOf<S, Self>>
  extends Context.ServiceClass<Self, string, Svc> {
  /** Wire prefix — namespaces this resource's procedures on a shared `RpcServer`. */
  readonly groupId: string;
  /** Resource-level help text (CLI/TUI section help, dashboard panel title) — if declared. */
  readonly description: string | undefined;
  readonly [specSym]: FlatSpec;
  readonly [specTypeSym]?: S;
  readonly [groupSym]: RpcGroupOf<S>;
  readonly [localCapSym]: Context.Key<
    Local<Self>,
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
  /** The Node set (C1), if declared via {@link nodes} / `{ node }` / {@link distributed}; else `undefined`. */
  readonly [nodesSym]?: ReadonlyArray<AnyNode>;
  /** Set when the tag was piped through {@link identity} — layer/serve claim at Lookup first. */
  readonly [identitySym]?: true;
}

/**
 * Identity-claiming resources need Lookup's Identity client **and** a dialable Node —
 * Tag-bound (`nodes` / `{ node }`) and/or the {@link ListenNode} from {@link Node.unix} /
 * {@link Node.http} / {@link Node.ws} (including minted address-less Nodes).
 *
 * @category errors
 * @public
 */
export class IdentitySelfRequired extends Data.TaggedError("IdentitySelfRequired")<{
  readonly tag: string;
}> {
  override get message() {
    return (
      `Identity "${this.tag}" needs Lookup.Identity and a dialable self ` +
      `(listen or Resource.nodes([Node])). Provide Lookup.client / Lookup.layer.`
    );
  }
}

/**
 * Identity-stamped Tags may carry at most one Node (S1). Multi-node fleets use ordinary Tags +
 * {@link distributed} / peers — not identity.
 *
 * @category errors
 * @public
 */
export class IdentityMultiNode extends Data.TaggedError("IdentityMultiNode")<{
  readonly tag: string;
  readonly nodeCount: number;
}> {}

// [extracted to Node module — was Resource.ts:1936-1951]

/**
 * {@link lookupClient} could not resolve **exactly one** dial target for the Tag
 * (`missing` = none; `ambiguous` = more than one directory row and no {@link LookupClientOptions.pick}).
 *
 * @category errors
 * @public
 */
export class LookupClientError extends Data.TaggedError("LookupClientError")<{
  readonly tag: string;
  readonly reason: "missing" | "ambiguous";
  readonly count: number;
}> {}

/**
 * Soft pick when {@link lookupClient} sees N&gt;1 directory rows (D4) and no live
 * {@link Lookup.Advice} prefer matches a row. `"first"` = `rows[0]`; custom sync
 * fn returns the dial target.
 *
 * @category models
 * @public
 */
export type LookupClientPick =
  | "first"
  | ((
      rows: ReadonlyArray<LookupDirectoryEntry>,
    ) => LookupDirectoryEntry);

/**
 * Options for {@link lookupClient} — opt-in soft pick when the directory is ambiguous
 * and placement advice is absent or stale.
 *
 * @category models
 * @public
 */
export type LookupClientOptions = {
  readonly pick?: LookupClientPick;
};

// [extracted to Node module — was Resource.ts:1985-1994]

/** Throw when an identity Tag would carry more than one fleet Node. @internal */
const assertIdentityNodeCount = (
  tag: { readonly key: string },
  nodes: ReadonlyArray<AnyNode>,
): void => {
  if (nodes.length > 1) {
    throw new IdentityMultiNode({ tag: tag.key, nodeCount: nodes.length });
  }
};

/** A resource tag identifier — {@link Context.Service} tags carry `Service` and `Spec`. @internal */
type TagIdentifier = { readonly Service: unknown };

/** Spec carried by tag identifier `T`. @internal */
type SpecOfTag<T> = T extends ResourceTag<any, infer S extends Spec> ? S : SpecOf<T>;

/** Strip {@link Local} from an effect requirement. @internal */
type ExcludeLocal<R> = [Extract<R, Local<any>>] extends [never]
  ? R
  : Exclude<R, Local<any>>;

/** Map a service member to its {@link LocalShape} form ({@link Local} requirement removed). @internal */
type LocalizeMember<V> = V extends Effect.Effect<infer A, infer E, infer R>
  ? [ExcludeLocal<R>] extends [never]
    ? Effect.Effect<A, E>
    : Effect.Effect<A, E, ExcludeLocal<R>>
  : V extends object
    ? { readonly [K in keyof V]: LocalizeMember<V[K]> }
    : V;

/**
 * Materialized service shape for tag `T` — `Resource.Shape<Test>` ≡ `Test["Service"]`.
 *
 * @category models
 * @public
 */
export type Shape<T extends TagIdentifier> = T["Service"];

/**
 * Materialized service shape from a {@link Spec} — `Resource.ShapeOf<typeof mySpec, MyTag>`.
 *
 * @category models
 * @public
 */
export type ShapeOf<S extends Spec, Self = unknown> = ServiceOf<S, Self>;

/**
 * {@link ShapeOf} with {@link Local} stripped from local-member effects — for callers that
 * already hold the local layer.
 *
 * @category models
 * @public
 */
export type LocalShape<S extends Spec, Self = unknown> = LocalizeMember<ServiceOf<S, Self>>;

/**
 * {@link Shape} with {@link Local} stripped from local-member effects.
 *
 * @category models
 * @public
 */
export type LocalShapeOf<T extends TagIdentifier> = LocalizeMember<T["Service"]>;

/**
 * Wire-only {@link ShapeOf} — local members removed entirely.
 *
 * @category models
 * @public
 */
export type WireShape<S extends Spec> = Wire<S>;

/**
 * Wire-only {@link Shape} for tag `T`.
 *
 * @category models
 * @public
 */
export type WireOf<T extends TagIdentifier> = Wire<SpecOfTag<T>>;

/**
 * `yield* Tag` — mirrors {@link Effect.Effect | `Effect.Effect`}. Prefer the spec form for
 * readable hovers: `Resource.Resource<typeof mySpec>`. Tag form: {@link Of | `Resource.Of<Test>`}.
 *
 * `Self` is the tag identifier (requirement channel); omit it when declaring against a spec only.
 * Extra requirements beyond the tag go in `R`.
 *
 * @example
 * ```ts
 * const spec = { current: Resource.effect(Schema.Number) } as const;
 * type Acquire = Resource.Resource<typeof spec>;
 *
 * class Counter extends Resource.Tag<Counter>()("@app/Counter", spec) {}
 * type AcquireTag = Resource.Of<Counter>;
 * ```
 *
 * @category models
 * @public
 */
export type Resource<
  S extends Spec,
  E = never,
  R = never,
  Self = unknown,
> = Effect.Effect<ServiceOf<S, Self>, E, Self | R>;

/**
 * `yield* Tag` inferred from the tag identifier — `Resource.Of<Counter>`.
 *
 * @category models
 * @public
 */
export type Of<T extends TagIdentifier, E = never, R = never> = Effect.Effect<T["Service"], E, T | R>;

/**
 * Resource types — use {@link Resource.Resource} like {@link Effect.Effect | `Effect.Effect`}.
 *
 * @public
 */
export declare namespace Resource {
  /** @inheritdoc */
  export type Shape<T extends TagIdentifier> = T["Service"];

  /** @inheritdoc */
  export type ShapeOf<S extends Spec, Self = unknown> = ServiceOf<S, Self>;

  /** @inheritdoc */
  export type LocalEffect<A, E = never, Self = unknown> = Effect.Effect<A, E, Local<Self>>;

  /** @inheritdoc */
  export type LocalShape<S extends Spec, Self = unknown> = LocalizeMember<ServiceOf<S, Self>>;

  /** @inheritdoc */
  export type LocalShapeOf<T extends TagIdentifier> = LocalizeMember<T["Service"]>;

  /** @inheritdoc */
  export type Wire<S extends Spec> = WireServiceOf<S>;

  /** @inheritdoc */
  export type WireOf<T extends TagIdentifier> = Wire<SpecOfTag<T>>;

  /** @inheritdoc */
  export type WireShape<S extends Spec> = WireServiceOf<S>;

  /** @inheritdoc */
  export type Resource<
    S extends Spec,
    E = never,
    R = never,
    Self = unknown,
  > = Effect.Effect<ServiceOf<S, Self>, E, Self | R>;

  /** @inheritdoc */
  export type Of<T extends TagIdentifier, E = never, R = never> = Effect.Effect<
    T["Service"],
    E,
    T | R
  >;

  /** @inheritdoc */
  export type {
    MonitoredDependencyOptions,
    MonitoredDependency,
    MonitoredDependencySpec,
    MonitoredDependencyService,
  };
}

/**
 * A {@link ResourceTag} bound to a concrete {@link Node} — its `[nodeSym]` narrowed to that node's
 * `NodeKey<HSelf>`, which is how {@link Resource.client} discriminates the node-aware path. Returned
 * by the node-bearing tag constructors. It's a **named** type (not an inline `& { [nodeSym] }`) so a
 * consumer can `export` a node-bearing tag without leaking the internal symbol (TS4020).
 *
 * @category models
 * @public
 */
export interface NodeBoundTag<Self, S extends Spec, HSelf, Svc = ServiceOf<S, Self>>
  extends ResourceTag<Self, S, Svc> {
  readonly [nodeSym]: NodeKey<HSelf>;
}

/** The kind stamped on a bare {@link Resource.Tag} that declares none — every resource tag carries a
 *  kind, and a plain resource's is this. The typed factories stamp their own (e.g.
 *  `@nikscripts/effect-pm/QueueResource`); a bare tag defaults to this so nothing is ever kind-less.
 *
 * @category nodes & fleet
 * @public
 */
export const kind = "@nikscripts/effect-pm/Resource";

/** The contract kind a tag was built for (e.g. `@nikscripts/effect-pm/QueueResource`, or {@link kind}
 *  for a bare {@link Resource.Tag}); `undefined` only for a non-tag. The robust replacement for
 *  sniffing a tag's spec; accepts `unknown` so a `Group` member can be passed straight in. */
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
 *  collect the distinct nodes to know which nodes back its resources. */
export const nodeOf = (tag: unknown): NodeKey<unknown> | undefined => {
  if ((typeof tag === "object" || typeof tag === "function") && tag !== null && nodeSym in tag) {
    const value = tag[nodeSym];
    return value === undefined ? undefined : (value as NodeKey<unknown>);
  }
  return undefined;
};

/**
 * The declared {@link ProtocolKind} of the {@link Node} a tag is bound to (how a client reaches it —
 * `Http`/`WebSocket`/`IpcSocket`), or `undefined` for a nodeless/bare tag or a node with no declared
 * kind. A structural read (like {@link kindOf}) — the server uses it to reject a node-bound resource
 * served over a mismatched transport ({@link ProtocolKindMismatch}).
 *
 * @category nodes & fleet
 * @public
 */
export const nodeKindOf = (tag: unknown): ProtocolKind | undefined => {
  const node = nodeOf(tag);
  if (node !== undefined && Predicate.hasProperty(node, "kind")) {
    const k = node.kind;
    return k === "Http" || k === "WebSocket" || k === "IpcSocket" ? k : undefined;
  }
  return undefined;
};

/**
 * The full set of {@link ProtocolKind}s a tag's {@link Node} speaks — every transport in its
 * `endpoints` set (a multi-protocol node has several), or its single primary `kind`, or `[]` for a
 * nodeless/bare tag. A structural read; the server asserts its own transport is a **member** of this
 * set ({@link ProtocolKindMismatch}) so a node served over any of its declared transports passes.
 *
 * @public
 */
export const nodeKindsOf = (tag: unknown): ReadonlyArray<ProtocolKind> => {
  const node = nodeOf(tag);
  if (node === undefined) {
    return [];
  }
  const kinds: Array<ProtocolKind> = [];
  if (Predicate.hasProperty(node, "endpoints")) {
    const ep = node.endpoints;
    if (Predicate.hasProperty(ep, "Http")) kinds.push("Http");
    if (Predicate.hasProperty(ep, "WebSocket")) kinds.push("WebSocket");
    if (Predicate.hasProperty(ep, "IpcSocket")) kinds.push("IpcSocket");
  }
  if (kinds.length > 0) {
    return kinds;
  }
  const single = nodeKindOf(tag);
  return single !== undefined ? [single] : [];
};

/** A structural bound matching any resource tag (bare or node-bound) by its spec brand — deliberately
 *  WITHOUT the tag's `Svc` type param. A data-last combinator (`.pipe(withReadiness(...))`,
 *  `.pipe(distributed(...))`) uses it so unifying/constraining the piped tag never expands a
 *  node-bound self-referential class's service default (`ServiceOf<S, Self>`), which stock tsc caps
 *  out on as "excessively deep" (tsgo tolerates it). `T` is still inferred as the full concrete tag,
 *  so the `(tag: T) => T` return preserves it exactly.
 *
 *  **Rule:** any new `Fn.dual` data-last combinator that accepts a resource tag in a class
 *  `extends … .pipe(…)` position must constrain `T` with this brand (or an equivalent non-`Svc`
 *  shape) — never `ResourceTag | NodeBoundTag`, which reopens TS2589 under stock tsc.
 *
 *  @internal */
/** @internal */
export type PipeableTag = { readonly [specSym]: FlatSpec };

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
 * @category spec fields
 * @public
 */
export const withReadiness: {
  // Data-last: `T extends PipeableTag` (shallow) — do not constrain against ResourceTag|NodeBoundTag
  // or stock tsc TS2589s on node-bound `class extends Tag()(…).pipe(withReadiness(…))` (expands Svc).
  // Readiness `svc` is still `ServiceOf<S, any>` from the inferred tag; Self is widened so class
  // `extends` does not recurse on the declaring type — see test/resource-withreadiness-pipe.test-d.ts.
  //
  // data-last (pipe): `tag.pipe(Resource.withReadiness(fn))` — service type derived from the piped tag.
  <T extends PipeableTag>(
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
  <T extends ResourceTag<any, any, any>>(tag: T, readiness: ReadinessOf<unknown>): T => {
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
 * `unknown` so a served entry's tag + impl pass straight in.
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
 * the dependency's served status).
 */
export const readinessOf = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
): Effect.Effect<Readiness, never, Self> =>
  Effect.flatMap(tag, (service) => readinessCheck(tag, service));

/**
 * Combine readiness checks with **AND**: ready iff all are ready, else the first not-ready one (with
 * its detail). Sugar for extending a base with dependency checks:
 * `withReadiness((svc, base) => Resource.allReady([base, Resource.readinessOf(Database)]))`.
 */
export const allReady = <R>(
  checks: ReadonlyArray<Effect.Effect<Readiness, never, R>>,
): Effect.Effect<Readiness, never, R> =>
  Effect.map(Effect.all(checks), (results) => {
    const notReady = results.find((r) => !r.ready);
    return notReady ?? { ready: true };
  });

// ── monitored dependency: shared status + changes + readiness shape ──

/**
 * Wire spec for a {@link monitoredDependency} — `status` effect + `changes` stream.
 *
 * @category models
 * @public
 */
export type MonitoredDependencySpec<
  Status extends Schema.Top,
  Change extends Schema.Top,
> = {
  readonly status: Method<undefined, Status, Schema.Never>;
  readonly changes: Method<undefined, Change, Schema.Never, true>;
};

/**
 * The service slice {@link monitoredDependency} readiness reads — `status` only.
 * Assignable into {@link withReadiness} for a full {@link MonitoredDependencySpec}
 * tag (extra `changes` is ignored).
 *
 * @category models
 * @public
 */
export interface MonitoredDependencyService<Status extends Schema.Top> {
  readonly status: Effect.Effect<Schema.Schema.Type<Status>>;
}

/**
 * Authoring options for {@link monitoredDependency}. Field names match the
 * produced {@link MonitoredDependencySpec} (`status` / `changes`); `changes` is the
 * **element** schema of the live stream.
 *
 * @category models
 * @public
 */
export interface MonitoredDependencyOptions<
  Status extends Schema.Top,
  Change extends Schema.Top,
> {
  readonly status: Status;
  readonly changes: Change;
  readonly readyWhen: (status: Schema.Schema.Type<Status>) => boolean;
  readonly detail?: (status: Schema.Schema.Type<Status>) => string | undefined;
}

/**
 * Spec + readiness from {@link monitoredDependency}. Pass `spec` to
 * {@link Resource.Tag}; attach `readiness` with {@link withReadiness}.
 *
 * @category models
 * @public
 */
export interface MonitoredDependency<
  Status extends Schema.Top,
  Change extends Schema.Top,
> {
  readonly spec: MonitoredDependencySpec<Status, Change>;
  readonly readiness: ReadinessOf<MonitoredDependencyService<Status>>;
}

/**
 * Build the common **monitored dependency** contract: `status` (one-shot read),
 * `changes` (live snapshot stream), and readiness derived from `status`. Still a
 * plain {@link Resource.Tag} shape — **not** a new resource kind.
 *
 * Compose behaviour the usual way: tag + {@link withReadiness} (see
 * *Resources → behaviour via piped combinators*).
 *
 * @example
 * ```ts
 * const DbStatus = Schema.Struct({
 *   connected: Schema.Boolean,
 *   latencyMs: Schema.Number,
 * })
 *
 * const { spec, readiness } = Resource.monitoredDependency({
 *   status: DbStatus,
 *   changes: DbStatus,
 *   readyWhen: (s) => s.connected,
 *   detail: (s) => `${s.latencyMs}ms`,
 * })
 *
 * export class WnbaDatabase extends Resource.withReadiness(
 *   Resource.Tag<WnbaDatabase>()("@app/wnba/Database", spec, { node: WnbaNode }),
 *   readiness,
 * ) {}
 * ```
 *
 * @category constructors
 * @public
 */
export const monitoredDependency = <
  Status extends Schema.Top,
  Change extends Schema.Top,
>(
  options: MonitoredDependencyOptions<Status, Change>,
): MonitoredDependency<Status, Change> => ({
  spec: contract({
    status: effect(options.status),
    changes: stream(options.changes),
  }),
  readiness: (svc, _base) =>
    Effect.map(svc.status, (status): Readiness => {
      const ready = options.readyWhen(status);
      const detail = options.detail?.(status);
      return detail === undefined ? { ready } : { ready, detail };
    }),
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
  // Runtime spec value — typed loosely as `Spec` so a caller (e.g. `fromService`) can present a
  // *resolved* `S` at the type level while passing the raw contract value; `S` still flows precisely
  // via `group` (`RpcGroupOf<S>`) and the explicit type args. Every caller passes `S` explicitly.
  spec: Spec,
  group: RpcGroupOf<S>,
  description: string | undefined,
  node: NodeKey<unknown> | undefined,
  kindOverride: string | undefined,
  // `fromService` marks its tags so `buildLocalContext` uses interface-shaped local semantics
  // (pass the impl's own effect/function through, requiring `Local`) rather than the standard
  // `local<T>()` obtain-a-value wrapping.
  fromServiceMarker = false,
) => {
  if (claimedKeys.has(key)) {
    throw new DuplicateResourceKey({ key });
  }
  claimedKeys.add(key);
  const base = Context.Service<Self, ServiceOf<S, Self>>()(key);
  // per-resource local capability — granted only by localLayer, never the client.
  const localCap: Context.Key<Local<Self>, { readonly granted: true }> =
    Context.Service<Local<Self>, { readonly granted: true }>()(
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
    // C1: `{ node: X }` ≡ set-of-one — keep nodeSym + nodesSym in sync at construction.
    ...(node !== undefined
      ? { [nodesSym]: [node as AnyNode] as ReadonlyArray<AnyNode> }
      : {}),
    // Every tag carries a kind: the typed factories pass their own; a bare tag defaults to `kind`.
    [kindSym]: kindOverride ?? kind,
    [readinessSym]: undefined,
    [peersSym]: peersKey,
    [selfNodeSym]: selfNodeKey,
    ...(fromServiceMarker ? { [fromServiceSym]: true as const } : {}),
  });
};

/**
 * Create a resource service tag from a {@link Spec}. Extend the result, like
 * `Context.Tag`, but the value type is **inferred from the spec**:
 *
 * ```ts
 * class Counter extends Resource.Tag<Counter>()("Counter", {
 *   increment: Resource.effectFn({ by: Schema.Number }),
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
 * @category constructors
 * @public
 */
const makeTag = <Self>() => {
  // `Context.Service`-shaped: `Tag<Self>()(key, spec, options?)`. The spec (2nd arg) is the
  // inferring call; `options.node` rides the inferring call so its identity `HSelf` infers from the
  // argument, and the node-bearing overload narrows `[nodeSym]` to a concrete `NodeKey` — which is
  // how `Resource.client` discriminates the node-aware path. An {@link AddressedNode} narrows
  // further so `client(Tag)` can auto-wire connect.
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
      readonly node: AddressedNode<HSelf>;
    },
  ): NodeBoundTag<Self, S, HSelf> & {
    readonly [nodeSym]: AddressedNode<HSelf>;
  };
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
 * Build a resource tag from an existing **service interface** as the single source of truth. The
 * type parameter `I` is the interface; the contract gives a schema only for the members you want on
 * the wire — every other interface member becomes a **local** (surfaced via {@link InjectLocal},
 * carrying `Local<I>`). One merged handle, identical whether you hold the local layer or a client;
 * the only difference is that a client can't call the locals (a compile error — unsatisfied
 * `Local`).
 *
 * Locals are written **bare** — `Resource.local`, no `()` — and take their type from `I`. A bare
 * local with no matching interface member is rejected at the call (see {@link Validate}).
 *
 * Two type parameters, like {@link Tag}: `Self` (the class — the tag's nominal identity, `Local`
 * brand) and `I` (the service interface — a **standalone** type; passing the class itself as `I`
 * would be a circular base reference).
 *
 * ```ts
 * interface CounterShape {
 *   readonly current: Effect.Effect<number>;            // local (no schema)
 *   readonly add: (by: number) => Effect.Effect<number>; // wired
 * }
 * class Counter extends Resource.fromService<Counter, CounterShape>()("counter", {
 *   current: Resource.local,
 *   add: Resource.effectFn(Schema.Number, Schema.Number),
 * }) {}
 * ```
 *
 * @category constructors
 * @public
 */
export const fromService = <Self, I>() => {
  function build<const C extends Spec>(
    key: string,
    contract: C & Validate<C, I>,
    options?: { readonly description?: string; readonly kind?: string },
  ): ResourceTag<Self, ResolveLocals<C, I>> {
    // single resource: key doubles as the group id (its wire prefix). The contract *value* is the
    // runtime spec (bare `local`s carry the LocalMethod brand); `S` is presented resolved at the type
    // level so `ImplOf`/`FromServiceOf` derive local types from the interface `I`.
    claimGroupId(key);
    return buildInstanceTag<Self, ResolveLocals<C, I>>(
      key,
      key,
      contract,
      buildRpcGroup(key, flattenSpec(contract)),
      options?.description,
      undefined,
      options?.kind,
      true,
    );
  }
  return build;
};

/**
 * A {@link tagFor} factory: `<Self>(key) => tag`, plus the shared family metadata
 * (`groupId` / `description` / spec / group) that {@link serveInstances} reads without an
 * instance.
 *
 * @category models
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
 * @category models
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
 * const Queue = Resource.tagFor("queue", { pause: Resource.effect(Schema.Void) });
 * class Jobs extends Queue<Jobs>("@app/Jobs") {}  // spec baked in; just the instance key
 * class Mail extends Queue<Mail>("@app/Mail") {}  // shares contract + group, routed by key
 * ```
 *
 * @category constructors
 * @public
 */
function tagFor<const S extends Spec, HSelf>(
  groupId: string,
  spec: S,
  options: {
    readonly description?: string;
    readonly kind?: string;
    readonly node: AddressedNode<HSelf>;
  },
): {
  <Self>(key: string): NodeBoundTag<Self, S, HSelf> & {
    readonly [nodeSym]: AddressedNode<HSelf>;
  };
  readonly groupId: string;
  readonly description: string | undefined;
  readonly [specSym]: FlatSpec;
  readonly [specTypeSym]?: S;
  readonly [groupSym]: RpcGroupOf<S>;
};
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
 * the resource's {@link Local}, so any {@link Resource.local} (local-only) members
 * become callable here — they're a compile error under {@link Resource.client}.
 *
 * Two forms, mirroring {@link serve}: a **record** impl, or an **`Effect`** that builds the impl
 * — the latter for effectful construction (acquire a pool, resolve {@link peers}, …). The `Effect`'s
 * requirement `R` becomes the layer's, so its members close over whatever they need and stay
 * `R = never`; you provide `R` (e.g. `peersLayer`) alongside.
 *
 * @public
 */
// Build the **local service Context** — the materialized service + granted capability — from a tag and its
// **already-built** impl record. Shared by `localLayer` and the local grant that `httpServer`
// adds by default, so "serve + use locally" and "just local" produce the *identical* instance. The impl may be
// nested (grouped) — flattened to path keys matching the flat spec.
const buildLocalContext = <Self>(
  tag: {
    readonly [specSym]: FlatSpec;
    readonly [localCapSym]: Context.Key<
      Local<Self>,
      { readonly granted: true }
    >;
    readonly [fromServiceSym]?: true;
  },
  builtImpl: Record<string, unknown>,
): Effect.Effect<Context.Context<unknown>> =>
  Effect.gen(function* () {
    const cap = tag[localCapSym];
    const spec = tag[specSym];
    // `fromService` locals are interface-shaped: the impl provides the member's own `Effect` /
    // `Stream` / function, which passes through (its `Local` requirement is satisfied by the granted
    // cap in context). A standard `local<T>()` always obtains a raw value, so it's wrapped.
    const fromServiceTag = tag[fromServiceSym] === true;
    const members = flattenImpl(builtImpl, spec);
    const service: Record<string, unknown> = {};
    for (const [key, m] of Object.entries(spec)) {
      // local members surface as `Effect<T, never, Local>` (require Local to obtain the
      // value); constant fields are resolved once here into a plain value; ref fields and other wire
      // members (their `Subscribable` / `Effect` / `Stream` / function) pass through unchanged.
      if (isLocalMethod(m)) {
        const member = members[key];
        const interfaceShaped =
          fromServiceTag &&
          (Effect.isEffect(member) ||
            Stream.isStream(member) ||
            typeof member === "function");
        setPath(
          service,
          key,
          interfaceShaped ? member : Effect.as(cap, member),
        );
      } else if (isConstantMethod(m)) {
        setPath(service, key, yield* (members[key] as Effect.Effect<unknown>));
      } else {
        setPath(service, key, members[key]);
      }
    }
    return Context.make(
      tag as unknown as Context.Key<unknown, unknown>,
      service,
    ).pipe(Context.add(cap, { granted: true }));
  });

/** Dialable self for an identity claim — kind + url or path. @internal */
const isDialableSelf = (
  self: AnyNode,
): self is AnyNode & { readonly kind: ProtocolKind; readonly key: string } => {
  if (self.kind === undefined || typeof self.key !== "string") {
    return false;
  }
  if (self.kind === "IpcSocket") {
    return self.path !== undefined;
  }
  return self.url !== undefined;
};

/**
 * Client layer dialing a Lookup winner's {@link Endpoint} — used when identity claim loses.
 * @internal
 */
const clientLayerForEndpoint = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  endpoint: {
    readonly nodeKey: string;
    readonly kind: ProtocolKind;
    readonly url?: string;
    readonly path?: string;
  },
): Layer.Layer<Self> => {
  const target =
    endpoint.kind === "IpcSocket"
      ? { path: endpoint.path as string, kind: "IpcSocket" as const }
      : { url: endpoint.url as string, kind: endpoint.kind };
  const node = makeNode()(endpoint.nodeKey, target);
  // Dialable makeNode → AddressedNode; clientLayer auto-wires connect.
  return clientLayer(tag, node) as Layer.Layer<Self>;
};

/**
 * Claim `tag.key` at Lookup — won → `onWon` layer; lost → client of `original`.
 * Endpoint from {@link ListenNode} (protocol listen) or the Tag's bound Node — no `{ self }` bag.
 * Fail-closed: requires {@link LookupIdentity}; missing/unaddressed → {@link IdentitySelfRequired}.
 * @internal
 */
const identityClaimLayer = <Self, S extends Spec, A, E, R>(
  tag: ResourceTag<Self, S>,
  onWon: Layer.Layer<A, E, R>,
): Layer.Layer<A | Self, E | IdentitySelfRequired, R | LookupIdentity> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const listenOpt = yield* Effect.serviceOption(ListenNode);
      const self = Option.isSome(listenOpt)
        ? listenOpt.value
        : (nodeOf(tag) as AnyNode | undefined);
      if (self === undefined || !isDialableSelf(self)) {
        return yield* new IdentitySelfRequired({ tag: tag.key });
      }
      const Lookup = yield* Effect.promise(() => import("./Lookup"));
      const identity = yield* Lookup.Identity;
      const outcome = yield* identity
        .claim(
          new Lookup.ClaimRequest({
            key: tag.key,
            nodeKey: self.key,
            kind: self.kind,
            ...(self.url !== undefined ? { url: self.url } : {}),
            ...(self.path !== undefined ? { path: self.path } : {}),
          }),
        )
        .pipe(
          Effect.map((endpoint) => ({ _tag: "Won" as const, endpoint })),
          Effect.catchTag("DuplicateIdentity", (duplicate) =>
            Effect.succeed({
              _tag: "Lost" as const,
              original: duplicate.original,
            }),
          ),
        );
      if (outcome._tag === "Won") {
        return onWon;
      }
      return clientLayerForEndpoint(tag, outcome.original) as Layer.Layer<
        A | Self,
        E,
        R
      >;
    }),
  ) as Layer.Layer<A | Self, E | IdentitySelfRequired, R | LookupIdentity>;

/** Plain local layer — no identity claim. @internal */
const localLayerPlain = <Self, S extends Spec, R>(
  tag: ResourceTag<Self, S>,
  impl: ImplOf<S> | Effect.Effect<ImplOf<S>, never, R>,
): Layer.Layer<Self | Local<Self>, never, Exclude<R, Scope.Scope>> => {
  // One `effectContext` layer, so any `Scope` the impl's construction needs is managed by the layer.
  const build = Effect.flatMap(
    Effect.isEffect(impl) ? impl : Effect.succeed(impl),
    (builtImpl) => buildLocalContext(tag, builtImpl as Record<string, unknown>),
  );
  return Layer.effectContext(build) as Layer.Layer<
    Self | Local<Self>,
    never,
    Exclude<R, Scope.Scope>
  >;
};

function localLayer<Self, S extends Spec>(
  tag: ResourceTag<Self, S> & { readonly [identitySym]: true },
  impl: ImplOf<S>,
): Layer.Layer<Self | Local<Self>, IdentitySelfRequired, LookupIdentity>;
function localLayer<Self, S extends Spec, R>(
  tag: ResourceTag<Self, S> & { readonly [identitySym]: true },
  impl: Effect.Effect<ImplOf<S>, never, R>,
): Layer.Layer<
  Self | Local<Self>,
  IdentitySelfRequired,
  Exclude<R, Scope.Scope> | LookupIdentity
>;
function localLayer<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  impl: ImplOf<S>,
): Layer.Layer<Self | Local<Self>>;
function localLayer<Self, S extends Spec, R>(
  tag: ResourceTag<Self, S>,
  impl: Effect.Effect<ImplOf<S>, never, R>,
): Layer.Layer<Self | Local<Self>, never, Exclude<R, Scope.Scope>>;
function localLayer<Self, S extends Spec, R>(
  tag: ResourceTag<Self, S>,
  impl: ImplOf<S> | Effect.Effect<ImplOf<S>, never, R>,
): Layer.Layer<
  Self | Local<Self>,
  IdentitySelfRequired,
  Exclude<R, Scope.Scope> | LookupIdentity
> {
  const plain = localLayerPlain(tag, impl);
  if (!isIdentity(tag)) {
    return plain as Layer.Layer<
      Self | Local<Self>,
      IdentitySelfRequired,
      Exclude<R, Scope.Scope> | LookupIdentity
    >;
  }
  return identityClaimLayer(tag, plain);
}

/**
 * The **server** handlers layer for a resource: expose a real implementation over RPC by
 * mounting the contract group's handlers, each delegating to `impl`. Compose with an
 * `RpcServer` + a `Protocol` layer to actually serve over a transport.
 *
 * @public
 */
/** Invoke a wire impl member — spreads 2-tuple payloads when `callStyle` is `"pair"`. @internal */
/** @internal */
export const invokeWireMethod = (
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

/** Like {@link invokeWireMethod}, but discharges `context` into each returned {@link Effect} / {@link Stream}. @internal */
const invokeWireMethodWithContext = (
  member: unknown,
  method: AnyMethod,
  payload: unknown,
  context: Context.Context<unknown>,
): unknown => {
  const invoked = invokeWireMethod(member, method, payload);
  if (Effect.isEffect(invoked)) {
    return Effect.provideContext(invoked, context);
  }
  if (Stream.isStream(invoked)) {
    return Stream.provideContext(invoked, context);
  }
  return invoked;
};

/**
 * One served resource's registry entry — its group (folded into the shared server), wire id, kind, and
 * readiness derivation. {@link serve} appends it; {@link httpServer} reads them for the merged server +
 * `/health` + node-status.
 *
 * @category models
 * @public
 */
export interface ServedResource {
  readonly groupId: string;
  readonly group: RpcGroup.RpcGroup<any>;
  readonly kind: string;
  readonly readiness: Effect.Effect<Readiness>;
  /** Node log key when the served tag is bound to a {@link Node} (`options.node`). */
  readonly nodeLogKey?: string;
  /** Declared transport set of the tag's {@link Node}, when node-bound — the server asserts its own
   *  transport is a **member**, else {@link ProtocolKindMismatch}. A multi-protocol node lists all its
   *  transports, so serving it over any one passes. */
  readonly nodeKinds?: ReadonlyArray<ProtocolKind>;
}

/**
 * The served-resources registry — an accumulator {@link serve} appends to and {@link httpServer} reads.
 * A plain `Ref`-backed list (not type-level state), so many `serve` layers compose under `Layer.mergeAll`
 * and the server sees every one. Provided by {@link httpServer} (or {@link servedResourcesLayer}); `serve`
 * registers **only if it's present** (so `serve` also works standalone).
 *
 * @category models
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
 * A fresh {@link ServedResources} registry. {@link httpServer} / {@link ipcServer} /
 * {@link wsServer} each provide {@link Layer.fresh} of this so two servers in one
 * process (e.g. Lookup + a Worker) do not share registrations via Layer memoization.
 * Provide this standalone only to collect `serve` registrations without a server.
 *
 * @category serving
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
 * @category models
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
 * @category models
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
 * @category models
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
 * A resource's **served-only handler layer** — mounts the tag's group handlers (wire members only,
 * **no** local grant), with the handlers' requirement `R` **preserved** (not erased). This is the
 * served-only counterpart to {@link serve}, which additionally grants {@link Local} so
 * members stay callable in-process. `serveRemote`'s `R` rides the layer's requirement channel, so a
 * per-resource `Layer.provide` discharges *this* resource's dependency in isolation:
 *
 * ```ts
 * Resource.serveRemote(SeasonMatches, seasonMatchesImpl).pipe(Layer.provide(importHandlersLayer))
 * ```
 *
 * The point of `serveRemote` is the run-time-requirement case: N resources needing different
 * implementations of the same tag, each isolated — merge the layers onto one `RpcServer` (groups are
 * prefix-keyed).
 *
 * @category serving
 * @public
 */
export const serveRemote = <S extends Spec, Impl extends ServeImplOf<S, any>>(
  tag: {
    readonly groupId: string;
    readonly [specSym]: FlatSpec;
    readonly [specTypeSym]?: S;
    readonly [groupSym]: RpcGroupOf<S>;
  },
  impl: Impl | BuiltResource<S, any>,
): Layer.Layer<HandlerContextOf<S>, never, ServeRequirements<Impl>> => {
  const group = tag[groupSym];
  const handlers: Record<string, (payload: unknown) => unknown> = {};
  const wireImpl = isBuiltResource(impl) ? impl.impl : impl;
  const workerContext = isBuiltResource(impl) ? impl.workerContext : undefined;
  // flatten a (possibly nested) impl to path keys matching the flat spec + path-keyed group procedures.
  const flatImpl = flattenImpl(wireImpl as Record<string, unknown>, tag[specSym]);
  for (const [key, member] of Object.entries(flatImpl)) {
    handlers[wireTag(tag.groupId, key)] = (payload) =>
      workerContext === undefined
        ? invokeWireMethod(member, tag[specSym][key] as AnyMethod, payload)
        : invokeWireMethodWithContext(
            member,
            tag[specSym][key] as AnyMethod,
            payload,
            workerContext,
          );
  }
  // dynamic handler construction (the group's `toLayer` boundary); the outer assertion **preserves**
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
          onSome: (registry) => {
            const bound = nodeOf(tag);
            const boundKinds = nodeKindsOf(tag);
            return registry.register({
              groupId: tag.groupId,
              group,
              kind: kindOf(tag) ?? "resource",
              readiness: readinessCheckServed(tag, wireImpl),
              ...(bound !== undefined ? { nodeLogKey: bound.key } : {}),
              ...(boundKinds.length > 0 ? { nodeKinds: boundKinds } : {}),
            });
          },
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
 * When `tag` is {@link identity}-stamped, claims at Lookup first (see {@link layer}): winner serves
 * locally; loser becomes a client of the winner (no handlers). Pass dialable `options.self` when the
 * tag has no bound {@link Node}.
 *
 * @public
 */
const servePlain = <Self, S extends Spec, R = never>(
  tag: ResourceTag<Self, S>,
  impl:
    | ImplOf<S>
    | BuiltResource<S, R>
    | Effect.Effect<ImplOf<S> | BuiltResource<S, R>, never, R>,
): Layer.Layer<Self | Local<Self> | HandlerContextOf<S>, never, R> =>
  Layer.unwrap(
    Effect.map(Effect.isEffect(impl) ? impl : Effect.succeed(impl), (built) => {
      if (isBuiltResource(built)) {
        const bundle = built as BuiltResource<S, R>;
        // Plain local — identity claim (if any) already happened in {@link serve}.
        return Layer.merge(
          localLayerPlain(tag, grantLocal(tag, bundle)),
          serveRemote(tag, bundle as any) as unknown as Layer.Layer<
            HandlerContextOf<S>,
            never,
            never
          >,
        );
      }
      const granted = built as ImplOf<S>;
      return Layer.merge(
        localLayerPlain(tag, granted),
        // `built` is a valid serve impl, but `ImplOf` keeps `local` members that `ServeImplOf` omits
        // (off the wire) — a structural gap the compiler can't bridge, the same boundary `serve` casts at.
        // `R` was discharged by the Effect form above, so the handlers are requirement-free.
        serveRemote(tag, granted as unknown as ServeImplOf<S, never>) as unknown as Layer.Layer<
          HandlerContextOf<S>,
          never,
          never
        >,
      );
    }),
  );

/** Stamped on a {@link serve} layer with the served tag's key — lets an anonymous `listen` derive a
 *  legible node name from the first resource it serves without building the layer. @public */
export const servedKeySym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/servedKey",
);

/** The served tag's key stamped on a {@link serve} layer, or `undefined`. @public */
export const servedKeyOf = (layer: unknown): string | undefined => {
  if (Predicate.hasProperty(layer, servedKeySym)) {
    const k = layer[servedKeySym];
    return typeof k === "string" ? k : undefined;
  }
  return undefined;
};

export const serve = <Self, S extends Spec, R = never>(
  tag: ResourceTag<Self, S>,
  impl:
    | ImplOf<S>
    | BuiltResource<S, R>
    | Effect.Effect<ImplOf<S> | BuiltResource<S, R>, never, R>,
): Layer.Layer<Self | Local<Self> | HandlerContextOf<S>, never, R> => {
  // Stamp the served tag's key so an anonymous `listen` can derive a legible node name from the first
  // resource it serves (see {@link servedKeyOf} / anonymousNodeKey). Stamped on the FINAL layer both
  // paths return (servePlain re-merges, which would drop an earlier stamp).
  const plain = Object.assign(servePlain(tag, impl), {
    [servedKeySym]: tag.groupId,
  });
  if (!isIdentity(tag)) {
    return plain;
  }
  // Identity path requires Lookup.Identity at runtime (fail-closed). Kept off the public
  // `R` channel so plain `serve` stays TS2589-free (ResourceTag & identity brand blows up).
  const claimed = identityClaimLayer(tag, plain) as Layer.Layer<
    Self | Local<Self> | HandlerContextOf<S>,
    never,
    R
  >;
  return Object.assign(claimed, { [servedKeySym]: tag.groupId });
};

// [extracted to Node module — was Resource.ts:3193-3978]

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
 * Compose next to isolated {@link serve} layers in the same {@link httpServer} list when **one**
 * resource needs a private dependency and the rest share theirs — that is the escape hatch for the
 * old "rewrite the whole host off the bag API" cliff.
 *
 * @category serving
 * @public
 */
export const provide = <ROut, EL, RL, A, E, R>(
  dependency: Layer.Layer<ROut, EL, RL>,
  resources: readonly [Layer.Layer<A, E, R>, ...ReadonlyArray<Layer.Layer<A, E, R>>],
): Layer.Layer<A, E | EL, Exclude<R, ROut> | RL> =>
  Layer.mergeAll(...resources).pipe(Layer.provide(dependency));

/** The header carrying the target instance key, set per-call by {@link forwardClient}. */
const INSTANCE_KEY_HEADER = "key";

/**
 * One instance of a factory paired with its implementation — the element of
 * {@link Resource.serveInstances}. Built by {@link Resource.instance}.
 *
 * @category models
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
 * {@link ResourceInstance} for the {@link serveInstances} family. To serve a custom `Resource.Tag`
 * alongside queues/processes, pass its {@link Resource.serve} layer to {@link Resource.httpServer},
 * then reach it with {@link Resource.client}.
 *
 * @category constructors
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
 * const Queue = Resource.tagFor("queue", { pause: Resource.effect(Schema.Void) });
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
 * @category serving
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
        ? remapProtocolMismatch(instanceKey, key, call(undefined, { headers }))
        : m.annotations.callStyle === "pair"
          ? (arg0: unknown, arg1?: unknown) =>
              remapProtocolMismatch(instanceKey, key, call([arg0, arg1], { headers }))
          : (payload: unknown) =>
              remapProtocolMismatch(instanceKey, key, call(payload, { headers }));
  }
  // Boundary assertion (runtime-safe): every method verified present above; RPC validates
  // every payload/result against the spec schemas at the wire.
  return service as unknown as WireServiceOf<S>;
};

// [extracted to Node module — was Resource.ts:4183-4261]

/** The default RPC serialization: newline-delimited JSON — handles both one-shot and
 * **streaming** responses, and is shared by {@link httpClient} + {@link httpServer} so a
 * client and server can't silently disagree on the codec. */
/** @internal */
export const defaultSerialization: Layer.Layer<RpcSerialization.RpcSerialization> =
  RpcSerialization.layerNdjson;

const httpClientInBrowserMessage =
  "Resource.protocolHttp / httpClient cannot run in a browser: a dashboard opens many concurrent " +
  "streams (each resource's status + metrics + logs) and the browser caps at ~6 HTTP/1.1 " +
  "connections per origin, so the rest are starved (no graphs, no logs, frozen cards). Use " +
  "Resource.socketClient / a socket-kind node for the browser. See docs/observe/dashboard.md.";

/** The http client transport was built in a browser — it starves at the ~6-connection HTTP/1.1 cap and
 *  ships a blank dashboard. `socketClient` is the browser transport. A hard failure, not a warning: the
 *  starving transport is never the right choice in a browser. @internal */
class HttpClientInBrowser extends Data.TaggedError("HttpClientInBrowser")<{
  readonly message: string;
}> {}

// Fail loudly if an http client transport is built in a browser (window defined). No-op on the server /
// in tests (`window` undefined). A die, not a log — the mistake ships a silently-broken dashboard.
const dieIfHttpClientInBrowser = Effect.suspend(() =>
  typeof window === "undefined"
    ? Effect.void
    : Effect.die(new HttpClientInBrowser({ message: httpClientInBrowserMessage })),
);

/**
 * Wire a {@link Node}'s transport over **http** — the server/CLI/backend case. Builds the http client
 * `Protocol` (Fetch + serialization) from a `url` and re-keys it under the node. Serialization defaults
 * to {@link defaultSerialization} (ndjson), matching {@link httpServer}'s default so the two sides agree
 * by construction. **In a browser this fails hard** (`HttpClientInBrowser`) — http starves at the
 * ~6-connection cap; use {@link socketClient} there.
 *
 * ```ts
 * const EdgeLive = Resource.httpClient(EdgeNode, { url: "http://10.0.0.2:3002/rpc" });
 * ```
 *
 * @category clients
 * @public
 */
const httpClient = <Self>(
  node: NodeKey<Self> & { readonly url?: string },
  options?: {
    readonly url?: string;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self> =>
  // a per-node shortcut = `connect` + {@link protocolHttp}. The url lives on the node by default
  // (decision 2 — the node carries how to reach it); `options.url` overrides; `"/rpc"` (same-origin)
  // is the final fallback, matching {@link httpServer}'s default path.
  // the browser guard lives in `protocolHttp` (the root), so it applies here too.
  connectLayer(
    node,
    protocolHttp(options?.url ?? node.url ?? "/rpc", options?.serialization),
  );

// Normalize a `socketClient` url to `ws://` / `wss://`, resolved **lazily** (in the enclosing
// `Effect.sync`, at layer-build time) so the module doesn't read `location` at import — `socketClient`
// is called at module scope in files a Node server also imports. Accepts an absolute `ws(s)://` url
// (used as-is), an `http(s)://` url (scheme swapped), or a same-origin **path** like `"/rpc"`
// (resolved against the page `location`, so the browser follows its own host + http/https→ws/wss).
const toWebSocketUrl = (raw: string): string => {
  if (raw.startsWith("ws://") || raw.startsWith("wss://")) return raw;
  if (raw.startsWith("http://")) return `ws://${raw.slice(7)}`;
  if (raw.startsWith("https://")) return `wss://${raw.slice(8)}`;
  if (typeof location === "undefined") {
    throw new Error(
      `Resource.socketClient: a relative url ("${raw}") resolves against the browser's location; ` +
        `pass an absolute ws:// / wss:// url when not in a browser`,
    );
  }
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${raw.startsWith("/") ? raw : `/${raw}`}`;
};

/**
 * The **standard way to set the RPC client transport**: hand it any `RpcClient.Protocol` layer and
 * it becomes the ambient transport that every nodeless {@link Resource.client} — and each node's
 * {@link peers} fold — reads. This is the primitive; {@link protocolHttp} / {@link protocolWebsocket}
 * build the two common protocols, and {@link socketClient} / {@link httpClient} are per-node
 * shortcuts layered on top. Provide it once and the whole app agrees on a wire:
 *
 * ```ts
 * Effect.provide(app, Resource.layerProtocol(Resource.protocolWebsocket())); // one knob
 * Effect.provide(app, Resource.layerProtocol(Resource.protocolHttp("http://edge/rpc")));
 * ```
 *
 * @category transports
 * @public
 */
export const layerProtocol = (
  protocol: Layer.Layer<RpcClient.Protocol>,
): Layer.Layer<RpcClient.Protocol> => protocol;

/**
 * Build an **http** client `Protocol` (Fetch + ndjson serialization) for one endpoint `url` (default
 * `"/rpc"`, resolved same-origin in a browser) — the value you hand {@link layerProtocol} or
 * {@link Resource.connect}. The server/CLI/backend transport; a browser dashboard should prefer
 * {@link protocolWebsocket} (HTTP/1.1's ~6-connection cap starves many concurrent streams). @public
 * @category transports
 */
export const protocolHttp = (
  url = "/rpc",
  serialization: Layer.Layer<RpcSerialization.RpcSerialization> = defaultSerialization,
): Layer.Layer<RpcClient.Protocol> =>
  // guard at the root: `httpClient` / `clientHttp` / `connectHttp` all build on this, so the browser
  // footgun is closed for every http-client path in one place.
  Layer.merge(
    RpcClient.layerProtocolHttp({ url }).pipe(
      Layer.provide(serialization),
      Layer.provide(FetchHttpClient.layer),
    ),
    Layer.effectDiscard(dieIfHttpClientInBrowser),
  );

/**
 * Build a **WebSocket** client `Protocol` (one multiplexed connection + ndjson) for one endpoint
 * `url` (default `"/rpc"`). The `url` may be a same-origin **path** (`"/rpc"` — resolved against the
 * page `location`, `http→ws` / `https→wss`), an `http(s)://` url (scheme swapped), or an absolute
 * `ws(s)://` url; resolution is lazy, so this is safe at module scope in a file a Node server also
 * imports. The browser transport — every stream rides one connection, past the ~6-connection cap that
 * starves streams over {@link protocolHttp}. @public
 * @category transports
 */
export const protocolWebsocket = (
  url = "/rpc",
  serialization: Layer.Layer<RpcSerialization.RpcSerialization> = defaultSerialization,
): Layer.Layer<RpcClient.Protocol> =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(serialization),
    Layer.provide(Socket.layerWebSocket(Effect.sync(() => toWebSocketUrl(url)))),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  );

/** The **http** server `Protocol` (RPC over HTTP POST) mounted on the server router at `path` — what
 *  {@link httpServer} provides internally. `RpcSerialization` is supplied by the server. */
/** @internal */
export const serverProtocolHttp = (
  path: HttpRouter.PathInput = "/rpc",
): Layer.Layer<RpcServer.Protocol, never, RpcSerialization.RpcSerialization | HttpRouter.HttpRouter> =>
  RpcServer.layerProtocolHttp({ path });

/** The **WebSocket** server `Protocol` (RPC over a ws upgrade at `path`) — what {@link wsServer}
 *  provides internally so a browser rides one multiplexed connection per client. */
/** @internal */
export const serverProtocolWebsocket = (
  path: HttpRouter.PathInput = "/rpc",
): Layer.Layer<RpcServer.Protocol, never, RpcSerialization.RpcSerialization | HttpRouter.HttpRouter> =>
  RpcServer.layerProtocolWebsocket({ path });

/**
 * Wire a {@link Node}'s transport over a **WebSocket** — the browser counterpart to
 * {@link httpClient}. Every stream (each resource's `status` + `metrics` + `logs`) rides **one
 * multiplexed connection**, so a dashboard never trips the browser's ~6-connection-per-origin
 * HTTP/1.1 limit that starves streams over {@link httpClient} (in a browser {@link httpClient} now
 * fails hard — see its note). The server must be a {@link wsServer}.
 *
 * The `url` may be a same-origin **path** (`"/rpc"` — resolved against the page `location`, so the
 * browser follows its own host + scheme, `http→ws` / `https→wss`), an `http(s)://` url (scheme
 * swapped), or an absolute `ws(s)://` url. Resolution is lazy, so this is safe to call at module
 * scope in a file a Node server also imports. Uses the browser's global `WebSocket`.
 *
 * ```ts
 * const EdgeLive = Resource.socketClient(EdgeNode, { url: "/rpc" }); // same origin as the page
 * ```
 *
 * @category clients
 * @public
 */
const socketClient = <Self>(
  node: NodeKey<Self> & { readonly url?: string },
  options?: {
    readonly url?: string;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self> =>
  // a per-node shortcut = `connect` + {@link protocolWebsocket}. Same url resolution as
  // {@link httpClient}: `options.url` → the node's own url → `"/rpc"` (same-origin) fallback.
  connectLayer(
    node,
    protocolWebsocket(options?.url ?? node.url ?? "/rpc", options?.serialization),
  );

/**
 * Build an **ipc** client `Protocol` — Effect socket RPC over a Unix-domain path
 * (`NodeSocket.layerNet({ path })`). Same-machine counterpart to {@link protocolHttp} /
 * {@link protocolWebsocket}. @public
 * @category transports
 */
export const protocolIpc = (
  path: string,
  serialization: Layer.Layer<RpcSerialization.RpcSerialization> = defaultSerialization,
): Layer.Layer<RpcClient.Protocol> =>
  Layer.unwrap(
    Effect.promise(() => import("@effect/platform-node")).pipe(
      Effect.map(({ NodeSocket }) =>
        RpcClient.layerProtocolSocket().pipe(
          Layer.provide(serialization),
          Layer.provide(NodeSocket.layerNet({ path })),
          Layer.orDie,
        ),
      ),
    ),
  );

// Shared dial helpers (Node.connect + client auto-connect) use these builders.
bindNodeProtocolBuilders({
  protocolHttp,
  protocolWebsocket,
  protocolIpc,
});

// [extracted to Node module — was Resource.ts:4539-4649]

/**
 * Per-node ipc shortcut — {@link connect} + {@link protocolIpc} (same-machine Unix socket).
 *
 * @category clients
 * @public
 */
const ipcClient = <Self>(
  node: NodeKey<Self> & { readonly path?: string },
  options?: {
    readonly path?: string;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self, UnaddressedNode> => {
  const sock = options?.path ?? node.path;
  if (sock === undefined) {
    return unaddressedLayer(node.key);
  }
  return connectLayer(node, protocolIpc(sock, options?.serialization));
};

// [extracted to Node module — was Resource.ts:4669-4685]

// Reachability probes (transport-native, one bounded connection). Socket: reachable if the ws stays
// open past a short window (`run` errors fast if it can't connect). Http: reachable if the url answers
// at all (any response — an RPC server may 4xx a bare GET, which still proves it's up).
// Build each transport layer as a Context in a local scope and provide *that* (not the Layer) — the
// `strictEffectProvide`-clean form for a library helper that isn't an app entry point.
const probeSocketReachable = (url: string, window: Duration.Duration) =>
  Effect.gen(function* () {
    const ctx = yield* Layer.build(Socket.layerWebSocketConstructorGlobal);
    const socket = yield* Socket.makeWebSocket(Effect.sync(() => toWebSocketUrl(url))).pipe(
      Effect.provide(ctx),
    );
    yield* Effect.raceFirst(socket.run(() => Effect.void), Effect.sleep(window));
  }).pipe(Effect.scoped);

const probeHttpReachable = (url: string, timeout: Duration.Input) =>
  Effect.gen(function* () {
    const ctx = yield* Layer.build(FetchHttpClient.layer);
    yield* HttpClient.get(url).pipe(Effect.asVoid, Effect.timeout(timeout), Effect.provide(ctx));
  }).pipe(Effect.scoped);

/** One endpoint to probe — same shape as {@link selectEndpoint}. @internal */
type VerifyEndpoint = {
  readonly kind: ProtocolKind;
  readonly url?: string;
  readonly path?: string;
};

/** Address string used in verify errors (url or ipc path). @internal */
const verifyAddressOf = (ep: VerifyEndpoint): string | undefined =>
  ep.kind === "IpcSocket" ? ep.path : ep.url;

/**
 * Endpoints {@link verifyConnection} probes. Overrides (`url`/`path`) win as a single synthetic
 * endpoint; `{ all: true }` walks every declared transport; otherwise the same
 * {@link selectEndpoint} pick {@link connect} would dial.
 *
 * @internal
 */
const verifyEndpointsOf = (
  node: AnyNode,
  options?: {
    readonly url?: string;
    readonly path?: string;
    readonly all?: boolean;
  },
): ReadonlyArray<VerifyEndpoint> | UnaddressedNode => {
  if (options?.url !== undefined || options?.path !== undefined) {
    if (options.path !== undefined && options.url === undefined) {
      return [{ kind: "IpcSocket", path: options.path }];
    }
    const url = options.url;
    if (url === undefined) {
      return new UnaddressedNode({ node: node.key });
    }
    const kind: ProtocolKind =
      url.startsWith("ws://") || url.startsWith("wss://") ? "WebSocket" : "Http";
    return [{ kind, url, path: options.path }];
  }
  if (options?.all === true && node.endpoints !== undefined) {
    const out: Array<VerifyEndpoint> = [];
    if (node.endpoints.Http !== undefined) {
      out.push({ kind: "Http", url: node.endpoints.Http.url });
    }
    if (node.endpoints.WebSocket !== undefined) {
      out.push({ kind: "WebSocket", url: node.endpoints.WebSocket.url });
    }
    if (node.endpoints.IpcSocket !== undefined) {
      out.push({ kind: "IpcSocket", path: node.endpoints.IpcSocket.path });
    }
    if (out.length === 0) {
      return new UnaddressedNode({ node: node.key });
    }
    return out;
  }
  const selected = selectEndpoint(node);
  if (selected === undefined) {
    return new UnaddressedNode({ node: node.key });
  }
  return [selected];
};

/** Tier-1 transport reachability for one endpoint. @internal */
const probeEndpointReachable = (
  nodeKey: string,
  ep: VerifyEndpoint,
  timeout: Duration.Input,
): Effect.Effect<void, NodeUnreachable | UnaddressedNode> => {
  const address = verifyAddressOf(ep);
  if (address === undefined) {
    return Effect.fail(new UnaddressedNode({ node: nodeKey }));
  }
  if (ep.kind === "IpcSocket") {
    const window = Duration.millis(Math.min(Duration.toMillis(timeout), 500));
    return Effect.gen(function* () {
      const { NodeSocket } = yield* Effect.promise(() => import("@effect/platform-node"));
      const socket = yield* NodeSocket.makeNet({ path: address });
      yield* Effect.raceFirst(socket.run(() => Effect.void), Effect.sleep(window));
    }).pipe(
      Effect.scoped,
      Effect.mapError(
        (cause: unknown) => new NodeUnreachable({ node: nodeKey, url: address, cause }),
      ),
    );
  }
  const fail = Effect.mapError(
    (cause: unknown) => new NodeUnreachable({ node: nodeKey, url: address, cause }),
  );
  return ep.kind === "WebSocket"
    ? probeSocketReachable(address, Duration.millis(Math.min(Duration.toMillis(timeout), 500))).pipe(
        fail,
      )
    : probeHttpReachable(address, timeout).pipe(fail);
};

/**
 * Tier-2/3: after transport is up, dial {@link NodeStatus} over the endpoint's protocol. Failures
 * classify as {@link ProtocolUnanswered}; optional `resource` checks served-key / readiness.
 *
 * Dynamic-imports the status tag so Resource ⇄ nodeStatusResource stays acyclic.
 *
 * @internal
 */
const probeEndpointDeep = (
  nodeKey: string,
  ep: VerifyEndpoint,
  timeout: Duration.Input,
  resource: string | undefined,
): Effect.Effect<
  void,
  ProtocolUnanswered | ServiceNotServed | ServiceNotReady | UnaddressedNode
> => {
  const address = verifyAddressOf(ep);
  if (address === undefined) {
    return Effect.fail(new UnaddressedNode({ node: nodeKey }));
  }
  const dialTarget =
    ep.kind === "IpcSocket"
      ? makeNode()(`@pm/verify/${nodeKey}`, { path: address })
      : makeNode()(`@pm/verify/${nodeKey}`, { url: address, kind: ep.kind });
  return Effect.gen(function* () {
    const { NodeStatusResource } = yield* Effect.promise(
      () => import("./internal/nodeStatusResource"),
    );
    const ctx = yield* Layer.build(clientLayer(NodeStatusResource, dialTarget));
    const snap = yield* Effect.gen(function* () {
      const status = yield* NodeStatusResource;
      return yield* status.status.get;
    }).pipe(Effect.provide(ctx));
    if (resource === undefined) {
      return;
    }
    const row = snap.resources.find((r) => r.key === resource);
    if (row === undefined) {
      return yield* new ServiceNotServed({
        node: nodeKey,
        url: address,
        resource,
        served: snap.resources.map((r) => r.key),
      });
    }
    if (!row.ready) {
      return yield* new ServiceNotReady({
        node: nodeKey,
        url: address,
        resource,
        ...(row.detail !== undefined ? { detail: row.detail } : {}),
      });
    }
  }).pipe(
    Effect.scoped,
    Effect.timeout(timeout),
    Effect.mapError((cause) => {
      if (
        cause instanceof ServiceNotServed ||
        cause instanceof ServiceNotReady ||
        cause instanceof UnaddressedNode
      ) {
        return cause;
      }
      return new ProtocolUnanswered({
        node: nodeKey,
        url: address,
        kind: ep.kind,
        cause,
      });
    }),
  );
};

/** Options for the cheap (tier-1) {@link verifyConnection} probe. @public */
export type VerifyConnectionOptions = {
  readonly timeout?: Duration.Input;
  readonly url?: string;
  readonly path?: string;
  /** Probe every declared endpoint (default: the {@link selectEndpoint} pick). */
  readonly all?: boolean;
};

/** Options for deep (tier-2/3) {@link verifyConnection} — RPC + optional resource check. @public */
export type VerifyConnectionDeepOptions = VerifyConnectionOptions & {
  readonly deep: true;
  /** When set, require this resource key in `NodeStatus.resources` and `ready: true`. */
  readonly resource?: string;
};

/**
 * **Verify a node is reachable, eagerly** — a fail-fast startup check for a remote {@link Node}.
 * Default: one bounded **transport** probe (tier 1) against the endpoint {@link connect} would
 * dial (`selectEndpoint`, or every endpoint with `{ all: true }`). Fails
 * {@link NodeUnreachable} if nothing answers.
 *
 * With `{ deep: true }`, escalates after transport OK: dials the auto-served {@link NodeStatus}
 * over that endpoint. Transport up but RPC silent → {@link ProtocolUnanswered}; optional
 * `resource` key → {@link ServiceNotServed} / {@link ServiceNotReady}.
 *
 * ```ts
 * yield* Resource.verifyConnection(Droplet);                          // tier 1
 * yield* Resource.verifyConnection(Droplet, { timeout: "1 second" });
 * yield* Resource.verifyConnection(Droplet, { deep: true });          // + NodeStatus RPC
 * yield* Resource.verifyConnection(Droplet, { deep: true, resource: "app/Emails" });
 * yield* Resource.verifyConnection(Droplet, { all: true });           // every endpoint
 * ```
 *
 * Complements {@link connect}: `connect` prevents mis-wiring the client transport;
 * `verifyConnection` catches a peer that isn't there (or, with `deep`, isn't speaking RPC /
 * isn't serving the resource you need).
 *
 * @category serving
 * @public
 */
export function verifyConnection(
  node: AnyNode,
  options?: VerifyConnectionOptions,
): Effect.Effect<void, NodeUnreachable | UnaddressedNode>;
export function verifyConnection(
  node: AnyNode,
  options: VerifyConnectionDeepOptions,
): Effect.Effect<
  void,
  | NodeUnreachable
  | UnaddressedNode
  | ProtocolUnanswered
  | ServiceNotServed
  | ServiceNotReady
>;
export function verifyConnection(
  node: AnyNode,
  options?: VerifyConnectionOptions & {
    readonly deep?: boolean;
    readonly resource?: string;
  },
): Effect.Effect<
  void,
  | NodeUnreachable
  | UnaddressedNode
  | ProtocolUnanswered
  | ServiceNotServed
  | ServiceNotReady
> {
  const endpoints = verifyEndpointsOf(node, options);
  if (endpoints instanceof UnaddressedNode) {
    return Effect.fail(endpoints);
  }
  const timeout = options?.timeout ?? "3 seconds";
  const deep = options?.deep === true;
  const resource = options?.resource;
  return Effect.forEach(
    endpoints,
    (ep) =>
      Effect.gen(function* () {
        yield* probeEndpointReachable(node.key, ep, timeout);
        if (deep) {
          yield* probeEndpointDeep(node.key, ep, timeout, resource);
        }
      }),
    { discard: true },
  );
}

/** A {@link clientHttp} `target` that is neither a port, a `":port"`, nor an `http(s)://` url. @internal */
// [extracted to Node module — was Resource.ts:4780-4795]

/**
 * The single-resource client mirror of {@link httpServer}. Wire a served resource `tag` to a remote
 * over **http** and get a ready client `Layer` in one call — {@link client}`(tag)` plus the
 * batteries-included transport (Fetch + ndjson serialization), bundled.
 *
 * The `target` is a **port** (`3009` or `":3009"` → `http://localhost:3009/rpc`) for a runtime on the
 * same machine, or a full **url** for one across the network. A bad target fails the Layer with
 * {@link InvalidHttpTarget} (not a sync throw):
 *
 * ```ts
 * Effect.provide(program, Resource.clientHttp(Emails, 3001));                       // same machine
 * Effect.provide(program, Resource.clientHttp(Emails, "https://mail.internal/rpc")); // anywhere
 * ```
 *
 * @category clients
 * @public
 */
export function clientHttp<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  target: number | `:${number}` | `http://${string}` | `https://${string}`,
  options?: {
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self>;
export function clientHttp<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  target: number | string,
  options?: {
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self, InvalidHttpTarget>;
export function clientHttp<Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  target: number | string,
  options?: {
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self, InvalidHttpTarget> {
  const resolved = resolveHttpTarget(target);
  if (Result.isFailure(resolved)) {
    return invalidHttpTargetLayer(resolved.failure);
  }
  return clientLayer(tag).pipe(
    Layer.provide(protocolHttp(resolved.success, options?.serialization)),
  );
}

// ── multi-node: the fleet + peer clients ──

/**
 * Sole-node bind stamped by {@link nodes}`([n])` / {@link andNode}`(n)` from an empty set —
 * enough for {@link client}`(Tag)` to see an {@link AddressedNode} and auto-connect.
 *
 * @internal
 */
type SoleNodeBind<T, N> = T & {
  readonly [nodeSym]: N;
  readonly [nodesSym]: readonly [N];
};

/**
 * {@link andNode} type result: sole-bind only from an empty/unbound tag. Appending onto a
 * non-empty set or a narrowed {@link nodeSym} keeps `T` (does **not** claim a fresh sole
 * bind). Prefer {@link nodes}`([x])` to overwrite when you need a typed sole bind again.
 *
 * @internal
 */
type AndNodeResult<T, N> = T extends {
  readonly [nodesSym]: readonly [AnyNode, ...ReadonlyArray<AnyNode>];
}
  ? T
  : T extends { readonly [nodeSym]: NodeKey<any> }
    ? T
    : SoleNodeBind<T, N>;

/**
 * Stamp a Tag's **Node set** (C1) — overwrites. Size **1** also syncs {@link nodeSym} so
 * {@link client}`(Tag)` works; size ≠ 1 clears `nodeSym` (use `client(Tag, node)`). Identity Tags
 * may only carry ≤ 1 Node ({@link IdentityMultiNode}). Empty `nodes([])` is discoverable
 * membership (same as bare {@link distributed}); {@link peersLayer} reads Lookup directory.
 *
 * A **size-1 tuple** of an {@link AddressedNode} narrows like `{ node: X }` on the Tag ctor —
 * `client(Tag)` is fully wired. {@link andNode}`(X)` from an empty set is the same bind.
 *
 * ```ts
 * class Mail extends Resource.Tag<Mail>()("app/Mail", spec).pipe(
 *   Resource.nodes([WorkerA]), // or Resource.andNode(WorkerA)
 * ) {}
 * class Pool extends Resource.Tag<Pool>()("app/Pool", spec).pipe(
 *   Resource.nodes([A, B, C]),
 * ) {}
 * ```
 *
 * @category nodes & fleet
 * @public
 */
export const nodes: {
  // data-last — addressed sole node (before bare NodeKey; AddressedNode ⊆ NodeKey)
  <HSelf>(
    nodeSet: readonly [AddressedNode<HSelf>],
  ): <T extends PipeableTag>(tag: T) => SoleNodeBind<T, AddressedNode<HSelf>>;
  <HSelf>(
    nodeSet: readonly [NodeKey<HSelf>],
  ): <T extends PipeableTag>(tag: T) => SoleNodeBind<T, NodeKey<HSelf>>;
  <T extends PipeableTag>(
    nodeSet: ReadonlyArray<AnyNode>,
  ): (tag: T) => T;
  // data-first
  <Self, S extends Spec, HSelf>(
    tag: ResourceTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    nodeSet: readonly [AddressedNode<HSelf>],
  ): SoleNodeBind<
    NodeBoundTag<Self, S, HSelf>,
    AddressedNode<HSelf>
  >;
  <Self, S extends Spec, HSelf>(
    tag: ResourceTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    nodeSet: readonly [NodeKey<HSelf>],
  ): SoleNodeBind<NodeBoundTag<Self, S, HSelf>, NodeKey<HSelf>>;
  <Self, S extends Spec, HSelf>(
    tag: NodeBoundTag<Self, S, HSelf>,
    nodeSet: ReadonlyArray<AnyNode>,
  ): NodeBoundTag<Self, S, HSelf>;
  <Self, S extends Spec>(
    tag: ResourceTag<Self, S>,
    nodeSet: ReadonlyArray<AnyNode>,
  ): ResourceTag<Self, S>;
} = Fn.dual(
  2,
  <T extends ResourceTag<any, any, any>>(
    tag: T,
    nodeSet: ReadonlyArray<AnyNode>,
  ): T => {
    if (isIdentity(tag)) {
      assertIdentityNodeCount(tag, nodeSet);
    }
    // Size 1 → client(Tag); otherwise nodeless for client (explicit node / ambient Protocol).
    const node =
      nodeSet.length === 1 ? (nodeSet[0] as NodeKey<unknown>) : undefined;
    return Object.assign(tag, {
      [nodesSym]: nodeSet,
      [nodeSym]: node,
    });
  },
);

/**
 * Append one {@link Node} to a Tag's set (C1). From an **empty** set this is
 * {@link nodes}`([node])` — including the size-1 type bind for {@link client}`(Tag)`.
 * Identity Tags refuse a second Node ({@link IdentityMultiNode}).
 *
 * ```ts
 * class Mail extends Resource.Tag<Mail>()("app/Mail", spec).pipe(
 *   Resource.andNode(Worker), // ≡ nodes([Worker]) when starting empty
 * ) {}
 * class PoolPlus extends PoolBase.pipe(Resource.andNode(StatsNode)) {}
 * ```
 *
 * Type narrowing to a sole bind is **only** claimed when the input has no non-empty
 * Node set. After a populated set, overwrite with {@link nodes}`([x])` if you need a
 * fresh typed sole bind for {@link client}`(Tag)`.
 *
 * @category nodes & fleet
 * @public
 */
export const andNode: {
  // data-last — addressed first (AddressedNode ⊆ NodeKey)
  <HSelf>(
    node: AddressedNode<HSelf>,
  ): <T extends PipeableTag>(
    tag: T,
  ) => AndNodeResult<T, AddressedNode<HSelf>>;
  <HSelf>(
    node: NodeKey<HSelf>,
  ): <T extends PipeableTag>(tag: T) => AndNodeResult<T, NodeKey<HSelf>>;
  <T extends PipeableTag>(node: AnyNode): (tag: T) => T;
  // data-first
  <Self, S extends Spec, HSelf>(
    tag: ResourceTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    node: AddressedNode<HSelf>,
  ): AndNodeResult<
    ResourceTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    AddressedNode<HSelf>
  >;
  <Self, S extends Spec, HSelf>(
    tag: ResourceTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    node: NodeKey<HSelf>,
  ): AndNodeResult<
    ResourceTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    NodeKey<HSelf>
  >;
  <Self, S extends Spec, HSelf>(
    tag: NodeBoundTag<Self, S, HSelf>,
    node: AnyNode,
  ): NodeBoundTag<Self, S, HSelf>;
  <Self, S extends Spec>(
    tag: ResourceTag<Self, S>,
    node: AnyNode,
  ): ResourceTag<Self, S>;
} = Fn.dual(
  2,
  <T extends ResourceTag<any, any, any>>(tag: T, node: AnyNode): T => {
    const current = tag[nodesSym] ?? [];
    return nodes(tag, [...current, node]) as T;
  },
);

/**
 * Read a Tag's Node set (C1), or `[]` when undeclared.
 *
 * @category nodes & fleet
 * @public
 */
export const nodesOf = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
): ReadonlyArray<AnyNode> => tag[nodesSym] ?? [];

/**
 * Stamp a **discoverable** empty Node set (D3) — `.pipe(Resource.distributed)` ≡
 * {@link nodes}`([])`. {@link peersLayer} then reads Lookup `Directory.nodesServing`.
 *
 * For a **fixed** fleet list, use {@link nodes}`([A, B])` (not this pipe). Identity-shaped
 * like {@link identity} so `class extends Tag()(…).pipe(Resource.distributed)` type-checks.
 *
 * @category nodes & fleet
 * @public
 */
export const distributed = <T extends PipeableTag>(tag: T): T =>
  nodes(tag as unknown as ResourceTag<any, any, any>, []) as unknown as T;

/**
 * Alias of {@link nodesOf}.
 *
 * @category nodes & fleet
 * @public
 * @since 1.0.0
 */
export const distributedOf = nodesOf;

/**
 * Mark a Tag as **identity-claiming** (S1): {@link layer} / {@link serve} claim the resource key at
 * Lookup first — winner runs the local impl; loser becomes a client of the winner's endpoint.
 * Requires {@link LookupIdentity} in the layer graph (fail-closed if Lookup is down).
 *
 * Pipe onto any Resource / Process / Queue tag (same shape as {@link withReadiness}):
 *
 * ```ts
 * class Mail extends Resource.Tag<Mail>()("app/Mail", spec).pipe(Resource.identity) {}
 *
 * // bind a Node on the Tag (or listen with ListenNode) — Lookup decides winner/loser:
 * class Mail extends Resource.Tag<Mail>()("app/Mail", spec, { node: ThisNode }).pipe(
 *   Resource.identity,
 * ) {}
 * Resource.serve(Mail, impl).pipe(Layer.provide(Lookup.client(lookupNode)))
 * ```
 *
 * @category nodes & fleet
 * @public
 */
export const identity = <T extends PipeableTag>(
  tag: T,
): T & { readonly [identitySym]: true } => {
  // S1: refuse identity on a Tag that already carries a multi-node fleet.
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    "key" in tag
  ) {
    const fleet =
      (tag as { readonly [nodesSym]?: ReadonlyArray<AnyNode> })[nodesSym] ?? [];
    assertIdentityNodeCount(tag as { readonly key: string }, fleet);
  }
  return Object.assign(tag, { [identitySym]: true as const });
};

/**
 * True when `tag` was piped through {@link identity}.
 *
 * @category guards
 * @public
 */
export const isIdentity = (tag: unknown): boolean =>
  (typeof tag === "object" || typeof tag === "function") &&
  tag !== null &&
  identitySym in (tag as object) &&
  (tag as { readonly [identitySym]?: true })[identitySym] === true;

/**
 * **Lookup-resolved nodeless client** (D7/D4) — you do **not** pass a {@link Node}; Lookup
 * chooses the dial target. Contrast {@link client}`(Tag, node)`, where **you** name the Node.
 *
 * Resolution order: {@link Lookup.Identity}`resolve(tag.key)`, else
 * {@link Lookup.Directory}`nodesServing(tag.key)`.
 *
 * **Fail-closed by default:** missing or more than one directory row →
 * {@link LookupClientError}. When N&gt;1, a live {@link Lookup.Advice} prefer that
 * matches a directory row wins before D4 `{ pick }`. Opt into soft pick with
 * `{ pick: "first" }` or a sync `(rows) => DirectoryEntry`. Identity resolve
 * ignores advice / `pick` (unique by key).
 *
 * Bake name sketch was `unsafeLookupClient` (“trust Lookup or die”); bare
 * `lookupClient(Tag)` keeps that fail-closed contract when advice is absent/stale.
 *
 * ```ts
 * // Sole endpoint (identity winner or one directory row):
 * Resource.lookupClient(Mail).pipe(Layer.provide(Lookup.layer))
 *
 * // Coordinator published advice — bare client honors prefer:
 * yield* Lookup.advise({ resourceKey: Mail.key, prefer: "fleet/Mail#w2" })
 * Resource.lookupClient(Mail)
 *
 * // N>1 replicas — opt-in pick when no advice (still fail on 0):
 * Resource.lookupClient(Mail, { pick: "first" })
 *
 * // You already know an addressed Node — client auto-connects:
 * Resource.client(Mail, East)
 * ```
 *
 * @category clients
 * @public
 */
export const lookupClient = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  options?: LookupClientOptions,
): Layer.Layer<
  Self,
  LookupClientError,
  LookupIdentity | LookupDirectory | LookupAdvice
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const Lookup = yield* Effect.promise(() => import("./Lookup"));
      const identity = yield* Lookup.Identity;
      const resolved = yield* identity.resolve(
        new Lookup.ResolveRequest({ key: tag.key }),
      );
      if (Option.isSome(resolved)) {
        return clientLayerForEndpoint(tag, resolved.value);
      }
      const directory = yield* Lookup.Directory;
      const entries = yield* directory.nodesServing(
        new Lookup.NodesServingRequest({ resourceKey: tag.key }),
      );
      if (entries.length === 0) {
        return yield* new LookupClientError({
          tag: tag.key,
          reason: "missing",
          count: 0,
        });
      }
      if (entries.length === 1) {
        return clientLayerForEndpoint(tag, entries[0]!);
      }
      // M5 — honor placement advice when the preferred node is still advertised.
      const prefer = yield* Lookup.preferred(tag.key);
      if (Option.isSome(prefer)) {
        const advised = entries.find((row) => row.nodeKey === prefer.value);
        if (advised !== undefined) {
          return clientLayerForEndpoint(tag, advised);
        }
      }
      const pick = options?.pick;
      if (pick === undefined) {
        return yield* new LookupClientError({
          tag: tag.key,
          reason: "ambiguous",
          count: entries.length,
        });
      }
      const chosen = pick === "first" ? entries[0]! : pick(entries);
      return clientLayerForEndpoint(tag, chosen);
    }),
  ) as Layer.Layer<
    Self,
    LookupClientError,
    LookupIdentity | LookupDirectory | LookupAdvice
  >;

/**
 * Options for {@link discoverClient} / {@link discoverClients} — Lookup soft-pick
 * plus default-lookup bootstrap knobs.
 *
 * @category models
 * @public
 */
export type DiscoverClientOptions = LookupClientOptions & {
  readonly lookupPath?: string;
  readonly unlink?: boolean;
};

/**
 * Sugar: {@link lookupClient} + {@link Lookup.layer} / {@link Lookup.layerOptions} —
 * discover an endpoint for `tag` via Lookup (identity, then directory) and dial it.
 * Not Effect “local” vs remote; name is **discover**.
 *
 * ```ts
 * Resource.discoverClient(Jobs, { lookupPath })
 * ```
 *
 * @category clients
 * @public
 */
export const discoverClient = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  options?: DiscoverClientOptions,
): Layer.Layer<Self, LookupClientError> => {
  const { lookupPath, unlink, ...clientOptions } = options ?? {};
  return Layer.unwrap(
    Effect.promise(() => import("./Lookup")).pipe(
      Effect.map((Lookup) =>
        lookupClient(tag, clientOptions).pipe(
          Layer.provide(
            lookupPath === undefined && unlink === undefined
              ? Lookup.layer
              : Lookup.layerOptions({
                  ...(lookupPath !== undefined ? { path: lookupPath } : {}),
                  ...(unlink !== undefined ? { unlink } : {}),
                }),
          ),
        ),
      ),
    ),
  ) as Layer.Layer<Self, LookupClientError>;
};

/** Non-empty tag list for {@link discoverClients}. @internal */
type DiscoverTagList = readonly [
  PipeableTag,
  ...ReadonlyArray<PipeableTag>,
];

/** Union of Tag `Self` ids from a {@link discoverClients} list. @internal */
type ServicesOfDiscoverTags<Tags extends ReadonlyArray<PipeableTag>> =
  Tags[number] extends Context.Key<infer S, any> ? S : never;

const isDiscoverTagList = (value: unknown): value is DiscoverTagList =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (tag) =>
      (typeof tag === "object" || typeof tag === "function") && tag !== null,
  );

/**
 * {@link discoverClient} for many tags — one Lookup bootstrap, then
 * {@link Layer.mergeAll} of each {@link lookupClient}.
 *
 * Options (`lookupPath`, `pick`, …) ride the **array** form; rest uses Lookup defaults.
 *
 * ```ts
 * Resource.discoverClients([Jobs, Emails], { lookupPath })
 * Resource.discoverClients(Jobs, Emails)
 * ```
 *
 * @category clients
 * @public
 */
export function discoverClients<const Tags extends DiscoverTagList>(
  tags: Tags,
  options?: DiscoverClientOptions,
): Layer.Layer<ServicesOfDiscoverTags<Tags>, LookupClientError>;
export function discoverClients<const Tags extends DiscoverTagList>(
  ...tags: Tags
): Layer.Layer<ServicesOfDiscoverTags<Tags>, LookupClientError>;
export function discoverClients(
  first: unknown,
  second?: unknown,
  ...rest: ReadonlyArray<unknown>
): Layer.Layer<never, LookupClientError> {
  const fromArray = isDiscoverTagList(first);
  const tags: DiscoverTagList = fromArray
    ? first
    : second !== undefined
      ? ([first, second, ...rest] as unknown as DiscoverTagList)
      : ([first] as unknown as DiscoverTagList);
  const options: DiscoverClientOptions | undefined = fromArray
    ? (second as DiscoverClientOptions | undefined)
    : undefined;
  const { lookupPath, unlink, ...clientOptions } = options ?? {};
  const clients = tags.map((tag) =>
    lookupClient(tag as ResourceTag<any, any>, clientOptions),
  );
  return Layer.unwrap(
    Effect.promise(() => import("./Lookup")).pipe(
      Effect.map((Lookup) =>
        Layer.mergeAll(
          ...(clients as unknown as [
            Layer.Layer<never, LookupClientError, never>,
            ...Array<Layer.Layer<never, LookupClientError, never>>,
          ]),
        ).pipe(
          Layer.provide(
            lookupPath === undefined && unlink === undefined
              ? Lookup.layer
              : Lookup.layerOptions({
                  ...(lookupPath !== undefined ? { path: lookupPath } : {}),
                  ...(unlink !== undefined ? { unlink } : {}),
                }),
          ),
        ),
      ),
    ),
  ) as Layer.Layer<never, LookupClientError>;
}

// [extracted to Node module — was Resource.ts:5053-5132]

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

/** The wire a fleet's {@link peers} mesh dials on — a `(url) => Layer<RpcClient.Protocol>` builder.
 *  A Context.Reference defaulting to {@link protocolHttp}, so {@link peersLayer} reads it with no added
 *  requirement; {@link layerPeerProtocol} overrides it per node (e.g. to {@link protocolWebsocket}). */
type PeerProtocolBuilder = (url: string) => Layer.Layer<RpcClient.Protocol>;
const peerProtocolRef = Context.Reference<PeerProtocolBuilder>(
  "@nikscripts/effect-pm/Resource/peerProtocol",
  { defaultValue: (): PeerProtocolBuilder => protocolHttp },
);

/**
 * Set the wire a fleet's {@link peers} mesh dials on — the `(url) => Layer<RpcClient.Protocol>`
 * builder ({@link protocolHttp} by default, or {@link protocolWebsocket}). Provide it alongside
 * {@link peersLayer} on any node whose peers serve a non-http transport, so cross-node folds
 * (`fleetActive`, `activeByNode`) reach peers that speak websocket. The peer urls stay on the
 * {@link Node}s; this only chooses *how* to dial them:
 *
 * ```ts
 * Node.pipe(
 *   Layer.provide(Resource.peersLayer(WorkerPool, ThisNode)),
 *   Layer.provide(Resource.layerPeerProtocol(Resource.protocolWebsocket)),
 * );
 * ```
 *
 * @category transports
 * @public
 */
export const layerPeerProtocol = (
  builder: PeerProtocolBuilder,
): Layer.Layer<never> => Layer.succeedContext(Context.make(peerProtocolRef, builder));

/** Build a lazy peer client from an already-chosen protocol layer. @internal */
const buildPeerClientWithProtocol = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  protocol: Layer.Layer<RpcClient.Protocol>,
): Effect.Effect<PeerServiceOf<S>, never, Scope.Scope> =>
  Effect.gen(function* () {
    // build the chosen protocol into the enclosing scope, then feed its value to the client (a value
    // provide, not a layer provide — so it doesn't break scope lifetimes; same shape as clientLayer).
    const context = yield* Layer.build(protocol);
    const client: unknown = yield* Effect.provideService(
      RpcClient.make(tag[groupSym] as RpcGroup.RpcGroup<any>),
      RpcClient.Protocol,
      Context.get(context, RpcClient.Protocol),
    );
    return buildPeerService(tag, client);
  });

/** Build a lazy client to one peer node, dialing its `url` with the injected {@link peerProtocolRef}
 *  builder (http by default). Fully lazy — see {@link buildPeerService} (nothing connects until a fold
 *  reads a field). */
const buildPeerClient = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  url: string,
): Effect.Effect<PeerServiceOf<S>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const buildProtocol = yield* peerProtocolRef;
    return yield* buildPeerClientWithProtocol(tag, buildProtocol(url));
  });

/**
 * Dial a peer from a directory row or static Node address — kind-aware (D3).
 * Prefer `url` when set (honors `options.url` overrides + {@link peerProtocolRef});
 * WebSocket kind uses {@link protocolWebsocket}. Else IpcSocket/`path` → {@link protocolIpc}.
 * @internal
 */
const buildPeerClientAt = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  target: {
    readonly key: string;
    readonly kind?: ProtocolKind;
    readonly url?: string;
    readonly path?: string;
  },
): Effect.Effect<PeerServiceOf<S>, never, Scope.Scope> => {
  if (target.url !== undefined) {
    if (target.kind === "WebSocket") {
      return buildPeerClientWithProtocol(tag, protocolWebsocket(target.url));
    }
    return buildPeerClient(tag, target.url);
  }
  if (target.path !== undefined) {
    return buildPeerClientWithProtocol(tag, protocolIpc(target.path));
  }
  return Effect.die(
    new Error(`Resource.peersLayer: peer "${target.key}" has no dial target`),
  );
};

/**
 * The resource's **peer clients** — the OTHER nodes' full services, keyed by node — for a resource's
 * *own* cross-node logic. Requires the {@link peersLayer} capability. Fold them with `/MultiNode`'s
 * `combineQuery`/`combineStream` (or iterate) and add your own value:
 *
 * ```ts
 * totalConnections: combineQuery(peers, (p) => p.connections, combineSum).pipe(
 *   Effect.map((others) => pool.activeCount() + others), // self + peers — you write self in
 * )
 * ```
 *
 * **Fold over per-instance ("leaf") fields** (`p.connections`), not a peer's own fleet field
 * (`p.totalConnections`) — a peer client is the full service, so a fleet field is *callable* but would
 * make it re-gather *its* peers (a cross-node fan-out, not what you want in a fold). The plain-query
 * model has no type-level leaf/fleet distinction, so this is a convention, not a compile error.
 *
 * @category nodes & fleet
 * @public
 */
export const peers = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
): Effect.Effect<Record<string, PeerServiceOf<S>>, never, PeersId<Self>> => tag[peersSym];

/**
 * The node key this instance runs as — the **same key** its {@link peers} are keyed by. For folds that
 * key per node (`combineByNode`), so a resource's own logic can name its **own** row without
 * hand-threading the node key. Requires the {@link selfNodeLayer} / {@link peersLayer} capability:
 *
 * ```ts
 * fleetStatus: Effect.gen(function* () {
 *   const self = yield* Resource.selfNode(FleetDatabase); // the node key I am
 *   const peers = yield* Resource.peers(FleetDatabase);
 *   const byNode = yield* combineQuery(peers, (p) => p.status, combineByNode);
 *   return { ...byNode, [self]: yield* ownStatus }; // key my own row, consistently
 * })
 * ```
 *
 * @category nodes & fleet
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
 * @category nodes & fleet
 * @public
 */
export const selfNodeLayer = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  self: AnyNode,
): Layer.Layer<SelfNodeId<Self>> => Layer.succeed(tag[selfNodeSym], self.key);

/**
 * Provide the {@link peers} capability on **this** node: connect every OTHER node in the tag's
 * {@link distributed} / {@link nodes} set and expose them as the peer clients. Also provides the
 * {@link selfNode} capability (this node's key) for `byNode`-style folds. The **opt-in mesh** — add
 * it to a node's serve only where the resource's own logic reaches across nodes. `self` is the node
 * you are, so you're excluded from your own peer set.
 *
 * **Membership (D3):**
 * - **Fixed** — non-empty `options.nodes` or stamped `nodes([…])` / `distributed([…])`.
 * - **Directory** — stamped **empty** set (bare `.pipe(Resource.distributed)` / `nodes([])`): read
 *   Lookup `Directory.nodesServing(tag.key)` at layer build. Soft empty map when Directory is absent.
 * - **Undeclared** — no `nodesSym` and no `options.nodes` → empty static peers (not directory).
 *
 * **Peer addresses:** each {@link Node}'s own `url` / `path` is the default. Pass `options.url` to
 * **override** the url per node — an env-specific port, a tunnel, or a value from Effect `Config` —
 * falling back to `Node.url` when the resolver returns `undefined`. A node with no dialable address
 * is **skipped** (never a throw), so a partial mesh degrades cleanly. IpcSocket peers dial via
 * {@link protocolIpc} when only `path` is set. The resolver's error and requirements flow to the
 * layer (typed).
 *
 * @category nodes & fleet
 * @public
 */
export const peersLayer = <Self, S extends Spec, EIn = never, RIn = never>(
  tag: ResourceTag<Self, S>,
  self: AnyNode,
  options?: {
    /** The fleet (including `self`) — supply it **at the use site** so a shared resource can be defined
     *  node-free and exported; falls back to the tag's baked-in {@link distributed} set when omitted.
     *  An explicit empty array is directory-backed (same as bare {@link distributed}). */
    readonly nodes?: ReadonlyArray<AnyNode>;
    readonly url?: (node: AnyNode) => Effect.Effect<string | undefined, EIn, RIn>;
  },
): Layer.Layer<PeersId<Self> | SelfNodeId<Self>, EIn, RIn> =>
  Layer.merge(
    Layer.effect(
      tag[peersSym],
      Effect.gen(function* () {
        const stamped =
          options?.nodes !== undefined ? options.nodes : tag[nodesSym];

        // D3: stamped empty set → Lookup directory membership (soft if Directory absent).
        if (stamped !== undefined && stamped.length === 0) {
          const Lookup = yield* Effect.promise(() => import("./Lookup"));
          const dirOpt = yield* Effect.serviceOption(Lookup.Directory);
          if (Option.isNone(dirOpt)) {
            return {} as Record<string, PeerServiceOf<S>>;
          }
          const rows = yield* dirOpt.value.nodesServing(
            new Lookup.NodesServingRequest({ resourceKey: tag.key }),
          );
          type DialTarget = {
            readonly key: string;
            readonly kind: ProtocolKind;
            readonly url?: string;
            readonly path?: string;
          };
          const dialable: Array<DialTarget> = [];
          for (const row of rows) {
            if (row.nodeKey === self.key) continue;
            if (row.kind === "IpcSocket" && row.path !== undefined) {
              dialable.push({
                key: row.nodeKey,
                kind: row.kind,
                path: row.path,
              });
              continue;
            }
            if (row.url !== undefined) {
              dialable.push({
                key: row.nodeKey,
                kind: row.kind,
                url: row.url,
              });
            }
          }
          const discovered = yield* Effect.forEach(dialable, (target) =>
            Effect.map(
              buildPeerClientAt(tag, target),
              (client) => [target.key, client] as const,
            ),
          );
          return Object.fromEntries(discovered) as unknown as Record<
            string,
            PeerServiceOf<S>
          >;
        }

        // Fixed fleet (or undeclared → []); drop self to get the peers.
        const fleet = stamped ?? [];
        const others = fleet.filter((node) => node.key !== self.key);
        const resolveUrl = (
          node: AnyNode,
        ): Effect.Effect<string | undefined, EIn, RIn> =>
          options?.url === undefined
            ? Effect.succeed(node.url)
            : Effect.map(options.url(node), (override) => override ?? node.url);
        const resolved = yield* Effect.forEach(others, (node) =>
          Effect.map(resolveUrl(node), (url) => ({
            key: node.key,
            kind: node.kind,
            url,
            path: node.path,
          })),
        );
        const entries = yield* Effect.forEach(
          // no dialable address → skip (partial mesh); ipc path counts when url absent
          resolved.filter(
            (entry) =>
              entry.url !== undefined ||
              (entry.kind === "IpcSocket" && entry.path !== undefined),
          ),
          (target) =>
            Effect.map(
              buildPeerClientAt(tag, {
                key: target.key,
                kind: target.kind,
                ...(target.url !== undefined ? { url: target.url } : {}),
                ...(target.path !== undefined ? { path: target.path } : {}),
              }),
              (client) => [target.key, client] as const,
            ),
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
 * @category nodes & fleet
 * @public
 */
export const peersFrom = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
  peers: Record<string, PeerServiceOf<S>>,
): Layer.Layer<PeersId<Self>> => Layer.succeed(tag[peersSym], peers);

/**
 * A **fleet fold** of successful peer leaf picks keyed by node (plus {@link selfNode}). Soft on
 * down peers — failures are skipped (partial table). Prefer this for **optional** metric-style
 * aggregates. For **health**, use `@nikscripts/effect-pm/FleetHealth` (`Exit` → Reachable /
 * Unreachable) or `MultiNode.combineByNodeExit`.
 *
 * ```ts
 * // metric-style: missing peers omitted
 * inFlightByNode: Resource.fleetHealth(FleetMetrics, (peer) => peer.snapshot.pipe(...), own)
 * ```
 *
 * Requires the {@link peersLayer} capability (which bundles {@link selfNode}). The only error /
 * requirement is `own`'s.
 *
 * @category nodes & fleet
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
    const byNode = yield* combineQuery(peerClients, pick, combineByNode);
    const ownValue = yield* own;
    return { ...byNode, [self]: ownValue };
  });

/**
 * Build the client-side service for a tag from a wired RPC client: forward every wire method
 * (group-prefixed, id-pinned), and stub each {@link Resource.local} member with a value that
 * requires the never-granted {@link Local} (so calling one through a client is a
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
 * Paths, by whether — and where — the tag names a {@link Node}:
 * - **node-bearing + {@link AddressedNode}** — `client(Hosted)` when the tag's `{ node }` is
 *   dialable: auto-wires connect (`R = never`). Bare bound nodes still require the node service.
 * - **nodeless tag + {@link AddressedNode}** — `client(tag, Worker)` same auto-connect gate.
 * - **bare node** — `client(tag, Bare)` / bare-bound `client(Hosted)` still require the node;
 *   provide {@link Node.connect}`(Bare, protocol)` (or lookup / discoverClient) yourself.
 * - **nodeless tag, ambient transport** — ambient `RpcClient.Protocol`.
 *
 * @category clients
 * @public
 */
function clientLayer<Self, S extends Spec, HSelf>(
  tag: NodeBoundTag<Self, S, HSelf> & {
    readonly [nodeSym]: AddressedNode<HSelf>;
  },
): Layer.Layer<Self>;
function clientLayer<Self, S extends Spec, HSelf>(
  tag: NodeBoundTag<Self, S, HSelf>,
): Layer.Layer<Self, never, HSelf>;
function clientLayer<Self, S extends Spec, HSelf>(
  tag: ResourceTag<Self, S>,
  node: AddressedNode<HSelf>,
): Layer.Layer<Self>;
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
  // no node anywhere: take the transport from the ambient `RpcClient.Protocol`.
  // `serviceOption` so a missing protocol surfaces as {@link MissingClientProtocol} (not Effect's
  // opaque "Service not found" die). Typed as `E = never` like before — this replaces a defect,
  // not a channel that callers already handled; Protocol stays required in `R`.
  if (nodeKey === undefined) {
    return Layer.effect(
      tag,
      Effect.gen(function* () {
        const protocol = yield* Effect.serviceOption(RpcClient.Protocol);
        if (Option.isNone(protocol)) {
          return yield* new MissingClientProtocol({ resource: tag.key });
        }
        const client = yield* Effect.provideService(
          RpcClient.make(group),
          RpcClient.Protocol,
          protocol.value,
        );
        return yield* buildClientService(tag, client);
      }),
    ) as unknown as Layer.Layer<Self, never, RpcClient.Protocol>;
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
      Effect.flatMap(nodeKey, ({ protocol }) =>
        Effect.provideService(
          RpcClient.make(group),
          RpcClient.Protocol,
          protocol,
        ),
      ),
      (client) => buildClientService(tag, client),
    ),
  );
  // Dialable node (explicit 2nd arg *or* tag-bound): bake the canonical connect Layer
  // (WeakMap-memoized per Node class) so multiple clients share one MemoMap transport.
  if (isAddressedNode(nodeKey as AnyNode)) {
    return layer.pipe(
      Layer.provide(connectAddressed(nodeKey as AddressedNode<unknown>)),
    ) as Layer.Layer<Self, never, RpcClient.Protocol>;
  }
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
 * @category clients
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
    Effect.gen(function* () {
      const protocol = yield* Effect.serviceOption(RpcClient.Protocol);
      if (Option.isNone(protocol)) {
        return yield* new MissingClientProtocol({
          resource: factory.groupId,
        });
      }
      const rpc = yield* Effect.provideService(
        RpcClient.make(factory[groupSym]),
        RpcClient.Protocol,
        protocol.value,
      );
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
  ) as unknown as Layer.Layer<
    InstanceIdentifiers<Tags, S>,
    never,
    RpcClient.Protocol
  >;

// ── stream helpers: tag-dispatched consumption of an event stream ──

/** Anything with a string discriminant `_tag` — the element of an event stream. @internal */
type TaggedEvent = { readonly _tag: string };

/**
 * A partial set of per-`_tag` handlers over a tagged-event union — the handler-map form of
 * {@link Resource.runForEachTag}. Each handler receives the **narrowed** event for its tag.
 *
 * @category models
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
 * yield* Resource.runForEachTag(jobs.events, "Failed", (e) =>
 *   Effect.failCause(e.cause).pipe(Effect.catchTags({ Timeout: …, Rejected: … })),
 * )
 * ```
 *
 * @category reactivity
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
 * @category reactivity
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
 * remotely, {@link Resource.serve} / {@link Resource.serveRemote} expose an impl over RPC.
 *
 * @public
 */
export {
  makeTag as Tag,
  tagFor,
  // Node module: import * as Node from "@nikscripts/effect-pm/Node"
  httpClient,
  socketClient,
  ipcClient,
  instance,
  localLayer as layer,
  serveInstances,
  clientLayer as client,
  clientInstances,
};
// `query`, `mutate`, `stream`, `local`, `runForEachTag`, `runForEachTagScoped` are already
// exported above under their public names. The whole surface is now a tree-shakeable module
// namespace: **`import * as Resource from "@nikscripts/effect-pm/Resource"`** — `Resource.Tag`
// / `Resource.Node` pull only what's used.

