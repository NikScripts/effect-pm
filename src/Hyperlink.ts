/**
 * **Hyperlink toolkit** — schema-defined service tags with local + remote (RPC) layers.
 *
 * @remarks
 * Lightweight by construction: imports only `Schema` and `effect/unstable/rpc`, never a
 * heavy implementation. A {@link Spec} is the single source for a HyperService's wire
 * contract — the inferred service interface, the client forwarder, and the server
 * handlers all derive from it.
 *
 * Each method is built by {@link effect} (idempotent read) or
 * {@link effectFn} (mutation); tool metadata (help text, destructive hint) rides
 * `.annotate({...})`:
 *
 * ```ts
 * class Counter extends Hyperlink.Tag<Counter>()("@app/Counter", {
 *   current: Hyperlink.effect(Schema.Number).annotate({ description: "Current value." }),
 *   add: Hyperlink.effectFn({ by: Schema.Number }).annotate({ description: "Increment." }),
 *   reset: Hyperlink.effect(Schema.Void).annotate({ destructive: true }),
 * }) {}
 *
 * const c = yield* Counter;        // { current: Effect<number>; add: (p) => Effect<void>; reset: Effect<void> }
 * ```
 *
 * Define a tag with {@link Hyperlink.Tag}:
 * - **Solo** — `Tag<Self>()(key, spec)`: one HyperService, RpcGroup prefix = `.key`.
 * - **Shared Spec** — `Tag(wireKey, spec)` then `Factory<Self>()(instanceKey)`: many
 *   instances, one Spec / RpcGroup (prefix = `wireKey`), routed by header `key`.
 *   Same {@link Hyperlink.serve} / {@link Hyperlink.client} — merge several `serve`s
 *   that share a wire key; no separate serve/client verb.
 *
 * The same `yield* Tag` code runs anywhere; only the layer changes:
 * - {@link Hyperlink.layer} — run it locally with a real implementation;
 * - {@link Hyperlink.client} — drive it remotely over RPC, as if local;
 * - {@link Hyperlink.serve} / {@link Hyperlink.serveRemote} — expose an impl over RPC.
 *
 * Over **http**, pair {@link Hyperlink.serve} with {@link Node.httpServer} (ndjson by default so
 * client/server can't disagree on the codec). Dial with {@link Hyperlink.connect}`(tag,
 * {@link Hyperlink.protocolHttp}(target))` or a node batteries client ({@link Hyperlink.http} /
 * {@link Hyperlink.ws} / …).
 *
 * A method is {@link effect} (one-shot read), {@link effectFn} (mutation), or
 * {@link Hyperlink.stream} (a live `Stream` source, e.g. `changes`). Tag-baked
 * defaults use {@link default} (one Spec leaf) or piped {@link defaults} (a bag).
 *
 * For a repeated dependency-monitor shape (`status` + `changes` + readiness from
 * status), {@link monitoredDependency} builds the spec and readiness together —
 * still a plain tag, not a new kind. Attach readiness with {@link withReadiness}.
 *
 * @module Hyperlink
 */
import {
  Context,
  Config,
  Data,
  Duration,
  Effect,
  Exit,
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
  Semaphore,
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
// Type-only — avoids a runtime Hyperlink↔Lookup cycle; claim path dynamic-imports the module.
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
  Endpoints,
  isAddressedNode,
  ListenNode,
  NodeKey,
  ContractMismatch,
  NodeUnreachable,
  ProtocolKind,
  ProtocolUnanswered,
  ServiceNotReady,
  ServiceNotServed,
  Tag as makeNode,
  UnaddressedNode,
} from "./internal/nodeCore";
import { hashContract } from "./internal/contractHash";
import {
  bindNodeProtocolBuilders,
  connectAddressed,
  connectLayer,
  selectEndpoint,
  unaddressedLayer,
} from "./internal/nodeConnect";
import * as atomHandle from "./internal/atomHandle";
import { adaptPromiseHandle } from "./internal/promiseHandle";
import {
  HandoffDeferred as HyperlinkHandoffDeferred,
  handoffDeferralReason as handoffDeferralReasonInternal,
  hyperlinkHandoffContext,
  runHandoffFunction,
  type HandoffDeferralReason as HyperlinkHandoffDeferralReason,
  type HyperlinkHandoffContext,
  type HyperlinkHandoffFn,
  type HyperlinkHandoffOutcome,
} from "./internal/hyperlinkHandoff";
// Node listen/connect used only inside functions via dynamic import where needed;
// clientLayerForEndpoint uses clientLayer auto-connect for dialable endpoints.

/**
 * A handoff function's result (Locked #39). Tagged (`_tag` PascalCase) — `Done` (work handed off,
 * node may leave + shut down), `Retry` (re-run this HyperService's handoff, bounded), `Defer` (keep
 * the node up; surface {@link HandoffDeferred}). Build them with {@link handoffContext}.
 *
 * @category handoff
 * @public
 */
export type HandoffOutcome = HyperlinkHandoffOutcome;

/**
 * The context handed to a {@link serve} handoff function as its third argument — the outcome
 * Effects ({@link handoffContext}) to `yield*`. The happy path is `return yield* ctx.done`, or
 * just `return` (the runner coerces `void` to `Done`).
 *
 * @category handoff
 * @public
 */
export type HandoffContext = HyperlinkHandoffContext;

/**
 * A serve-site handoff function (Locked #39): `(from, to, ctx) => Effect<void | HandoffOutcome>`,
 * where `from` is the local service handle and `to` is a peer client of the same HyperService
 * (dialed from the Directory, self excluded by dial). Returning `void` (or `ctx.done`) succeeds.
 * Pass it via {@link serve}'s third options bag (`{ handoff }`).
 *
 * @category handoff
 * @public
 */
export type HandoffFn<From = ServeAny, To = ServeAny> = HyperlinkHandoffFn<
  From,
  To
>;

/** Loose service shape for {@link HandoffFn} defaults — bivariant so a handoff fn typed against the
 *  concrete service (`{ take }` / `{ enqueue }`) is still assignable. @internal */
type ServeAny = any;

/**
 * The shared {@link HandoffContext} — the outcome Effects a handoff function `yield*`s
 * (`ctx.done` / `ctx.retry` / `ctx.defer`).
 *
 * @category handoff
 * @public
 */
export const handoffContext: HandoffContext = hyperlinkHandoffContext;

/**
 * Why {@link HandoffDeferred} fired — schema of PascalCase discriminant strings
 * (`Defer` | `NoPeer` | `RetryExhausted` | `Failed`), same rule as store state-transition reasons.
 *
 * @category errors
 * @public
 */
export const handoffDeferralReason = handoffDeferralReasonInternal;
/** {@link handoffDeferralReason} member type. @public */
export type HandoffDeferralReason = HyperlinkHandoffDeferralReason;

/**
 * A served HyperService's handoff asked to defer (or had no peer / exhausted retries / failed), so
 * the OUTGOING node stayed running and did **not** leave membership. Surfaced to the
 * {@link Node.shutdown} caller (Locked #39 #8/#9). Match with `_tag: "HandoffDeferred"` and
 * {@link HandoffDeferralReason} on `.reason`.
 *
 * @category errors
 * @public
 */
export const HandoffDeferred = HyperlinkHandoffDeferred;
/** {@link HandoffDeferred} instance type. @public */
export type HandoffDeferred = HyperlinkHandoffDeferred;

/**
 * Options bag for {@link serve}'s third argument (Locked #39 #2). Either pass an {@link AnyNode}
 * directly (sugar for `{ node }`) or this bag:
 *
 * - `node` — bind the HyperService to a {@link Node} at serve time (sugar for the tag's `{ node }`).
 * - `handoff` — a {@link HandoffFn} run during {@link Node.shutdown} after drain (Locked #39).
 *
 * @category serving
 * @public
 */
export interface ServeOptions<From = ServeAny, To = ServeAny> {
  readonly node?: AnyNode;
  readonly handoff?: HandoffFn<From, To>;
}

// ── typed errors (Data.TaggedError — never raw `Error`) ──

/**
 * Two HyperServices declared the same **instance key**. Effect's `Context` is keyed by the key
 * string and silently last-write-wins, so we fail fast at declaration.
 *
 * @category errors
 * @public
 */
export class DuplicateHyperlinkKey extends Data.TaggedError(
  "DuplicateHyperlinkKey",
)<{ readonly key: string }> {}

/**
 * Two HyperServices declared the same **wire key** (RpcGroup prefix) — they'd collide on a
 * shared `RpcServer`.
 *
 * @category errors
 * @public
 */
export class DuplicateWireKey extends Data.TaggedError("DuplicateWireKey")<{
  readonly wireKey: string;
}> {}

/**
 * Two shared-Spec instances were {@link serve}d with the same Context key under one wire key.
 *
 * @category errors
 * @public
 */
export class DuplicateSharedInstance extends Data.TaggedError(
  "DuplicateSharedInstance",
)<{
  readonly wireKey: string;
  readonly key: string;
}> {}

/**
 * A shared-Spec RPC call could not be routed — missing or unknown instance `key` header.
 *
 * @category errors
 * @public
 */
export class SharedRoutingError extends Data.TaggedError("SharedRoutingError")<{
  readonly method: string;
  readonly reason: "missing-key" | "unknown-key";
  readonly key?: string;
}> {}

/**
 * A {@link defaults} bag key collides with a Spec path (or another defaults key).
 *
 * @category errors
 * @public
 */
export class DuplicateDefaultKey extends Data.TaggedError("DuplicateDefaultKey")<{
  readonly key: string;
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
 * A {@link Hyperlink.local} (local-only) method was reached through a client. Unreachable by
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
 * Remapped at the {@link Hyperlink.client} boundary so the failure is catchable by `_tag`
 * instead of looking like an opaque `RpcClientDefect`. Topology already designs this out on
 * the blessed path ({@link Node.connect} derives the transport); this is the legible backstop
 * when an escape-hatch protocol is still wrong.
 *
 * @category errors
 * @public
 */
export class ProtocolMismatch extends Data.TaggedError("ProtocolMismatch")<{
  readonly serviceKey: string;
  readonly method: string;
  readonly cause: unknown;
}> {
  override get message() {
    return (
      `Hyperlink "${this.serviceKey}" method "${this.method}" hit a transport/protocol mismatch ` +
      `(often an http client dialing a WebSocket server). Use Node.connect / the node's declared ` +
      `kind (protocolWebsocket / Hyperlink.ws), not a guessed transport.`
    );
  }
}

/**
 * A nodeless {@link Hyperlink.client}`(tag)` was built with no ambient {@link RpcClient.Protocol}.
 * Replaces Effect's opaque "Service not found: …/Protocol" die with a remediation message naming
 * the three ways to connect. The Layer still *requires* `RpcClient.Protocol` in `R` (compile-time)
 * and keeps `E = never` (this replaces a defect, not a typed channel callers already matched);
 * catch via `Exit` / `_tag` when probing an unsatisfied build.
 *
 * @category errors
 * @public
 */
export class MissingClientProtocol extends Data.TaggedError("MissingClientProtocol")<{
  readonly serviceKey: string;
}> {
  override get message() {
    return (
      `Hyperlink.client("${this.serviceKey}") has no ambient RpcClient.Protocol. ` +
      `Connect it with Hyperlink.connect(tag, protocolHttp|protocolWebsocket|protocolIpc(target)), ` +
      `Hyperlink.client(tag, node), Hyperlink.http|ws|unix|nPipe(node), or Node.connect(node).`
    );
  }
}

/**
 * Default-on verify mode for addressed {@link client} Layers (and {@link ws}).
 * - `"reject"` (default) — layer build runs {@link verifyConnection}; peer down → {@link NodeUnreachable}
 *   (tag-aware clients also deep-check the HyperService + F4 {@link contractHash})
 * - `"status"` — probe runs but failure is ignored (connect proceeds)
 * - `false` — skip verify
 *
 * Opt out: `Hyperlink.client(Tag).pipe(Layer.provide(Hyperlink.clientVerify(false)))`.
 * Nodeless {@link connect}`(tag, protocol)` does not probe — call {@link verifyConnection} yourself.
 *
 * @category models
 * @public
 */
export type ClientVerifyMode = false | "reject" | "status";

/**
 * Errors default-on / deep client verify may surface on addressed client Layers.
 *
 * @category models
 * @public
 */
export type ClientVerifyError =
  | NodeUnreachable
  | UnaddressedNode
  | ProtocolUnanswered
  | ServiceNotServed
  | ServiceNotReady
  | ContractMismatch;

/**
 * Ambient default-on client verify mode (§8.6). Defaults to `"reject"`.
 *
 * @category services
 * @public
 */
export const ClientVerify = Context.Reference<ClientVerifyMode>(
  "hyperlink-ts/Hyperlink/ClientVerify",
  { defaultValue: (): ClientVerifyMode => "reject" },
);

/**
 * Override {@link ClientVerify} for addressed client layers.
 *
 * @category layers & serving
 * @public
 */
export const clientVerify = (mode: ClientVerifyMode): Layer.Layer<never> =>
  Layer.succeed(ClientVerify, mode);

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
  serviceKey: string,
  method: string,
  value: unknown,
): unknown => {
  if (Effect.isEffect(value)) {
    return Effect.catch(value as any, (err: any) =>
      isHttpProtocolMismatchDefect(err)
        ? new ProtocolMismatch({ serviceKey, method, cause: err })
        : Effect.fail(err),
    ) as any;
  }
  if (Stream.isStream(value)) {
    return Stream.mapError(value, (err) =>
      isHttpProtocolMismatchDefect(err)
        ? new ProtocolMismatch({ serviceKey, method, cause: err })
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
 * render this HyperService.
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
   * instead of a single tuple (used by priority-queue `add(item, lane?)`).
   */
  readonly callStyle?: "pair";
}

/** Identity brand for a {@link Method} (Effect-style string `TypeId`) — distinguishes a spec leaf from a
 *  plain object; guarded with `Predicate.hasProperty`. */
const MethodTypeId = "~hyperlink-ts/Hyperlink/Method" as const;

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
 * One method of a HyperService contract — built by {@link effect} /
 * {@link effectFn} / {@link Hyperlink.stream}. Carries its `kind`, schemas
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
 * connections:      Hyperlink.effect(Schema.Number),               // per-instance (leaf) — peers see it
 * totalConnections: Hyperlink.fleet(Hyperlink.effect(Schema.Number)), // fleet — peers don't
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
 * Granted *only* by a HyperService's local layer ({@link Hyperlink.layer} / {@link serve}) — never by
 * {@link Hyperlink.client}. Local to **this runtime's materialized impl** for the tag (not a remote
 * client, not a peer). A {@link LocalMethod} carries it in its requirement channel, so calling a
 * non-serializable method against a client is a **compile error** (unsatisfied requirement); the
 * same call resolves when the local layer is provided. Branded by `Self` so one HyperService's local
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
const LocalMethodTypeId = "~hyperlink-ts/Hyperlink/LocalMethod" as const;

/**
 * A **local-only** member of a HyperService contract — built by {@link Hyperlink.local}. It is
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

/** Identity brand for a {@link DefaultMethod} — Tag-baked default value/fn, both sides, no wire. */
const DefaultMethodTypeId = "~hyperlink-ts/Hyperlink/DefaultMethod" as const;

/**
 * A **Tag-baked default** on a HyperService contract — built by {@link default}. Lives on the Spec
 * (both local and remote install the same `value`); no impl, no RPC, no {@link Local} gate.
 * Literals or sync functions. For a bag of many defaults, see {@link defaults}.
 *
 * @category models
 * @public
 */
export interface DefaultMethod<out V> {
  readonly [DefaultMethodTypeId]: typeof DefaultMethodTypeId;
  /**
   * The Tag-baked payload — literal or sync function. Installed identically on local and
   * client handles. Layer/serve may override at the **provide site only** (does not travel
   * over the wire); see {@link ImplWithDefaultOverrides}.
   */
  readonly value: V;
}

/**
 * Any {@link DefaultMethod}, erased.
 *
 * @category models
 * @public
 */
export type AnyDefaultMethod = DefaultMethod<unknown>;

/**
 * A HyperService contract: method name → wire {@link Method}, off-wire {@link LocalMethod}, or
 * Tag-baked {@link DefaultMethod}. The single source of truth.
 *
 * @category models
 * @public
 */
export interface Spec {
  readonly [k: string]: AnyMethod | AnyLocalMethod | AnyDefaultMethod | Spec;
}

/** A **flat** spec — a path-keyed record of leaves (no nested groups). The wire machinery runs on this;
 *  a (possibly nested) {@link Spec} flattens to it via {@link flattenSpec}. @internal */
export type FlatSpec = Record<string, AnyMethod | AnyLocalMethod | AnyDefaultMethod>;

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
      : S[K] extends AnyLocalMethod | AnyDefaultMethod
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
  m: AnyMethod | AnyLocalMethod | AnyDefaultMethod | Spec,
): m is AnyLocalMethod => Predicate.hasProperty(m, LocalMethodTypeId);

/** Runtime guard: is a spec entry a {@link DefaultMethod}? */
const isDefaultMethod = (
  m: AnyMethod | AnyLocalMethod | AnyDefaultMethod | Spec,
): m is AnyDefaultMethod => Predicate.hasProperty(m, DefaultMethodTypeId);

/** Runtime guard: is a spec entry a **leaf** (wire/local/default method) vs a nested **group**? @internal */
const isSpecLeaf = (
  v: AnyMethod | AnyLocalMethod | AnyDefaultMethod | Spec,
): v is AnyMethod | AnyLocalMethod | AnyDefaultMethod =>
  Predicate.hasProperty(v, MethodTypeId) ||
  Predicate.hasProperty(v, LocalMethodTypeId) ||
  Predicate.hasProperty(v, DefaultMethodTypeId);

/** Flatten a nested spec to a flat path-keyed record (identity for a flat spec). @internal */
const flattenSpec = (spec: Spec, prefix = ""): FlatSpec => {
  const flat: Record<string, AnyMethod | AnyLocalMethod | AnyDefaultMethod> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (isSpecLeaf(v)) flat[`${prefix}${k}`] = v;
    else Object.assign(flat, flattenSpec(v, `${prefix}${k}.`));
  }
  return flat;
};

/**
 * Flatten a HyperService {@link Spec} for structural validation (queue wire assert, etc.).
 *
 * @internal
 */
export const flattenHyperlinkSpec = flattenSpec;

/** Flatten a nested impl to a flat path-keyed record, walking each path from the (flat) spec's keys —
 *  identity for a flat spec. @internal */
/** @internal */
export const flattenImpl = (
  impl: Record<string, unknown>,
  flatSpec: FlatSpec,
): Record<string, unknown> => {
  const flat: Record<string, unknown> = {};
  for (const path of Object.keys(flatSpec)) {
    // Tag-baked {@link default} members have no impl slot — skip so callers aren't forced to pass placeholders.
    const leaf = flatSpec[path];
    if (leaf !== undefined && isDefaultMethod(leaf)) continue;
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

/** Read a (possibly dotted) path from an impl/service tree; `undefined` if missing. @internal */
const getPath = (obj: unknown, path: string): unknown => {
  let node: unknown = obj;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object" || !(part in node)) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return node;
};

/**
 * Where piped {@link defaults} are stowed on a Tag — merged onto the service at local/client
 * acquire (overridable via matching impl keys / {@link Layer.updateService}).
 *
 * @internal
 */
export const defaultsSym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/defaults",
);

/** A bag of Tag-baked defaults for {@link defaults}. @public */
export type DefaultsBag = { readonly [key: string]: unknown };

/**
 * Reject Promise-returning functions in a defaults bag value (same rule as {@link default}).
 *
 * @internal
 */
type SyncDefault<V> = [V] extends [(...args: never) => Promise<unknown>] ? never : V;

/**
 * Input bag for {@link defaults} / Tag `{ defaults }` — sync values only (Promise-returning
 * fns are a type error).
 *
 * @category models
 * @public
 */
export type DefaultsInput<D extends DefaultsBag> = {
  readonly [K in keyof D]: SyncDefault<D[K]>;
};

/** Prior piped bag on a Tag, or `{}`. @internal */
type PriorDefaults<T> = T extends { readonly [defaultsSym]: infer P extends DefaultsBag }
  ? P
  : {};

/** Merged piped bag after applying `D` onto `T`'s prior defaults. @internal */
type MergedDefaultsBag<T, D extends DefaultsBag> = PriorDefaults<T> & D;

/**
 * Remap a HyperService Tag's handle (`Svc`) — the licensed cast for construction
 * adornments ({@link defaults}, …). Runtime identity is unchanged; only the
 * type-level claim on {@link Result} changes.
 *
 * Generics + class-`Self` + invariant `Shape` block a proved remap, so this is
 * one `as unknown as` (same pattern as Gate `nameRunService` / WorkPool
 * `nameQueueService`). **Caller owes** a bidirectional assignability guard in a
 * `.test-d.ts` for the `Result` claim — cite that file at each call site.
 *
 * @internal
 */
export const remapTagService = <Result>(tag: {
  readonly [specSym]: FlatSpec;
}): Result => tag as unknown as Result;

/**
 * Service shape of a piped Tag before bag widen (from `Service`, else `never`).
 *
 * @internal
 */
type ServiceOfTag<T> = T extends { readonly Service: infer Svc } ? Svc : never;

/**
 * Tag after {@link defaults} (pipe or factory `{ defaults }` sugar).
 *
 * Keeps `T` (shallow {@link PipeableTag} pipe — no `HyperlinkTag<Self,…>` rebuild,
 * so `class X extends Tag<X>().pipe(defaults)` does not recurse on `X`). Widens
 * what `yield* Tag` / {@link Shape} see by intersecting a covariant
 * `Effect<Svc & Bag>` and a widened `Service` property. Soundness:
 * `test/defaults-handle.test-d.ts`.
 *
 * @category models
 * @public
 */
export type TagWithDefaults<T, D extends DefaultsBag> = T & {
  readonly [defaultsSym]: MergedDefaultsBag<T, D>;
  readonly Service: ServiceOfTag<T> & MergedDefaultsBag<T, D>;
} & Effect.Effect<ServiceOfTag<T> & MergedDefaultsBag<T, D>, never, never>;

/**
 * Piped {@link defaults} bag on a Tag, or `{}` when absent.
 *
 * @category models
 * @public
 */
export type DefaultsOf<T> = T extends { readonly [defaultsSym]: infer D extends DefaultsBag }
  ? D
  : {};

/**
 * Handle shape including a piped {@link defaults} bag.
 *
 * Prefer construction-time {@link defaults} (widens `Service` / `yield* Tag`).
 * Kept as an escape / migration alias when a Tag was built without the widen.
 *
 * @category models
 * @public
 */
export type WithDefaults<T> = ServiceOfTag<T> & DefaultsOf<T>;

/** True when a defaults bag key collides with a flat Spec path. @internal */
const defaultsCollidesWithSpec = (flat: FlatSpec, key: string): boolean => {
  if (Object.hasOwn(flat, key)) return true;
  const prefix = `${key}.`;
  for (const path of Object.keys(flat)) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
};

/**
 * Pipe **multiple** Tag-baked defaults onto a Tag — batteries on every local/client handle.
 * Spec stays branded builders; this bag is the extras surface.
 *
 * Singular fields belong in the contract via {@link default} (fully typed on `Service`).
 * Piped bag keys widen `Service` / `yield* Tag` at construction (via {@link remapTagService})
 * so bag keys are typed without a use-site cast — same licensed-cast pattern as named
 * Gate / WorkPool handles. Same key as a Spec path (or a prior bag key) →
 * {@link DuplicateDefaultKey} at pipe time.
 *
 * Layer/serve may override bag keys at the **provide site only** — overrides do not travel
 * over the wire; clients always see the Tag-baked bag. Prefer {@link Layer.updateService}
 * for post-hoc local patches.
 *
 * ```ts
 * class Jobs extends WorkPool.Tag<Jobs>()("@app/Jobs", jobSpec).pipe(
 *   Hyperlink.defaults({
 *     label: (n: number) => `job=${n}`,
 *     tags: ["admin", "beta"],
 *   }),
 * ) {}
 * // equivalent factory sugar:
 * class Jobs2 extends WorkPool.Tag<Jobs2>()("@app/Jobs2", {
 *   payload: JobSchema,
 *   defaults: { label: (n: number) => `job=${n}` },
 * }) {}
 * const jobs = yield* Jobs
 * jobs.label(1) // typed on Service — no WithDefaults cast
 * ```
 *
 * @category spec fields
 * @public
 */
export const defaults: {
  <const D extends DefaultsBag>(
    bag: DefaultsInput<D>,
  ): <T extends PipeableTag>(tag: T) => TagWithDefaults<T, D>;
  <T extends PipeableTag, const D extends DefaultsBag>(
    tag: T,
    bag: DefaultsInput<D>,
  ): TagWithDefaults<T, D>;
} = Fn.dual(
  2,
  <T extends PipeableTag, D extends DefaultsBag>(
    tag: T,
    bag: D,
  ): TagWithDefaults<T, D> => {
    const flat = tag[specSym];
    for (const key of Object.keys(bag)) {
      if (defaultsCollidesWithSpec(flat, key)) {
        throw new DuplicateDefaultKey({ key });
      }
    }
    const prior =
      defaultsSym in tag
        ? ((tag as { readonly [defaultsSym]?: DefaultsBag })[defaultsSym] ?? {})
        : {};
    for (const key of Object.keys(bag)) {
      if (Object.hasOwn(prior, key)) {
        throw new DuplicateDefaultKey({ key });
      }
    }
    // Soundness: test/defaults-handle.test-d.ts (Svc ⇄ Svc & bag; toolkit keeps named handle).
    return remapTagService<TagWithDefaults<T, D>>(
      Object.assign(tag, {
        [defaultsSym]: { ...prior, ...bag },
      }),
    );
  },
);

/**
 * Apply {@link defaults} when a bag is present — factory `{ defaults }` sugar helper.
 *
 * @internal
 */
export const applyTagDefaults = <T extends PipeableTag, D extends DefaultsBag>(
  tag: T,
  bag: D | undefined,
): T | TagWithDefaults<T, D> => (bag === undefined ? tag : defaults(tag, bag));

/** Install piped {@link defaults} onto a service, with optional impl overrides. @internal */
const applyDefaultsBag = (
  service: Record<string, unknown>,
  bag: DefaultsBag | undefined,
  impl: Record<string, unknown> | undefined,
): void => {
  if (bag === undefined) return;
  for (const [key, value] of Object.entries(bag)) {
    const override = impl === undefined ? undefined : getPath(impl, key);
    setPath(service, key, override !== undefined ? override : value);
  }
};

/** Implementation of {@link local}'s callable form (`local<T>()`); the public value is the branded
 *  {@link local} below (also usable **bare**). @internal */
const localFn = <T>(defaultValue?: T): LocalMethod<T> => ({
  [LocalMethodTypeId]: LocalMethodTypeId,
  ...(defaultValue !== undefined ? { value: defaultValue } : {}),
});

/** Brand marking the **bare** {@link local} value (used without `()`): a valid {@link LocalMethod}
 *  whose element type is supplied by the service interface position in a {@link Tag}`<Self, I>()`
 *  contract. Distinct from a called `local<T>()` so the contract can reject a bare local that has no
 *  interface type to resolve from. @internal */
const bareLocalSym: unique symbol = Symbol.for(
  "~hyperlink-ts/Hyperlink/bareLocal",
);

/**
 * The **bare** {@link local} marker — `Hyperlink.local` used *without* `()`. Valid only inside a
 * {@link Tag}`<Self, I>()` contract, where the service interface at that key supplies its type. Using
 * it where no type can be resolved is a compile error (see {@link Tag}).
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
 * - `Hyperlink.local<T>()` — the element type `T` given explicitly (for a plain {@link Tag}`<Self>()`
 *   contract).
 * - `Hyperlink.local` — **bare**, no `()`; its type is taken from the service interface in a
 *   {@link Tag}`<Self, I>()` contract. Rejected where no interface type is available.
 *
 * @category spec fields
 * @public
 */
export const local: typeof localFn & BareLocal = Object.assign(localFn, {
  [LocalMethodTypeId]: LocalMethodTypeId,
  [bareLocalSym]: true as const,
});

/**
 * Declare a **single Tag-baked default** in the contract — identical local and remote, no wire,
 * no impl slot. Accepts a literal or a sync function (Promise-returning fns are a type error —
 * async belongs in {@link effect} / {@link effectFn} or {@link promise}).
 *
 * For **multiple** defaults, pipe {@link defaults} onto the Tag instead (bag keys
 * widen `Service` at construction — `yield* Tag` sees them).
 *
 * Layer/serve may override a Spec default at the **provide site only** (see
 * {@link ImplWithDefaultOverrides}); the remote client always installs the Tag-baked value.
 *
 * ```ts
 * class Counter extends Hyperlink.Tag<Counter>()("counter", {
 *   current: Hyperlink.effect(Schema.Number),
 *   label: Hyperlink.default((n: number) => `count=${n}`),
 *   unit: Hyperlink.default("count"),
 * }) {}
 * ```
 *
 * @category spec fields
 * @public
 */
const default_ = <const V>(
  value: [V] extends [(...args: never) => Promise<unknown>] ? never : V,
): DefaultMethod<V> => ({
  [DefaultMethodTypeId]: DefaultMethodTypeId,
  value: value as V,
});

export { default_ as default };

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
 * True when a spec member is an inputless void command (`Hyperlink.effect(Schema.Void)`),
 * as opposed to an inputless value read (`Hyperlink.effect` with a non-void success).
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
 * unit gates and value reads. Contrast {@link isVoidCommand}, which is only void commands.
 * Not {@link Effect.isEffect | `Effect.isEffect`} (runtime value guard).
 *
 * @category guards
 * @public
 */
export const isEffect = (m: AnyMethod): boolean =>
  m.payload === undefined;

/**
 * The single {@link Method} constructor — {@link effect}, {@link effectFn}, {@link value}, and
 * {@link stream} all go through it.
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
 * The other shapes are {@link value} / {@link effectFn} / {@link stream} / {@link ref}.
 *
 * ```ts
 * size: Hyperlink.effect(Schema.Number).annotate({ description: "Total pending." }),
 * run: Hyperlink.effect(success, error).annotate({ description: "Tracked manual run." }),
 * run: Hyperlink.effect({ success, error }).annotate({ description: "Tracked manual run." }),
 * get: Hyperlink.effectFn({ id: Schema.String }, Schema.User),
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

/** A {@link Method} marked as a **value** field (via {@link value}) — resolved once at acquire,
 *  surfaced as a plain value. Tagged with a readable `_tag: "value"`. @public
 *
 * @category models
 */
export type ValueField<M extends AnyMethod> = Marked<M, { readonly _tag: "value" }>;

/** Runtime guard: is a spec entry a {@link value} field? */
const isValueMethod = (m: AnyMethod | AnyLocalMethod | AnyDefaultMethod): boolean =>
  Predicate.hasProperty(m, "_tag") && m._tag === "value";

/**
 * Define a **`value`** field — materialize a plain property (`p.x: A`, no `yield*`) **once** when the
 * resource is acquired, identical local and remote. The impl supplies an `Effect<A, E>` (run once at
 * acquire; use `Effect.succeed` for a literal). A non-`never` error schema fails **layer/client
 * acquire** (all-or-nothing) — after a successful acquire every `value` leaf is plain `A`. Live state
 * is {@link ref}; on-demand reads are {@link effect}.
 *
 * ```ts
 * maxSize: Hyperlink.value(Schema.Number),
 * name: Hyperlink.value(Schema.String, Schema.String), // fallible at acquire
 * ```
 *
 * @category spec fields
 * @public
 */
export function value<Su extends Schema.Top>(
  success: Su,
): ValueField<Method<undefined, Su, typeof Schema.Never>>;
export function value<Su extends Schema.Top, E extends Schema.Top>(
  success: Su,
  error: E,
): ValueField<Method<undefined, Su, E>>;
export function value(
  success: Schema.Top,
  error: Schema.Top = Schema.Never,
): ValueField<AnyMethod> {
  return marked(effect(success, error), { _tag: "value" as const });
}

/** A {@link Method} marked as a **ref** field (via {@link ref}) — surfaces as a {@link Subscribable}.
 *  Tagged with a readable `_tag: "ref"`. @public
 *
 * @category models
 */
export type RefField<M extends AnyMethod> = Marked<M, { readonly _tag: "ref" }>;

/** Runtime guard: is a spec entry a {@link ref} field? */
const isRefMethod = (m: AnyMethod | AnyLocalMethod | AnyDefaultMethod): boolean =>
  Predicate.hasProperty(m, "_tag") && m._tag === "ref";

/**
 * Define a **`ref`** field — reactive state surfaced as a {@link Subscribable}<A> (`get` + `changes`),
 * uniform local and remote. The impl **owns** a `SubscriptionRef` (writes it) and provides it via
 * {@link subscribable}; consumers **read** (`yield* svc.x.get`) and **observe** (`svc.x.changes`) — a read
 * is an honest `Effect`, not a synchronous peek. For values fixed at acquire use {@link value}; for
 * on-demand calls use {@link effect}.
 *
 * @category spec fields
 * @public
 */
export const ref = <Su extends Schema.Top>(
  success: Su,
): RefField<Method<undefined, Su, typeof Schema.Never, true>> =>
  marked(stream(success), { _tag: "ref" as const });

/**
 * Narrow a HyperService contract object through the builder (prefer over `as const satisfies`).
 *
 * @category constructors
 * @public
 */
export const contract = <const S extends Spec>(spec: S): S => spec;

export { withStore } from "./Store";
export { logs, withLogExport, type LogsExportHandle } from "./internal/logs/hyperlinkLogs";
export {
  logStreamLevel,
  logStreamLevelAll,
  logStreamLevelDebug,
  logStreamLevelInfo,
  logStreamLevelWarn,
  logStreamLevelError,
  logStreamLevelNone,
} from "./internal/logs/hyperlinkStreamLevel";

/**
 * Register a {@link Node} on an app {@link Store.Service} — node-wide durable log journal
 * (match-all follower). Prefer {@link Node.logs} sugar (`WnbaNode.logs`).
 *
 * @example
 * ```ts
 * class AppStore extends Store.Service<AppStore>("@app/Store")(
 *   Hyperlink.store(WnbaNode),
 *   Daemon.store(Daily),
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
// Promise / async handle adapter (OS edge — not a Spec leaf)
// ============================================================================

/**
 * Promise-shaped view of a {@link Subscribable}: lazy `get` (fresh Promise each access) plus
 * `changes` as an `AsyncIterable`.
 *
 * @category models
 * @public
 */
export interface PromiseSubscribable<A> {
  readonly get: Promise<A>;
  readonly changes: AsyncIterable<A>;
}

/**
 * A Hyperlink service handle adapted to Promise / async — what {@link promise} returns. Every
 * `Effect` becomes a `Promise` (failures reject), every `Stream` an `AsyncIterable`, {@link ref}
 * fields become {@link PromiseSubscribable}, nested groups recurse, plain {@link value}s pass through.
 *
 * @category models
 * @public
 */
export type PromiseOf<S> = {
  readonly [K in keyof S]: S[K] extends Subscribable<infer A>
    ? PromiseSubscribable<A>
    : S[K] extends Stream.Stream<infer A, infer _E, infer _R>
      ? AsyncIterable<A>
      : S[K] extends Effect.Effect<infer A, infer _E, infer _R>
        ? Promise<A>
        : S[K] extends (...args: infer Args) => Effect.Effect<infer A, infer _E, infer _R>
          ? (...args: Args) => Promise<A>
          : S[K] extends (...args: infer Args) => Stream.Stream<infer A, infer _E, infer _R>
            ? (...args: Args) => AsyncIterable<A>
            : S[K] extends object
              ? PromiseOf<S[K]>
              : S[K];
};

/**
 * Adapt a Hyperlink **service handle** to Promise / async — the OS edge for non-Effect consumers
 * (scripts, Next handlers, TanStack `queryFn`). Not a Spec builder: wrap the handle you already
 * hold from {@link layer} / {@link client} (typically via `ManagedRuntime.runPromise(Tag)`).
 *
 * ```ts
 * const runtime = ManagedRuntime.make(Hyperlink.layer(Counter, impl))
 * const handle = await runtime.runPromise(Counter)
 * const api = Hyperlink.promise(handle)
 * await api.add(1)
 * console.log(await api.current)
 * for await (const n of api.count.changes) { … }
 * ```
 *
 * Optional `context` runs Effects / Streams that still need services (e.g. {@link Local} on a
 * local-layer handle). Default is empty context — fine for wire clients whose methods are `R = never`.
 * Failures **reject** the Promise / async iterator (no Result wrapper).
 *
 * @category adapters
 * @public
 */
export function promise<S extends object>(service: S): PromiseOf<S>;
export function promise<S extends object, R>(
  service: S,
  context: Context.Context<R>,
): PromiseOf<S>;
export function promise<S extends object, R = never>(
  service: S,
  context?: Context.Context<R>,
): PromiseOf<S> {
  return adaptPromiseHandle(
    service,
    context ?? (Context.empty() as Context.Context<R>),
  ) as PromiseOf<S>;
}

/**
 * Bind Effect-reactive **live** helpers to an `Atom.AtomRuntime`.
 *
 * Returns a function: tag+select, or an already-resolved Subscribable / Stream.
 * Live only (`ref` / `stream`) — not Effects ({@link query} / {@link fn}).
 *
 * @example
 * ```ts
 * const status = Hyperlink.atom(rt)(Jobs, (q) => q.status)
 * const metrics = Hyperlink.atom(rt)(Jobs, (q) => q.metrics.stream)
 * const fromHandle = Hyperlink.atom(rt)(handle.status)
 * ```
 *
 * @category adapters
 * @public
 */
export const atom = atomHandle.atom;

/**
 * Bind Effect-reactive **one-shot Effect** reads to an `Atom.AtomRuntime`.
 *
 * @example
 * ```ts
 * const seed = Hyperlink.query(rt)(Jobs, (q) => q.metrics.query({ limit: 50 }))
 * ```
 *
 * @category adapters
 * @public
 */
export const query = atomHandle.query;

/**
 * Bind Effect-reactive **commands** to an `Atom.AtomRuntime` (`AtomResultFn`).
 *
 * Select a bare Effect (no-arg) or `(arg) => Effect`.
 *
 * @example
 * ```ts
 * const pause = Hyperlink.fn(rt)(Jobs, (q) => q.pause)
 * const setSchedule = Hyperlink.fn(rt)(Nightly, (d) => d.setSchedule)
 * ```
 *
 * @category adapters
 * @public
 */
export const fn = atomHandle.fn;

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
    effect: Effect.Effect<unknown, never, never>,
  ) => Effect.Effect<unknown, never, never>,
): unknown => {
  if (typeof member === "function") {
    // function → Effect: same call-then-transform idiom as `Store.mapMethod`.
    return (...args: ReadonlyArray<unknown>) => transform((member as any)(...args));
  }
  // bare Effect member (e.g. a no-payload `effectFn` — `start`/`pause`): transform it directly. The
  // leaf is type-erased by the spec-driven walk, so the Effect type is asserted once here (the same
  // tree-walk/rebuild idiom as `flattenImpl` / `nestService`).
  return transform(member as any);
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
 * The generic impl-transform primitive — the Hyperlink counterpart to `Store.mapEffects`. Walk `impl`
 * **per its `spec`** ({@link flattenSpec} keys aligned onto the impl via {@link flattenImpl}) and pass each
 * **Effect method**'s returned {@link Effect} through `transform`, then re-nest ({@link nestService}). A
 * `stream: true` leaf — a {@link Hyperlink.stream} member (a {@link Stream} impl) **or** a {@link ref} field
 * (a {@link Subscribable} impl) — is left untouched, as is a {@link LocalMethod} leaf.
 *
 * `transform` is applied uniformly; whether it changes types is expressed through the result:
 * - **Type-preserving** transforms (`withSpan` / `retry`) leave the type unchanged — `Out` defaults to
 *   `Impl`.
 * - **Type-changing** transforms (stripping `R`, like {@link provideContext}) supply an explicit `Out`
 *   computed per method by a mapped type (e.g. {@link ProvidedContext}).
 *
 * @example Type-preserving — trace every HyperService method
 * ```ts
 * const traced = Hyperlink.mapEffects(impl, MyTag[Hyperlink.specSym], (e) => Effect.withSpan(e, "hyperlink"));
 * ```
 *
 * @category reactivity
 * @public
 */
export const mapEffects = <Impl, const S extends Spec, Out = Impl>(
  impl: Impl,
  spec: S,
  transform: (
    effect: Effect.Effect<unknown, never, never>,
  ) => Effect.Effect<unknown, never, never>,
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
      isDefaultMethod(leaf) ||
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
 * return Hyperlink.provideContext(impl, MyTag[Hyperlink.specSym], context);
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
    Effect.provideContext(effect as any, context) as any,
  );

/** Runtime marker for a {@link Driver} bundle. @internal */
export const driverSym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/Driver",
);

/**
 * A HyperService impl **before** worker-context discharge — the impl still carries requirement `R` on its
 * Effect methods, paired with the {@link Context.Context} captured at build time. Used by
 * {@link WorkPool}, {@link Gate}, and {@link Daemon} (any toolkit HyperService that builds
 * its driver under ambient `R`). {@link layer} / {@link serve} grant locally via {@link grantLocal};
 * {@link serveRemote} defers discharge to each wire call via {@link invokeWireMethodWithContext} so
 * one materialization backs both paths.
 *
 * @category models
 * @public
 */
export interface Driver<S extends Spec, R> {
  readonly [driverSym]: true;
  readonly impl: WithRequirement<ImplOf<S>, R>;
  readonly workerContext: Context.Context<R>;
}

/**
 * True when `u` is a {@link Driver} bundle.
 *
 * @category guards
 * @public
 */
export const isDriver = <S extends Spec = Spec, R = unknown>(
  u: unknown,
): u is Driver<S, R> => Predicate.hasProperty(u, driverSym);

/**
 * Retype through `never` (not `any`/`unknown` channels) at dynamic Effect/Rpc factories.
 * Same bridge as `internal/nodeServerCommon.retype` — kept local so this module does not
 * import server plumbing.
 */
const retype = <T>(value: never): T => value;

/**
 * Pair a pre-provide impl with the worker context captured at build time. Pass `tag` so the concrete
 * {@link Spec} `S` is pinned for {@link Driver} typing.
 *
 * @category constructors
 * @public
 */
export const driver = <Self, S extends Spec, R>(
  _tag: HyperlinkTag<Self, S>,
  impl: WithRequirement<ImplOf<S>, R>,
  workerContext: Context.Context<R>,
): Driver<S, R> => ({
  [driverSym]: true as const,
  impl,
  workerContext,
});

/**
 * Discharge a {@link Driver}'s captured worker context into every Effect method — yields the
 * `R`-free {@link ImplOf} shape for {@link layer} / the local grant in {@link serve}.
 *
 * @category constructors
 * @public
 */
export const grantLocal = <Self, S extends Spec, R>(
  tag: HyperlinkTag<Self, S>,
  built: Driver<S, R>,
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
 * pause: Hyperlink.effect(Schema.Void).annotate({ description: "Pause." }),
 * clear: Hyperlink.effect(Schema.Number).annotate({ destructive: true }),
 * enqueue: Hyperlink.effectFn({ item: Item }),
 * enqueue: Hyperlink.effectFn({ payload: { item: Item }, success: Schema.Void, error: Full }),
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
 * add: Hyperlink.unsafeEffectFn<{
 *   (item: Hyperlink.Decoded<typeof itemSchema>): Effect.Effect<void>
 *   (items: readonly Hyperlink.Decoded<typeof itemSchema>[]): Effect.Effect<void>
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
 * arguments `(first, second?)` — used by priority-queue `add(item, lane?)`.
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
 * `--watch`, or a TUI from it. Conventionally named `changes` when it carries a HyperService's
 * whole observable state (a snapshot stream); back it with a `SubscriptionRef`'s `.changes`.
 *
 * Counts as a `query` for tools (an idempotent read). `success` is the **element** schema and
 * `error` (if any) is the **stream error** schema; both must be encodable (they cross RPC).
 * `payload` is a single **schema** or struct **fields** — same as Effect's `Rpc.make`.
 *
 * ```ts
 * changes: Hyperlink.stream(QueueSnapshot).annotate({ description: "Live queue state." }),
 * tail: Hyperlink.stream(LogLine, { payload: Schema.Struct({ since: Schema.Number }) }),
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
 * method ({@link Hyperlink.stream}) is a **`Stream`**. Either is a **property** when there is
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
 * ({@link Local}) (so they're uncallable through {@link Hyperlink.client}).
 *
 * @category models
 * @public
 */
// NOTE on the gates below: branch on brands (`LocalMethod` / `DefaultMethod` / `_tag`) before the
// wire `kind` check — brand checks are schema-independent. An old `: S[K] extends AnyMethod`
// else-gate dragged payload schemas into the conditional and deferred the whole type under a
// free type parameter (e.g. a factory generic over the item schema).
export type ServiceOf<S extends Spec, Self = unknown> = Simplify<{
  readonly [K in keyof S]: S[K] extends FromLocalMethod<infer M>
    ? InjectLocal<M, Self> // interface-Tag local: interface-shaped, gains `Local`
    : S[K] extends LocalMethod<infer T>
    ? LocalEffect<T, never, Self>
    : S[K] extends DefaultMethod<infer F>
      ? F // Tag-baked default — identical local and remote
      : S[K] extends { readonly _tag: "value" }
        ? SuccessOf<AsMethod<S[K]>>
        : S[K] extends { readonly _tag: "ref" }
          ? Subscribable<SuccessOf<AsMethod<S[K]>>>
          : S[K] extends { readonly kind: MethodKind } // leaf (F-independent; reconstruct via AsMethod)
            ? ClientMethod<AsMethod<S[K]>, ClientOverrideOf<S[K]>> // client handle → override or derived
            : S[K] extends Spec
              ? ServiceOf<S[K], Self> // nested group → nested service
              : never;
}>;

/**
 * Union of every {@link value} leaf's error type in `S` — fails **layer / client acquire**
 * (all-or-nothing). Empty/`never` when the spec has no fallible materialize fields. An `any` /
 * `unknown` spec (erased toolkit boundaries) contributes `never` so it cannot poison Layer `E`.
 *
 * @category models
 * @public
 */
export type ValueErrorsOf<S extends Spec> = unknown extends S
  ? never
  : {
      [K in keyof S]: S[K] extends { readonly _tag: "value" }
        ? ErrorOf<AsMethod<S[K]>>
        : S[K] extends Spec
          ? ValueErrorsOf<S[K]>
          : never;
    }[keyof S];

// ── Tag<Self, I>(): an existing service interface as the source of truth ─────────────────────────

/**
 * Inject the {@link Local} capability into a service member's requirement channel — how a
 * {@link Tag}`<Self, I>()` local member surfaces. An `Effect`/`Stream`-returning member (or a function
 * to one) keeps its shape and gains `Local<Self>` in its requirements; any other value is obtained via
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
  readonly [localNeedsTypeSym]: `Hyperlink.local at '${K & string}' has no type — add '${K &
    string}' to the service interface, or use local<T>()`;
}

/**
 * Validate a {@link Tag}`<Self, I>()` contract `C` against its service interface `I`: a **bare**
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

/** The error surface a wired {@link Tag}`<Self, I>()` member resolves to when its success schema
 *  disagrees with the service interface at that key — rejected at the call, naming the key. @public
 *
 * @category models
 */
export interface WireMismatch<K extends PropertyKey> {
  readonly [wireMismatchSym]: `Hyperlink.Tag: wired member '${K &
    string}' — its success type disagrees with the service interface`;
}

/**
 * Reject **bare** {@link local} members in a plain {@link Tag}`<Self>()` contract — bare locals need
 * {@link Tag}`<Self, I>()` so the interface can supply their type.
 *
 * @category models
 * @public
 */
export type RejectBareLocal<C> = {
  readonly [K in keyof C]: C[K] extends BareLocal
    ? LocalNeedsType<K>
    : C[K] extends Spec
      ? RejectBareLocal<C[K]>
      : C[K];
};

/** @internal */
declare const fromLocalSym: unique symbol;

/**
 * An interface-Tag local member as it sits in the **resolved** spec: a {@link LocalMethod} that
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
 * Resolve a {@link Tag}`<Self, I>()` contract `C` into a runnable {@link Spec}: each **bare**
 * {@link local} becomes a {@link FromLocalMethod} carrying the service interface's type at that key, so
 * the impl ({@link ImplOf}) and service ({@link ServiceOf}) both derive from `I`. Wired methods and
 * explicit `local<T>()`s pass through unchanged. @public
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
  readonly [K in keyof S as S[K] extends AnyLocalMethod | AnyDefaultMethod ? never : K]: S[K] extends {
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
    : S[K] extends AnyLocalMethod | AnyDefaultMethod
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
 * build, provide it via the **`Effect` form** of {@link Hyperlink.layer} / {@link Hyperlink.serve}
 * — resolve it once, and the members close over it.
 *
 * A {@link value} field's impl is the `Effect<A, E>` resolved once at acquire — that differs from how
 * it *surfaces* in {@link ServiceOf} (a plain `A`), so annotate an impl with `ImplOf`, not
 * `ServiceOf`. A {@link ref}'s impl is the {@link Subscribable} (not the consumer shape alone).
 * {@link default} members are Tag-baked — omitted from the impl. A nested group that is *only*
 * `default` members still appears as `{}` (pass an empty object). Piped {@link defaults} keys may
 * be overridden via {@link ImplWithDefaultOverrides}.
 *
 * @category models
 * @public
 */
export type ImplOf<S extends Spec> = {
  readonly [K in keyof S as S[K] extends AnyDefaultMethod ? never : K]: S[K] extends FromLocalMethod<
    infer M
  >
    ? M // interface-Tag local: the impl provides the interface member itself
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
 * Impl for {@link layer} / {@link serve}: wire {@link ImplOf} plus optional overrides for
 * Spec {@link default} leaves and piped {@link defaults} bag keys (extra keys are
 * structural — Spec leaf values stay precise via excess-property checks on known keys
 * when inlined at the call site).
 *
 * Overrides apply at the **provide site only** (local handle / co-located serve grant).
 * Clients always install Tag-baked Spec defaults + the piped bag — they do not see the
 * server's override. Use {@link Layer.updateService} for post-hoc local patches.
 *
 * @category models
 * @public
 */
export type ImplWithDefaultOverrides<S extends Spec> = ImplOf<S> & Partial<DefaultsBag>;

/**
 * Recover the (possibly nested) {@link Spec} a tag was built from — for annotating an extracted impl
 * without hand-threading it: `obj satisfies ImplOf<SpecOf<typeof MyTag>>`. Usually you don't need it —
 * {@link Hyperlink.make} infers it. @public
 * @category models
 */
export type SpecOf<T> = T extends { readonly [specTypeSym]?: infer S extends Spec }
  ? S
  : never;

/**
 * Anchor a **reusable** impl to its contract at the definition site. Inline impls are already typed by
 * `layer` / `serve`; but the moment you hoist one to a `const` (to share it across the
 * local layer and a served entry, or across several serves) it loses that typing — the mistake then
 * surfaces far away at the serve call, with no autocomplete as you write it. `Hyperlink.make(tag, impl)`
 * infers the tag's spec and constrains `impl` to {@link ImplWithDefaultOverrides}, returning it typed.
 * Runtime identity.
 *
 * ```ts
 * const scoresImpl = Hyperlink.make(ScoresDb, { read: … }); // typed here — autocomplete + errors at the def
 * Hyperlink.layer(ScoresDb, scoresImpl);                    // local
 * Node.httpServer([Hyperlink.serve(ScoresDb, scoresImpl)]); // served — same impl, both typed
 * ```
 *
 * @category constructors
 * @public
 */
export function make<Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
  impl: ImplWithDefaultOverrides<S>,
): ImplWithDefaultOverrides<S>;
export function make<Self, S extends Spec, R>(
  tag: HyperlinkTag<Self, S>,
  impl: Effect.Effect<ImplWithDefaultOverrides<S>, never, R>,
): Effect.Effect<ImplWithDefaultOverrides<S>, never, R>;
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
    : S[K] extends AnyLocalMethod | AnyDefaultMethod
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
 * The wire tag of a method on the shared transport: the HyperService's **wire key** prefixes
 * the bare method name (`@app/Mail/pause`, `hyperlink-ts/WorkPool/sizes`). Solo tags use
 * {@link HyperlinkTag.key}; shared-Spec families use the family's wire key. The prefix
 * namespaces procedures on one `RpcServer` — a transport detail, never part of the logical
 * contract (`yield* Tag` stays the bare method name).
 */
/** @internal */
export const wireTag = (wireKey: string, method: string): string => `${wireKey}/${method}`;

/**
 * Build the shared RPC contract group from a {@link Spec}, namespaced by `wireKey`. A bare
 * `Schema` becomes a payload-free rpc returning that schema; a descriptor maps straight to
 * its parts. Every procedure's wire tag is {@link wireTag}-prefixed by `wireKey`.
 *
 * @internal
 */
export const buildRpcGroup = (
  wireKey: string,
  spec: FlatSpec,
): RpcGroup.RpcGroup<any> => {
  const rpcs = Object.entries(spec).flatMap(([method, m]) => {
    // local / default members are off-wire — they get no rpc.
    if (isLocalMethod(m) || isDefaultMethod(m)) return [];
    const tag = wireTag(wireKey, method);
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
 * the public {@link HyperlinkTag} type is nameable across modules.
 *
 * @internal
 */
export const specSym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/spec",
);
/**
 * Phantom carrier of a tag's (possibly nested) spec type `S`, so functions can **infer** `S` from a tag —
 * {@link specSym} holds the *flat* spec at runtime and can't carry the nested `S`. Type-only, never set at
 * runtime. @internal
 */
declare const specTypeSym: unique symbol;
/** Where the built RPC group is stowed on a Tag. @internal */
export const groupSym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/group",
);
/**
 * Where the **wire key** (RpcGroup prefix) is stowed on a Tag. Solo {@link Tag}s use the
 * same string as {@link Context.Key.key}; shared-Spec instances use the factory wire key.
 * Read with {@link wireKeyOf}.
 *
 * @internal
 */
export const wireKeySym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/wireKey",
);
/**
 * Marks a tag minted by {@link Tag}`(wireKey, spec)` — wire prefix is the shared key;
 * {@link serve} / {@link client} route by the instance `.key` header.
 *
 * @internal
 */
export const sharedTagSym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/sharedTag",
);
/** Where the per-HyperService local-capability key is stowed on a Tag. @internal */
export const localCapSym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/localCap",
);
/** Marks a tag built by {@link Tag}`<Self, I>()` whose contract used bare {@link local} — its local
 *  members are interface-shaped (the impl's own `Effect`/function, requiring {@link Local}), so
 *  {@link buildLocalContext} passes them through with the cap rather than wrapping a raw value.
 *  Absent on plain {@link Tag}`<Self>()` tags. @internal */
export const interfaceLocalsSym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/interfaceLocals",
);
/** Where a contract's **kind** (its canonical id, e.g. `hyperlink-ts/WorkPool`) is
 *  stowed on a Tag — set by each contract's `.Tag` factory so consumers (the dashboard) can
 *  classify a tag without sniffing its spec. Absent on a bare {@link Hyperlink.Tag}. @internal */
export const kindSym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/kind",
);
/** Where a HyperService's **readiness derivation** (status → ready) is stowed on a Tag — a sibling of
 *  {@link kindSym}, applied by {@link withReadiness}. Absent ⇒ the HyperService is ready by default.
 *  @internal */
export const readinessSym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/readiness",
);
/** Where the HyperService's {@link Node} (if any) is stowed on a Tag. @internal */
export const nodeSym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/node",
);

/** Marks a Tag as identity-claiming ({@link identity} pipe) — layer/serve claim at Lookup first. @internal */
export const identitySym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/identity",
);

// ── readiness: a derived view of a HyperService's status, aggregated into node /health + handle status ──

/**
 * A HyperService's readiness — derived from its own status (its single source of truth), aggregated
 * into a node's `/health` and `(yield* node).status`. `ready: false` with a `detail` says *why*
 * (surfaced in the `/health` body and the dashboard health board).
 *
 * @category models
 * @public
 */
export interface Readiness {
  readonly ready: boolean;
  readonly detail?: string;
}

/**
 * Derive {@link Readiness} from a HyperService's materialized service — read its status, don't store new
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
  // The derivation may depend on services (e.g. `Hyperlink.readinessOf(Database)`); that requirement
  // is satisfied by the serve context the node runs readiness in, and erased at this storage seam.
) => Effect.Effect<Readiness, never, any>;

// ── node: the transport for a HyperService, carried in the Tag ──

// [extracted to Node module — was Hyperlink.ts:1764-1845]

/** Phantom brand for the per-HyperService {@link peers} capability, so distinct HyperServices' peer sets
 *  don't collide in one context. @internal */
export interface PeersId<Self> {
  readonly _peers: Self;
}

/** Phantom brand for the per-HyperService {@link selfNode} capability (which node this instance runs as),
 *  so distinct HyperServices' self-node identities don't collide in one context. @internal */
export interface SelfNodeId<Self> {
  readonly _selfNode: Self;
}

/** Holds a tag's `distributed` set (the fleet). @internal */
const nodesSym: unique symbol = Symbol.for("hyperlink-ts/Hyperlink/distributed");

/** Holds a tag's per-HyperService {@link peers} capability key. @internal */
const peersSym: unique symbol = Symbol.for("hyperlink-ts/Hyperlink/peers");

/** Holds a tag's per-HyperService {@link selfNode} capability key. @internal */
const selfNodeSym: unique symbol = Symbol.for("hyperlink-ts/Hyperlink/selfNode");

/**
 * The type of a HyperService tag carrying spec `S` — what {@link Hyperlink.Tag} produces
 * (and what you extend). Lets a consumer write
 * `<S extends Spec>(tag: HyperlinkTag<Self, S>)` and read the spec through named types
 * ({@link specOf} / {@link groupOf}) instead of a `Parameters<typeof specOf>` workaround.
 *
 * @category models
 * @public
 */
export interface HyperlinkTag<Self, S extends Spec, Svc = ServiceOf<S, Self>>
  extends Context.ServiceClass<Self, string, Svc> {
  /** Wire prefix — namespaces this HyperService's procedures on a shared `RpcServer`. */
  readonly [wireKeySym]: string;
  /** Hyperlink-level help text (CLI/TUI section help, dashboard panel title) — if declared. */
  readonly description: string | undefined;
  readonly [specSym]: FlatSpec;
  readonly [specTypeSym]?: S;
  readonly [groupSym]: RpcGroupOf<S>;
  readonly [localCapSym]: Context.Key<
    Local<Self>,
    { readonly granted: true }
  >;
  /**
   * The HyperService's {@link Node} (its transport), or `undefined` for a nodeless tag. Uniform
   * across all tags (always present) so a node-bearing tag stays assignable wherever a plain
   * {@link HyperlinkTag} is expected; the node-bearing tag constructors **narrow** this to a
   * concrete {@link NodeKey} in their return type, which is how {@link Hyperlink.client}
   * discriminates the node-aware path.
   */
  readonly [nodeSym]: NodeKey<unknown> | undefined;
  /** The contract's kind (canonical id) — set by a contract `.Tag` factory, `undefined` for a bare
   *  {@link Hyperlink.Tag}. Read it with {@link kindOf}. */
  readonly [kindSym]: string | undefined;
  /** The HyperService's readiness derivation, if any (applied by {@link withReadiness}); `undefined`
   *  ⇒ ready by default. Read it via {@link readinessCheck}. */
  readonly [readinessSym]: ReadinessOf<ServiceOf<S, Self>> | undefined;
  /** The per-HyperService {@link peers} capability key — its value is this HyperService's peer clients
   *  (the other nodes' leaf services), keyed by node. Provided by {@link peersLayer}, read via {@link peers}. */
  readonly [peersSym]: Context.Key<PeersId<Self>, Record<string, PeerServiceOf<S>>>;
  /** The per-HyperService {@link selfNode} capability key — its value is the node key this instance runs
   *  as (the same key its peers are keyed by). Provided by {@link peersLayer} / {@link selfNodeLayer},
   *  read via {@link selfNode}. */
  readonly [selfNodeSym]: Context.Key<SelfNodeId<Self>, string>;
  /** The Node set (C1), if declared via {@link nodes} / `{ node }` / {@link distributed}; else `undefined`. */
  readonly [nodesSym]?: ReadonlyArray<AnyNode>;
  /** Set when the tag was piped through {@link identity} — layer/serve claim at Lookup first. */
  readonly [identitySym]?: true;
}

/**
 * Identity-claiming HyperServices need Lookup's Identity client **and** a dialable Node —
 * Tag-bound (`nodes` / `{ node }`) and/or the {@link ListenNode} from {@link Node.unix} /
 * {@link Node.http} / {@link Node.ws} (including minted address-less Nodes).
 *
 * Remediation: (1) `Layer.provide(Lookup.client / layer / layerOptions)` on the listen or
 * resource layer; (2) give the Tag a dialable self via protocol listen or
 * {@link nodes}`([Node])`. Recipe: `docs/guides/identity-coordinator.md`.
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
      `(Node.unix/http/ws listen or Hyperlink.nodes([Node])). ` +
      `Pipe Layer.provide(Lookup.client) / Lookup.layer / Lookup.layerOptions.`
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

// [extracted to Node module — was Hyperlink.ts:1936-1951]

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

// [extracted to Node module — was Hyperlink.ts:1985-1994]

/** Throw when an identity Tag would carry more than one fleet Node. @internal */
const assertIdentityNodeCount = (
  tag: { readonly key: string },
  nodes: ReadonlyArray<AnyNode>,
): void => {
  if (nodes.length > 1) {
    throw new IdentityMultiNode({ tag: tag.key, nodeCount: nodes.length });
  }
};

/** A HyperService tag identifier — {@link Context.Service} tags carry `Service` and `Spec`. @internal */
type TagIdentifier = { readonly Service: unknown };

/** Spec carried by tag identifier `T`. @internal */
type SpecOfTag<T> = T extends HyperlinkTag<any, infer S extends Spec> ? S : SpecOf<T>;

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
 * Materialized service shape for tag `T` — `Hyperlink.Shape<Test>` ≡ `Test["Service"]`.
 *
 * @category models
 * @public
 */
export type Shape<T extends TagIdentifier> = T["Service"];

/**
 * Materialized service shape from a {@link Spec} — `Hyperlink.ShapeOf<typeof mySpec, MyTag>`.
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
 * readable hovers: `Hyperlink.Hyperlink<typeof mySpec>`. Tag form: {@link Of | `Hyperlink.Of<Test>`}.
 *
 * `Self` is the tag identifier (requirement channel); omit it when declaring against a spec only.
 * Extra requirements beyond the tag go in `R`.
 *
 * @example
 * ```ts
 * const spec = { current: Hyperlink.effect(Schema.Number) } as const;
 * type Acquire = Hyperlink.Hyperlink<typeof spec>;
 *
 * class Counter extends Hyperlink.Tag<Counter>()("@app/Counter", spec) {}
 * type AcquireTag = Hyperlink.Of<Counter>;
 * ```
 *
 * @category models
 * @public
 */
export type Hyperlink<
  S extends Spec,
  E = never,
  R = never,
  Self = unknown,
> = Effect.Effect<ServiceOf<S, Self>, E, Self | R>;

/**
 * `yield* Tag` inferred from the tag identifier — `Hyperlink.Of<Counter>`.
 *
 * @category models
 * @public
 */
export type Of<T extends TagIdentifier, E = never, R = never> = Effect.Effect<T["Service"], E, T | R>;

/**
 * Hyperlink types — use {@link Hyperlink.Hyperlink} like {@link Effect.Effect | `Effect.Effect`}.
 *
 * @public
 */
export declare namespace Hyperlink {
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
  export type Hyperlink<
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
 * A {@link HyperlinkTag} bound to a concrete {@link Node} — its `[nodeSym]` narrowed to that node's
 * `NodeKey<HSelf>`, which is how {@link Hyperlink.client} discriminates the node-aware path. Returned
 * by the node-bearing tag constructors. It's a **named** type (not an inline `& { [nodeSym] }`) so a
 * consumer can `export` a node-bearing tag without leaking the internal symbol (TS4020).
 *
 * @category models
 * @public
 */
export interface NodeBoundTag<Self, S extends Spec, HSelf, Svc = ServiceOf<S, Self>>
  extends HyperlinkTag<Self, S, Svc> {
  readonly [nodeSym]: NodeKey<HSelf>;
}

/** The kind stamped on a bare {@link Hyperlink.Tag} that declares none — every HyperService tag carries a
 *  kind, and a plain HyperService's is this. The typed factories stamp their own (e.g.
 *  `hyperlink-ts/WorkPool`); a bare tag defaults to this so nothing is ever kind-less.
 *
 * @category nodes & fleet
 * @public
 */
export const kind = "hyperlink-ts/Hyperlink";

/** The contract kind a tag was built for (e.g. `hyperlink-ts/WorkPool`, or {@link kind}
 *  for a bare {@link Hyperlink.Tag}); `undefined` only for a non-tag. The robust replacement for
 *  sniffing a tag's spec; accepts `unknown` so a `Group` member can be passed straight in. */
export const kindOf = (tag: unknown): string | undefined => {
  // A HyperService tag is a class (so `typeof` is "function"), with the kind stamped as a static.
  if ((typeof tag === "object" || typeof tag === "function") && tag !== null && kindSym in tag) {
    const value = tag[kindSym];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
};

/**
 * F4 wire-contract fingerprint for a HyperService tag — same value the server stamps on
 * `Node.Status.services[].contractHash` at serve. Compare via
 * {@link verifyConnection}`({ deep: true, serviceKey, contractHash })`.
 *
 * @category introspection
 * @public
 */
export const contractHash = <Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
): string => hashContract(tag[wireKeySym], kindOf(tag) ?? "hyperlink", tag[specSym]);

/**
 * A tag's **wire key** — the RpcGroup / procedure prefix on a shared server.
 *
 * Solo {@link Tag}: same as {@link Context.Key.key}. Shared-Spec instance
 * (`Tag(wireKey, spec)` factory): the factory wire key (kind key).
 *
 * @category introspection
 * @public
 */
export const wireKeyOf = (tag: { readonly [wireKeySym]: string }): string =>
  tag[wireKeySym];

/**
 * True when `tag` was minted by a shared-Spec {@link Tag}`(wireKey, spec)` factory.
 *
 * @category introspection
 * @internal
 */
export const isSharedTag = (tag: unknown): boolean =>
  (typeof tag === "object" || typeof tag === "function") &&
  tag !== null &&
  sharedTagSym in tag;

/** The {@link Node} a tag is bound to (its transport key), or `undefined` for a nodeless/bare tag
 *  or any non-tag. Accepts `unknown` so a `Group` member passes straight in — walk a group tree and
 *  collect the distinct nodes to know which nodes back its services. */
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
 * kind. A structural read (like {@link kindOf}) — the server uses it to reject a node-bound HyperService
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

/** A structural bound matching any HyperService tag (bare or node-bound) by its spec brand — deliberately
 *  WITHOUT the tag's `Svc` type param. A data-last combinator (`.pipe(withReadiness(...))`,
 *  `.pipe(distributed(...))`) uses it so unifying/constraining the piped tag never expands a
 *  node-bound self-referential class's service default (`ServiceOf<S, Self>`), which stock tsc caps
 *  out on as "excessively deep" (tsgo tolerates it). `T` is still inferred as the full concrete tag,
 *  so the `(tag: T) => T` return preserves it exactly.
 *
 *  **Rule:** any new `Fn.dual` data-last combinator that accepts a HyperService tag in a class
 *  `extends … .pipe(…)` position must constrain `T` with this brand (or an equivalent non-`Svc`
 *  shape) — never `HyperlinkTag | NodeBoundTag`, which reopens TS2589 under stock tsc.
 *
 *  @internal */
/** @internal */
export type PipeableTag = { readonly [specSym]: FlatSpec };

/**
 * Attach a {@link Readiness} derivation to a tag — the seam the node's `/health` and handle
 * `.status` aggregate over. Each contract applies it from its own status (so readiness can't drift
 * from status); a bare {@link Hyperlink.Tag} can opt in the same way. Dual (data-first or `.pipe`):
 *
 * ```ts
 * class EdgeCache extends Hyperlink.Tag<EdgeCache>()("edge/Cache", {
 *   warm: Hyperlink.effect(Schema.Boolean),
 * }).pipe(
 *   Hyperlink.withReadiness((svc) =>
 *     Effect.map(svc.warm, (warm) => ({ ready: warm, ...(warm ? {} : { detail: "cold" }) })),
 *   ),
 * ) {}
 * ```
 *
 * @category spec fields
 * @public
 */
export const withReadiness: {
  // Data-last: `T extends PipeableTag` (shallow) — do not constrain against HyperlinkTag|NodeBoundTag
  // or stock tsc TS2589s on node-bound `class extends Tag()(…).pipe(withReadiness(…))` (expands Svc).
  // Readiness `svc` is still `ServiceOf<S, any>` from the inferred tag; Self is widened so class
  // `extends` does not recurse on the declaring type — see test/hyperlink-withreadiness-pipe.test-d.ts.
  //
  // data-last (pipe): `tag.pipe(Hyperlink.withReadiness(fn))` — service type derived from the piped tag.
  <T extends PipeableTag>(
    readiness: ReadinessOf<
      T extends HyperlinkTag<any, infer S extends Spec> ? ServiceOf<S, any> : never
    >,
  ): (tag: T) => T;
  // data-first: `Hyperlink.withReadiness(tag, fn)` — full `ServiceOf<S, Self>` (contracts use this).
  // Two **inferred** overloads (not a fixed `<any,any>` union) so a fully-defined *class* — a
  // `typeof X` constructor — is accepted, the way `client`/`layer` accept one; node-bound first so a
  // node-bound tag keeps its node in the return.
  <Self, S extends Spec, HSelf>(
    tag: NodeBoundTag<Self, S, HSelf>,
    readiness: ReadinessOf<ServiceOf<S, Self>>,
  ): NodeBoundTag<Self, S, HSelf>;
  <Self, S extends Spec>(
    tag: HyperlinkTag<Self, S>,
    readiness: ReadinessOf<ServiceOf<S, Self>>,
  ): HyperlinkTag<Self, S>;
} = Fn.dual(
  2,
  <T extends HyperlinkTag<any, any, any>>(tag: T, readiness: ReadinessOf<unknown>): T => {
    // Stack onto any readiness already on the tag (e.g. a contract factory's own check): the new
    // derivation receives the prior one (applied to the same service) as `base`, so it can extend
    // it (`yield* base`) or replace it (ignore `base`). `base` flows down the chain from the root.
    const prior = tag[readinessSym];
    const composed = (service: unknown, base: Effect.Effect<Readiness, never, never>) =>
      readiness(service, prior === undefined ? base : (prior as any)(service, base)) as any;
    return Object.assign(tag, { [readinessSym]: composed }) as T;
  },
);

/** Opt-in handoff recipe stowed on a served entry / shared instance (Locked #39). @internal */
export type ServedHandoff = {
  readonly tag: unknown;
  readonly wireImpl: unknown;
  readonly handoff: HandoffFn;
};

/** Build a {@link ServedHyperlink}.handoff entry from a serve-site handoff fn + wire impl. @internal */
const servedHandoff = (
  tag: unknown,
  wireImpl: unknown,
  handoff: HandoffFn | undefined,
): ServedHandoff | undefined => {
  if (handoff === undefined) return undefined;
  return { tag, wireImpl, handoff };
};

/** Resolved {@link serve} third-arg options (AnyNode sugar already normalized to `{ node }`). @internal */
type ResolvedServeOptions = {
  readonly node?: AnyNode;
  readonly handoff?: HandoffFn;
};

/** True when a {@link serve} third argument is an {@link AnyNode} (sugar) rather than a {@link ServeOptions}
 *  bag — a node carries a `.key` + `.kind`; the options bag carries `handoff` / `node`. @internal */
const isServeNodeArg = (
  value: AnyNode | ServeOptions | undefined,
): value is AnyNode =>
  value !== undefined &&
  isAddressedNode(value as AnyNode) === false &&
  Predicate.hasProperty(value, "key") &&
  Predicate.hasProperty(value, "kind") &&
  !Predicate.hasProperty(value, "handoff");

/** Normalize {@link serve}'s third argument (AnyNode sugar OR {@link ServeOptions} bag). @internal */
const resolveServeOptions = (
  third: AnyNode | ServeOptions | undefined,
): ResolvedServeOptions | undefined => {
  if (third === undefined) return undefined;
  if (isServeNodeArg(third)) return { node: third };
  // An addressed node passed directly is still node sugar; otherwise it's the options bag.
  if (
    isAddressedNode(third as AnyNode) &&
    !Predicate.hasProperty(third, "handoff")
  ) {
    return { node: third as AnyNode };
  }
  const bag = third as ServeOptions;
  return {
    ...(bag.node !== undefined ? { node: bag.node } : {}),
    ...(bag.handoff !== undefined ? { handoff: bag.handoff } : {}),
  };
};

/** {@link nodeKindsOf} for an {@link AnyNode} value directly (serve-site `{ node }` override). @internal */
const nodeKindsOfNode = (node: AnyNode): ReadonlyArray<ProtocolKind> => {
  const kinds: Array<ProtocolKind> = [];
  if (Predicate.hasProperty(node, "endpoints")) {
    const ep = node.endpoints;
    if (Predicate.hasProperty(ep, "Http")) kinds.push("Http");
    if (Predicate.hasProperty(ep, "WebSocket")) kinds.push("WebSocket");
    if (Predicate.hasProperty(ep, "IpcSocket")) kinds.push("IpcSocket");
  }
  if (kinds.length > 0) return kinds;
  if (Predicate.hasProperty(node, "kind")) {
    const k = node.kind;
    if (k === "Http" || k === "WebSocket" || k === "IpcSocket") return [k];
  }
  return [];
};

/** Same dial target? (exclude self during peer pick — by dial, not by nodeKey; Locked #39 #7). */
const sameHandoffDial = (
  a: {
    readonly kind: string;
    readonly path?: string;
    readonly url?: string;
  },
  b: {
    readonly kind: string;
    readonly path?: string;
    readonly url?: string;
  },
): boolean => a.kind === b.kind && a.path === b.path && a.url === b.url;

/**
 * Dial the handoff `to` peer for a served HyperService — the Directory row for `wireKey` that is
 * **not** this node (excluded by dial, so a same-`nodeKey` A→B replacement still finds the incoming
 * row). `None` when there's no Directory, no other row, or no dialable address (⇒ the runner defers,
 * Locked #39 #10). The peer client is scoped by the caller ({@link runHandoffFunction}).
 */
const dialHandoffPeer = (
  tag: unknown,
  wireKey: string,
  selfDial: {
    readonly kind: ProtocolKind;
    readonly path?: string;
    readonly url?: string;
  },
): Effect.Effect<Option.Option<unknown>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const Lookup = yield* Effect.promise(() => import("./Lookup"));
    const dirOpt = yield* Effect.serviceOption(Lookup.Directory);
    if (Option.isNone(dirOpt)) return Option.none();
    const rows = yield* dirOpt.value.nodesServing(
      new Lookup.NodesServingRequest({ serviceKey: wireKey }),
    );
    const peer = rows.find((row) => !sameHandoffDial(selfDial, row));
    if (peer === undefined) return Option.none();
    if (peer.path === undefined && peer.url === undefined) return Option.none();
    // buildPeerClientAt is defined later in this module; runtime call is after init.
    const dial = retype<
      (
        peerTag: unknown,
        target: {
          readonly key: string;
          readonly kind?: ProtocolKind;
          readonly url?: string;
          readonly path?: string;
        },
      ) => Effect.Effect<unknown, never, Scope.Scope>
    >(buildPeerClientAt as never);
    const client = yield* dial(tag, {
      key: peer.nodeKey,
      kind: peer.kind,
      ...(peer.path !== undefined ? { path: peer.path } : {}),
      ...(peer.url !== undefined ? { url: peer.url } : {}),
    });
    return Option.some(client);
  });

const materializeHandoffRun = (
  entry: ServedHandoff,
  wireKey: string,
  selfDial:
    | {
        readonly kind: ProtocolKind;
        readonly path?: string;
        readonly url?: string;
      }
    | undefined,
): Effect.Effect<void, HandoffDeferred> =>
  runHandoffFunction({
    handoff: entry.handoff,
    from: entry.wireImpl,
    serviceKey: wireKey,
    // No advertise membership ⇒ no self dial ⇒ we can't exclude self ⇒ treat as no peer (defer, #10).
    dialPeer:
      selfDial === undefined
        ? Effect.succeed(Option.none())
        : dialHandoffPeer(entry.tag, wireKey, selfDial),
  });

/**
 * Package-private — used by protocol listen servers when wiring {@link Node.shutdown} (Locked #39 #7).
 * Runs every served HyperService's handoff (solo entries + shared-Spec instance handoffs for the same
 * wire keys) on the OUTGOING node after drain: dials the Directory peer (self excluded by dial) and
 * runs `handoff(from, to, ctx)`. Fails with the first {@link HandoffDeferred} when any HyperService
 * defers (no peer / `ctx.defer` / retry-exhausted / failure), so the shutdown caller can stay running.
 *
 * Pass `selfDial` from advertise membership so the peer can be Directory-found; omit ⇒ every handoff
 * defers (no peer).
 *
 * @internal
 */
export const runServedHandoffs = (
  entries: ReadonlyArray<ServedHyperlink>,
  options?: {
    readonly selfDial?: {
      readonly kind: ProtocolKind;
      readonly path?: string;
      readonly url?: string;
    };
  },
): Effect.Effect<void, HandoffDeferred> => {
  const selfDial = options?.selfDial;
  const runs: Array<Effect.Effect<void, HandoffDeferred>> = [];
  for (const entry of entries) {
    if (entry.handoff !== undefined) {
      runs.push(materializeHandoffRun(entry.handoff, entry.wireKey, selfDial));
    }
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.wireKey)) continue;
    seen.add(entry.wireKey);
    const state = sharedWireStates.get(entry.wireKey);
    if (state === undefined) continue;
    for (const handoff of state.handoffs) {
      runs.push(materializeHandoffRun(handoff, entry.wireKey, selfDial));
    }
  }
  if (runs.length === 0) return Effect.void;
  // Run all handoffs, then fail with the first deferral (if any). We let the successful transfers
  // finish rather than fail-fast-interrupt mid-transfer; the node stays up on any deferral.
  return Effect.gen(function* () {
    const exits = yield* Effect.forEach(runs, (run) => Effect.exit(run), {
      concurrency: "unbounded",
    });
    for (const exit of exits) {
      if (Exit.isFailure(exit)) {
        return yield* Effect.failCause(exit.cause);
      }
    }
  });
};

/**
 * Run a tag's readiness derivation against its built service. A tag that declares none is **ready by
 * default**, so an unaware or bare HyperService never falsely fails a node's readiness gate. Accepts
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
 * Readiness for a **served** resource, where all we have is the wire `impl` (a {@link value} field is
 * an `Effect` resolved once). Resolve materialize fields to plain values first — so the derivation sees
 * the same service shape {@link readinessOf} gives it (the materialized service), not the raw wire
 * impl. @internal
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
      if (isValueMethod(m)) {
        setPath(view, key, yield* (flat[key] as Effect.Effect<unknown>));
      } else {
        // ref → its Subscribable (the readiness derivation reads `.get` itself); other wire members as-is
        setPath(view, key, flat[key]);
      }
    }
    return yield* readinessCheck(tag, view);
  });

/**
 * Pull a HyperService's readiness **by tag** — yields its service and runs its derivation. Use it inside
 * another HyperService's {@link withReadiness} to make readiness *depend on* a HyperService it depends on:
 * `yield* Hyperlink.readinessOf(Database)`. The dependency lands in the readiness Effect's
 * requirements, so it's **compile-time checked**, and it works local *or* remote (it re-derives from
 * the dependency's served status).
 */
export const readinessOf = <Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
): Effect.Effect<Readiness, never, Self> =>
  Effect.flatMap(tag, (service) => readinessCheck(tag, service));

/**
 * Combine readiness checks with **AND**: ready iff all are ready, else the first not-ready one (with
 * its detail). Sugar for extending a base with dependency checks:
 * `withReadiness((svc, base) => Hyperlink.allReady([base, Hyperlink.readinessOf(Database)]))`.
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
 * {@link Hyperlink.Tag}; attach `readiness` with {@link withReadiness}.
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
 * plain {@link Hyperlink.Tag} shape — **not** a new resource kind.
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
 * const { spec, readiness } = Hyperlink.monitoredDependency({
 *   status: DbStatus,
 *   changes: DbStatus,
 *   readyWhen: (s) => s.connected,
 *   detail: (s) => `${s.latencyMs}ms`,
 * })
 *
 * export class WnbaDatabase extends Hyperlink.withReadiness(
 *   Hyperlink.Tag<WnbaDatabase>()("@app/wnba/Database", spec, { node: WnbaNode }),
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
  readiness: ((svc, _base: any) =>
    (Effect.map as any)(
      (svc as MonitoredDependencyService<Status>).status,
      (s: Schema.Schema.Type<Status>): Readiness => {
        const ready = options.readyWhen(s);
        const detail = options.detail?.(s);
        return detail === undefined ? { ready } : { ready, detail };
      },
    )) as ReadinessOf<MonitoredDependencyService<Status>>,
});

/** Claimed instance keys — duplicate declarations fail fast (Effect won't catch same-key Tags). */
const claimedKeys = new Set<string>();
/** Claimed wire keys — RpcGroup prefixes; duplicates would collide on a shared `RpcServer`. */
const claimedWireKeys = new Set<string>();

/** Reserve a wire key (RpcGroup prefix); a duplicate **throws** — two HyperServices can't share a prefix. */
const claimWireKey = (wireKey: string): void => {
  if (claimedWireKeys.has(wireKey)) {
    throw new DuplicateWireKey({ wireKey });
  }
  claimedWireKeys.add(wireKey);
};

/**
 * The single tag-creation primitive: dup-key guard + `Context.Service` + stow wireKey/spec/group.
 * Tag-creation primitive used by {@link makeTag}. `key` is Context identity; for solo tags
 * `wireKey` is the same string (RpcGroup prefix).
 */
const buildInstanceTag = <Self, S extends Spec>(
  wireKey: string,
  key: string,
  // Runtime spec value — typed loosely as `Spec` so a {@link Tag}`<Self, I>()` caller can present a
  // *resolved* `S` at the type level while passing the raw contract value; `S` still flows precisely
  // via `group` (`RpcGroupOf<S>`) and the explicit type args. Every caller passes `S` explicitly.
  spec: Spec,
  group: RpcGroupOf<S>,
  description: string | undefined,
  node: NodeKey<unknown> | undefined,
  kindOverride: string | undefined,
  // Interface-Tag marks so `buildLocalContext` uses interface-shaped local semantics (pass the
  // impl's own effect/function through, requiring `Local`) rather than the standard `local<T>()`
  // obtain-a-value wrapping.
  interfaceLocalsMarker = false,
  /** When true, stamp {@link sharedTagSym} — kind-keyed wire, route by instance key. */
  sharedMarker = false,
) => {
  if (claimedKeys.has(key)) {
    throw new DuplicateHyperlinkKey({ key });
  }
  claimedKeys.add(key);
  const base = Context.Service<Self, ServiceOf<S, Self>>()(key);
  // per-HyperService local capability — granted only by localLayer, never the client.
  const localCap: Context.Key<Local<Self>, { readonly granted: true }> =
    Context.Service<Local<Self>, { readonly granted: true }>()(
      `${key}/__local`,
    );
  // per-HyperService peer capability — its value is this HyperService's other-node clients, provided
  // only by peersLayer (the opt-in mesh), never by default.
  const peersKey: Context.Key<PeersId<Self>, Record<string, PeerServiceOf<S>>> =
    Context.Service<PeersId<Self>, Record<string, PeerServiceOf<S>>>()(`${key}/__peers`);
  // per-HyperService self-node capability — its value is the node key this instance runs as, provided
  // by peersLayer / selfNodeLayer, never by default.
  const selfNodeKey: Context.Key<SelfNodeId<Self>, string> =
    Context.Service<SelfNodeId<Self>, string>()(`${key}/__selfNode`);
  return Object.assign(base, {
    [wireKeySym]: wireKey,
    description,
    [specSym]: flattenSpec(spec),
    [groupSym]: group,
    [localCapSym]: localCap,
    [nodeSym]: node,
    // C1: `{ node: X }` ≡ set-of-one — keep nodeSym + nodesSym in sync at construction.
    ...(node !== undefined
      ? { [nodesSym]: [node as AnyNode] as ReadonlyArray<AnyNode> }
      : {}),
    // Solo bare tags default to `kind`; shared-Spec instances default kind to the wire key.
    [kindSym]: kindOverride ?? (sharedMarker ? wireKey : kind),
    [readinessSym]: undefined,
    [peersSym]: peersKey,
    [selfNodeSym]: selfNodeKey,
    ...(interfaceLocalsMarker ? { [interfaceLocalsSym]: true as const } : {}),
    ...(sharedMarker ? { [sharedTagSym]: true as const } : {}),
  });
};

/**
 * Optional description / kind bag shared by every {@link Tag} builder overload.
 * `defaults` is **not** on this type — only on overloads that use {@link DefaultsInput}
 * so Promise-returning fns stay rejected (a loose `DefaultsBag` would accept them).
 *
 * @internal
 */
type TagOptions = {
  readonly description?: string;
  readonly kind?: string;
};

/** Schema-driven {@link Tag}`<Self>()` builder — bare {@link local} rejected ({@link RejectBareLocal}).
 *  Node-bearing overloads first so `options.node` still infers `HSelf` when options are a variable.
 *  `{ defaults }` overloads (required key) before optional-options so bag keys stay precise.
 *  @internal */
type SchemaTagBuilder<Self> = {
  <const S extends Spec, const D extends DefaultsBag, HSelf>(
    key: string,
    spec: S & RejectBareLocal<S>,
    options: TagOptions & {
      readonly node: AddressedNode<HSelf>;
      readonly defaults: DefaultsInput<D>;
    },
  ): TagWithDefaults<
    NodeBoundTag<Self, S, HSelf> & { readonly [nodeSym]: AddressedNode<HSelf> },
    D
  >;
  <const S extends Spec, const D extends DefaultsBag, HSelf>(
    key: string,
    spec: S & RejectBareLocal<S>,
    options: TagOptions & {
      readonly node: NodeKey<HSelf>;
      readonly defaults: DefaultsInput<D>;
    },
  ): TagWithDefaults<NodeBoundTag<Self, S, HSelf>, D>;
  <const S extends Spec, const D extends DefaultsBag>(
    key: string,
    spec: S & RejectBareLocal<S>,
    options: TagOptions & { readonly defaults: DefaultsInput<D> },
  ): TagWithDefaults<HyperlinkTag<Self, S>, D>;
  <const S extends Spec, HSelf>(
    key: string,
    spec: S & RejectBareLocal<S>,
    options: TagOptions & { readonly node: AddressedNode<HSelf> },
  ): NodeBoundTag<Self, S, HSelf> & {
    readonly [nodeSym]: AddressedNode<HSelf>;
  };
  <const S extends Spec, HSelf>(
    key: string,
    spec: S & RejectBareLocal<S>,
    options: TagOptions & { readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, S, HSelf>;
  <const S extends Spec>(
    key: string,
    spec: S & RejectBareLocal<S>,
    options?: TagOptions,
  ): HyperlinkTag<Self, S>;
};

/** Interface-driven {@link Tag}`<Self, I>()` builder — bare {@link local} typed from `I`
 *  ({@link Validate} / {@link ResolveLocals}). @internal */
type InterfaceTagBuilder<Self, I> = {
  <const S extends Spec, const D extends DefaultsBag, HSelf>(
    key: string,
    spec: S & Validate<S, I>,
    options: TagOptions & {
      readonly node: AddressedNode<HSelf>;
      readonly defaults: DefaultsInput<D>;
    },
  ): TagWithDefaults<
    NodeBoundTag<Self, ResolveLocals<S, I>, HSelf> & {
      readonly [nodeSym]: AddressedNode<HSelf>;
    },
    D
  >;
  <const S extends Spec, const D extends DefaultsBag, HSelf>(
    key: string,
    spec: S & Validate<S, I>,
    options: TagOptions & {
      readonly node: NodeKey<HSelf>;
      readonly defaults: DefaultsInput<D>;
    },
  ): TagWithDefaults<NodeBoundTag<Self, ResolveLocals<S, I>, HSelf>, D>;
  <const S extends Spec, const D extends DefaultsBag>(
    key: string,
    spec: S & Validate<S, I>,
    options: TagOptions & { readonly defaults: DefaultsInput<D> },
  ): TagWithDefaults<HyperlinkTag<Self, ResolveLocals<S, I>>, D>;
  <const S extends Spec, HSelf>(
    key: string,
    spec: S & Validate<S, I>,
    options: TagOptions & { readonly node: AddressedNode<HSelf> },
  ): NodeBoundTag<Self, ResolveLocals<S, I>, HSelf> & {
    readonly [nodeSym]: AddressedNode<HSelf>;
  };
  <const S extends Spec, HSelf>(
    key: string,
    spec: S & Validate<S, I>,
    options: TagOptions & { readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, ResolveLocals<S, I>, HSelf>;
  <const S extends Spec>(
    key: string,
    spec: S & Validate<S, I>,
    options?: TagOptions,
  ): HyperlinkTag<Self, ResolveLocals<S, I>>;
};

/**
 * Shared-Spec factory from {@link Tag}`(wireKey, spec)`. Mint instances with the Effect-shaped
 * double call: `Factory<Self>()(instanceKey)`.
 *
 * @category models
 * @public
 */
export interface SharedTagFactory<S extends Spec> {
  <Self>(): {
    <const D extends DefaultsBag>(
      key: string,
      options: {
        readonly description?: string;
        readonly node?: NodeKey<unknown>;
        readonly defaults: DefaultsInput<D>;
      },
    ): TagWithDefaults<HyperlinkTag<Self, S>, D>;
    (
      key: string,
      options?: {
        readonly description?: string;
        readonly node?: NodeKey<unknown>;
      },
    ): HyperlinkTag<Self, S>;
  };
  /** Wire / kind key — RpcGroup prefix for every instance. */
  readonly wireKey: string;
  readonly kind: string;
  readonly description: string | undefined;
  readonly [specSym]: FlatSpec;
  readonly [specTypeSym]?: S;
  readonly [groupSym]: RpcGroupOf<S>;
}

/**
 * Create a HyperService service tag.
 *
 * **Solo (schema)** — `Tag<Self>()(key, spec)`: value type inferred from the spec; wire key = `.key`.
 *
 * ```ts
 * class Counter extends Hyperlink.Tag<Counter>()("Counter", {
 *   increment: Hyperlink.effectFn({ by: Schema.Number }),
 *   current: Hyperlink.effect(Schema.Number),
 * }) {}
 * ```
 *
 * Optional `{ defaults }` on the options bag is sugar for `.pipe(Hyperlink.defaults(…))` —
 * bag keys widen `Service` / `yield* Tag` the same way.
 *
 * **Solo (interface)** — `Tag<Self, I>()(key, contract)`: interface `I` is SSOT; bare
 * {@link local} takes its type from `I`.
 *
 * **Shared Spec** — `Tag(wireKey, spec)` then `Factory<Self>()(instanceKey)`: one RpcGroup
 * prefixed by `wireKey`, many Context identities routed by header `key`. Use only when every
 * instance has the same procedure names and schemas. Serve with ordinary {@link serve} /
 * {@link serveRemote} (merge layers); dial with ordinary {@link client}.
 *
 * ```ts
 * const Counters = Hyperlink.Tag("demo/SharedCounters", {
 *   snapshot: Hyperlink.effect(Schema.Number),
 * });
 * class Nwsl extends Counters<Nwsl>()("@app/Nwsl/counters") {}
 * class Mls extends Counters<Mls>()("@app/Mls/counters") {}
 *
 * Layer.mergeAll(
 *   Hyperlink.serve(Nwsl, { snapshot: Effect.succeed(1) }),
 *   Hyperlink.serve(Mls, { snapshot: Effect.succeed(2) }),
 * );
 * ```
 *
 * Keys must be unique: a duplicate **throws at declaration**. Solo tags also claim their key as
 * the wire prefix; shared factories claim `wireKey` once for the whole family of instances.
 *
 * @category constructors
 * @public
 */
const makeTag = retype<{
  /** Schema-driven solo: infer the service from `spec`; bare {@link local} is a compile error. */
  <Self>(): SchemaTagBuilder<Self>;
  /** Interface-driven solo: `I` is SSOT; bare {@link local} takes its type from `I`. */
  <Self, I>(): InterfaceTagBuilder<Self, I>;
  /** Shared Spec: one wire key, many instance tags (`Factory<Self>()(instanceKey)`). */
  <const S extends Spec>(
    wireKey: string,
    spec: S & RejectBareLocal<S>,
    options?: TagOptions & { readonly node?: NodeKey<unknown> },
  ): SharedTagFactory<S>;
}>(function makeTag(
  wireKeyOrNever?: string,
  sharedSpec?: Spec,
  sharedOptions?: TagOptions & { readonly node?: NodeKey<unknown> },
) {
  // Shared-Spec factory: Tag(wireKey, spec) → Factory<Self>()(instanceKey).
  if (typeof wireKeyOrNever === "string" && sharedSpec !== undefined) {
    const wireKey = wireKeyOrNever;
    claimWireKey(wireKey);
    const flat = flattenSpec(sharedSpec);
    const group = retype<RpcGroupOf<Spec>>(
      buildRpcGroup(wireKey, flat) as never,
    );
    const factoryKind = sharedOptions?.kind ?? wireKey;
    const factoryNode = sharedOptions?.node;
    const mint =
      () =>
      (
        key: string,
        instanceOptions?: {
          readonly description?: string;
          readonly node?: NodeKey<unknown>;
          readonly defaults?: DefaultsBag;
        },
      ) => {
        const tag = buildInstanceTag<unknown, Spec>(
          wireKey,
          key,
          sharedSpec,
          group,
          instanceOptions?.description ?? sharedOptions?.description,
          instanceOptions?.node ?? factoryNode,
          factoryKind,
          false,
          true,
        );
        return applyTagDefaults(tag, instanceOptions?.defaults);
      };
    return Object.assign(mint, {
      wireKey,
      kind: factoryKind,
      description: sharedOptions?.description,
      [specSym]: flat,
      [groupSym]: group,
    });
  }

  // Solo builder — overload surface discriminates schema vs interface.
  // `options.node` rides the call so its identity `HSelf` infers; node-bearing overloads narrow
  // `[nodeSym]` for {@link Hyperlink.client}. An {@link AddressedNode} further enables auto-connect.
  // Self/S are phantom here: the public overloads restate them; pin `unknown`/`Spec` so this body
  // does not chase a free type parameter into RpcGroupOf / ServiceOf.
  function build(
    key: string,
    spec: Spec,
    options?: TagOptions & {
      readonly node?: NodeKey<unknown>;
      readonly defaults?: DefaultsBag;
    },
  ) {
    claimWireKey(key);
    const flat = flattenSpec(spec);
    const interfaceLocals = Object.values(flat).some((m) =>
      Predicate.hasProperty(m, bareLocalSym),
    );
    const tag = buildInstanceTag<unknown, Spec>(
      key,
      key,
      spec,
      retype<RpcGroupOf<Spec>>(buildRpcGroup(key, flat) as never),
      options?.description,
      options?.node,
      options?.kind,
      interfaceLocals,
    );
    return applyTagDefaults(tag, options?.defaults);
  }
  return build;
} as never);

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
 * The **local** layer for a serviceKey: provide a real implementation of its service. Grants
 * the HyperService's {@link Local}, so any {@link Hyperlink.local} (local-only) members
 * become callable here — they're a compile error under {@link Hyperlink.client}.
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
const buildLocalContext = <Self, E = never>(
  tag: {
    readonly [specSym]: FlatSpec;
    readonly [localCapSym]: Context.Key<
      Local<Self>,
      { readonly granted: true }
    >;
    readonly [interfaceLocalsSym]?: true;
    readonly [defaultsSym]?: DefaultsBag;
  },
  builtImpl: Record<string, unknown>,
): Effect.Effect<Context.Context<unknown>, E> =>
  Effect.gen(function* () {
    const cap = tag[localCapSym];
    const spec = tag[specSym];
    // Interface-Tag locals are interface-shaped: the impl provides the member's own `Effect` /
    // `Stream` / function, which passes through (its `Local` requirement is satisfied by the granted
    // cap in context). A standard `local<T>()` always obtains a raw value, so it's wrapped.
    const interfaceLocalsTag = tag[interfaceLocalsSym] === true;
    const members = flattenImpl(builtImpl, spec);
    const service: Record<string, unknown> = {};
    for (const [key, m] of Object.entries(spec)) {
      // local members surface as `Effect<T, never, Local>` (require Local to obtain the
      // value); default members install the Tag-baked value; value fields are resolved once here into a
      // plain value; ref fields and other wire members pass through unchanged.
      if (isLocalMethod(m)) {
        const member = members[key];
        const interfaceShaped =
          interfaceLocalsTag &&
          (Effect.isEffect(member) ||
            Stream.isStream(member) ||
            typeof member === "function");
        setPath(
          service,
          key,
          interfaceShaped ? member : Effect.as(cap, member),
        );
      } else if (isDefaultMethod(m)) {
        // Tag-baked default; layer impl may override (same key / nested path).
        const override = getPath(builtImpl, key);
        setPath(service, key, override !== undefined ? override : m.value);
      } else if (isValueMethod(m)) {
        setPath(service, key, yield* (members[key] as Effect.Effect<unknown, E>));
      } else {
        setPath(service, key, members[key]);
      }
    }
    applyDefaultsBag(service, tag[defaultsSym], builtImpl);
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
  tag: HyperlinkTag<Self, S>,
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
  // Opt out of default-on verify: this helper runs inside Layer.unwrap (identity
  // claim / lookupClient), and nested deep verify deadlocks on the peer dial.
  return clientLayer(tag, node).pipe(
    Layer.provide(clientVerify(false)),
  ) as any;
};

/**
 * Claim `tag.key` at Lookup — won → `onWon` layer; lost → client of `original`.
 * Endpoint from {@link ListenNode} (protocol listen) or the Tag's bound Node — no `{ self }` bag.
 * Fail-closed: requires {@link LookupIdentity}; missing/unaddressed → {@link IdentitySelfRequired}.
 * @internal
 */
const identityClaimLayer = <Self, S extends Spec, A, E, R>(
  tag: HyperlinkTag<Self, S>,
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
  tag: HyperlinkTag<Self, S>,
  impl: ImplWithDefaultOverrides<S> | Effect.Effect<ImplWithDefaultOverrides<S>, never, R>,
): Layer.Layer<Self | Local<Self>, ValueErrorsOf<S>, Exclude<R, Scope.Scope>> => {
  // One `effectContext` layer, so any `Scope` the impl's construction needs is managed by the layer.
  const build = Effect.flatMap(
    Effect.isEffect(impl) ? impl : Effect.succeed(impl),
    (builtImpl) =>
      buildLocalContext<Self, ValueErrorsOf<S>>(
        tag,
        builtImpl as Record<string, unknown>,
      ),
  );
  return Layer.effectContext(build) as Layer.Layer<
    Self | Local<Self>,
    ValueErrorsOf<S>,
    Exclude<R, Scope.Scope>
  >;
};

function localLayer<Self, S extends Spec>(
  tag: HyperlinkTag<Self, S> & { readonly [identitySym]: true },
  impl: ImplWithDefaultOverrides<S>,
): Layer.Layer<Self | Local<Self>, IdentitySelfRequired | ValueErrorsOf<S>, LookupIdentity>;
function localLayer<Self, S extends Spec, R>(
  tag: HyperlinkTag<Self, S> & { readonly [identitySym]: true },
  impl: Effect.Effect<ImplWithDefaultOverrides<S>, never, R>,
): Layer.Layer<
  Self | Local<Self>,
  IdentitySelfRequired | ValueErrorsOf<S>,
  Exclude<R, Scope.Scope> | LookupIdentity
>;
function localLayer<Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
  impl: ImplWithDefaultOverrides<S>,
): Layer.Layer<Self | Local<Self>, ValueErrorsOf<S>>;
function localLayer<Self, S extends Spec, R>(
  tag: HyperlinkTag<Self, S>,
  impl: Effect.Effect<ImplWithDefaultOverrides<S>, never, R>,
): Layer.Layer<Self | Local<Self>, ValueErrorsOf<S>, Exclude<R, Scope.Scope>>;
function localLayer<Self, S extends Spec, R>(
  tag: HyperlinkTag<Self, S>,
  impl: ImplWithDefaultOverrides<S> | Effect.Effect<ImplWithDefaultOverrides<S>, never, R>,
): Layer.Layer<
  Self | Local<Self>,
  IdentitySelfRequired | ValueErrorsOf<S>,
  Exclude<R, Scope.Scope> | LookupIdentity
> {
  const plain = localLayerPlain(tag, impl);
  if (!isIdentity(tag)) {
    return plain as Layer.Layer<
      Self | Local<Self>,
      IdentitySelfRequired | ValueErrorsOf<S>,
      Exclude<R, Scope.Scope> | LookupIdentity
    >;
  }
  return identityClaimLayer(tag, plain);
}

/** Invoke a wire impl member — spreads 2-tuple payloads when `callStyle` is `"pair"`. @internal */
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
    // Dynamic wire member — provideContext's open overload channels are not expressible as
    // concrete E/R. `as any` here is the established wire-discharge boundary (not a Layer channel).
    return Effect.provideContext(invoked as any, context as any) as any;
  }
  if (Stream.isStream(invoked)) {
    return Stream.provideContext(invoked as any, context as any) as any;
  }
  return invoked;
};

/**
 * One served HyperService's registry entry — its group (folded into the shared server), wire id, kind, and
 * readiness derivation. {@link serve} appends it; {@link httpServer} reads them for the merged server +
 * `/health` + node-status.
 *
 * @category models
 * @internal
 */
export interface ServedHyperlink {
  readonly wireKey: string;
  readonly group: RpcGroup.RpcGroup<any>;
  readonly kind: string;
  readonly readiness: Effect.Effect<Readiness>;
  /** F4 wire-contract fingerprint — stamped at serve from the tag Spec. */
  readonly contractHash: string;
  /** Opt-in handoff fn (serve `{ handoff }`, Locked #39); materialized in {@link runServedHandoffs}. */
  readonly handoff?: ServedHandoff;
  /** Node log key when the served tag is bound to a {@link Node} (`options.node`). */
  readonly nodeLogKey?: string;
  /** Declared transport set of the tag's {@link Node}, when node-bound — the server asserts its own
   *  transport is a **member**, else {@link ProtocolKindMismatch}. A multi-protocol node lists all its
   *  transports, so serving it over any one passes. */
  readonly nodeKinds?: ReadonlyArray<ProtocolKind>;
}

/**
 * The served-HyperServices registry — an accumulator {@link serve} appends to and {@link httpServer} reads.
 * A plain `Ref`-backed list (not type-level state), so many `serve` layers compose under `Layer.mergeAll`
 * and the server sees every one. Provided by {@link httpServer} (or {@link servedHyperServicesLayer}); `serve`
 * registers **only if it's present** (so `serve` also works standalone).
 *
 * @category models
 * @internal
 */
export class ServedHyperServices extends Context.Service<
  ServedHyperServices,
  {
    readonly register: (entry: ServedHyperlink) => Effect.Effect<void>;
    readonly all: Effect.Effect<ReadonlyArray<ServedHyperlink>>;
  }
>()("hyperlink-ts/Hyperlink/ServedHyperServices") {}

/**
 * A fresh {@link ServedHyperServices} registry. {@link httpServer} / {@link ipcServer} /
 * {@link wsServer} each provide {@link Layer.fresh} of this so two servers in one
 * process (e.g. Lookup + a Worker) do not share registrations via Layer memoization.
 * Provide this standalone only to collect `serve` registrations without a server.
 *
 * @category serving
 * @internal
 */
export const servedHyperServicesLayer: Layer.Layer<ServedHyperServices> = Layer.effect(
  ServedHyperServices,
  Effect.gen(function* () {
    const ref = yield* Ref.make<ReadonlyArray<ServedHyperlink>>([]);
    return {
      register: (entry) => Ref.update(ref, (all) => [...all, entry]),
      all: Ref.get(ref),
    };
  }),
);

/**
 * A {@link serve} handler for one wire method — like {@link ServiceMethod}, but the handler may carry a
 * **run-time requirement `R`** (a dependency it `yield*`s), which {@link serve} preserves so a
 * per-HyperService `Layer.provide` can discharge it in isolation.
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
  readonly [K in keyof S as S[K] extends AnyLocalMethod | AnyDefaultMethod ? never : K]: S[K] extends {
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

/** Shallow tag shape for serve-remote mounts — avoids open `RpcGroupOf<S>` walks (TS2589). */
type ServeRemoteTag = {
  readonly key?: string;
  readonly [wireKeySym]: string;
  readonly [specSym]: FlatSpec;
  readonly [groupSym]: { readonly toLayer: (handlers: never) => Layer.Any };
};

/** Header carrying the shared-Spec instance key, set per-call by {@link forwardClient}. */
const INSTANCE_KEY_HEADER = "key";

/**
 * Per wire-key runtime for shared-Spec serve: instance table + readiness parts.
 * Handler layers are memoized by reference so `Layer.mergeAll(serve(A), serve(B))` mounts
 * one RpcGroup and appends instances.
 */
type SharedWireState = {
  readonly table: Map<string, Record<string, unknown>>;
  readonly readiness: Array<Effect.Effect<Readiness>>;
  readonly handoffs: Array<ServedHandoff>;
};

const sharedWireStates = new Map<string, SharedWireState>();
const sharedHandlerLayers = new Map<string, Layer.Any>();

const getSharedWireState = (wireKey: string): SharedWireState => {
  let state = sharedWireStates.get(wireKey);
  if (state === undefined) {
    state = { table: new Map(), readiness: [], handoffs: [] };
    sharedWireStates.set(wireKey, state);
  }
  return state;
};

const mergeAnyLayer = retype<(left: Layer.Any, right: Layer.Any) => Layer.Any>(
  Layer.merge as never,
);

/**
 * One memoized handler+registry layer per shared wire key. Closed over the live instance table
 * so later `serve`s of the same factory only register instances.
 */
const getOrCreateSharedHandlerLayer = (
  tag: ServeRemoteTag,
  workerContext: Context.Context<unknown> | undefined,
): Layer.Any => {
  const wireKey = tag[wireKeySym];
  const existing = sharedHandlerLayers.get(wireKey);
  if (existing !== undefined) return existing;

  const state = getSharedWireState(wireKey);
  const group = tag[groupSym];
  const spec = tag[specSym];
  const handlers: Record<
    string,
    (
      payload: unknown,
      options: { readonly headers: Headers.Headers },
    ) => unknown
  > = {};
  for (const method of Object.keys(spec)) {
    handlers[wireTag(wireKey, method)] = (payload, options) => {
      const instanceKey = Option.getOrUndefined(
        Headers.get(options.headers, INSTANCE_KEY_HEADER),
      );
      if (instanceKey === undefined) {
        return Effect.die(
          new SharedRoutingError({ method, reason: "missing-key" }),
        );
      }
      const flatImpl = state.table.get(instanceKey);
      if (flatImpl === undefined) {
        return Effect.die(
          new SharedRoutingError({
            method,
            reason: "unknown-key",
            key: instanceKey,
          }),
        );
      }
      const member = flatImpl[method];
      return workerContext === undefined
        ? invokeWireMethod(member, spec[method] as AnyMethod, payload)
        : invokeWireMethodWithContext(
            member,
            spec[method] as AnyMethod,
            payload,
            workerContext,
          );
    };
  }
  const toHandlerLayer = retype<(handlers: never) => Layer.Any>(
    group.toLayer.bind(group) as never,
  );
  const handlerLayer = toHandlerLayer(handlers as never);
  const kind = kindOf(tag) ?? wireKey;
  const registration = Layer.effectDiscard(
    Effect.serviceOption(ServedHyperServices).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (registry) => {
            const bound = nodeOf(tag);
            const boundKinds = nodeKindsOf(tag);
            return registry.register({
              wireKey,
              group: retype(group as never),
              kind,
              contractHash: hashContract(wireKey, kind, spec),
              readiness: Effect.suspend(() => allReady(state.readiness)),
              // Shared instance handoffs live on SharedWireState — see {@link runServedHandoffs}.
              ...(bound !== undefined ? { nodeLogKey: bound.key } : {}),
              ...(boundKinds.length > 0 ? { nodeKinds: boundKinds } : {}),
            });
          },
        }),
      ),
    ),
  );
  // Drop the memoized layer when its scope closes so a later test/run can remount cleanly.
  const cleanup = Layer.effectDiscard(
    Effect.acquireRelease(Effect.void, () =>
      Effect.sync(() => {
        sharedHandlerLayers.delete(wireKey);
      }),
    ),
  );
  const layer = mergeAnyLayer(
    mergeAnyLayer(handlerLayer, registration),
    cleanup,
  );
  sharedHandlerLayers.set(wireKey, layer);
  return layer;
};

/**
 * Register one shared-Spec instance into the wire table for the lifetime of the layer scope.
 */
const sharedInstanceLayer = (
  tag: ServeRemoteTag & { readonly key: string },
  wireImpl: unknown,
  handoffFn: HandoffFn | undefined,
): Layer.Any => {
  const wireKey = tag[wireKeySym];
  const instanceKey = tag.key;
  const flatImpl = flattenImpl(
    wireImpl as Record<string, unknown>,
    tag[specSym],
  );
  const readiness = readinessCheckServed(tag, wireImpl);
  const handoff = servedHandoff(tag, wireImpl, handoffFn);
  return Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.sync(() => {
        const state = getSharedWireState(wireKey);
        if (state.table.has(instanceKey)) {
          throw new DuplicateSharedInstance({ wireKey, key: instanceKey });
        }
        state.table.set(instanceKey, flatImpl);
        state.readiness.push(readiness);
        if (handoff !== undefined) state.handoffs.push(handoff);
      }),
      () =>
        Effect.sync(() => {
          const state = sharedWireStates.get(wireKey);
          if (state === undefined) return;
          state.table.delete(instanceKey);
          const idx = state.readiness.indexOf(readiness);
          if (idx >= 0) state.readiness.splice(idx, 1);
          if (handoff !== undefined) {
            const hIdx = state.handoffs.indexOf(handoff);
            if (hIdx >= 0) state.handoffs.splice(hIdx, 1);
          }
          if (state.table.size === 0) {
            sharedWireStates.delete(wireKey);
          }
        }),
    ),
  );
};

/**
 * Shared handler mount + registry registration for {@link serveRemote} / {@link serveRemoteDriver}.
 * Returns {@link Layer.Any}; public wrappers reify `R` / {@link HandlerContextOf}.
 *
 * Shared-Spec tags ({@link Tag}`(wireKey, spec)` instances) merge under one RpcGroup: the first
 * `serve` mounts handlers; later `serve`s of the same wire key only append instances.
 */
const serveRemoteHandlers = (
  tag: ServeRemoteTag,
  wireImpl: unknown,
  workerContext: Context.Context<unknown> | undefined,
  serveOptions?: ResolvedServeOptions,
): Layer.Any => {
  const handoffFn = serveOptions?.handoff;
  const overrideNode = serveOptions?.node;
  if (isSharedTag(tag)) {
    // Context.Service always carries `.key`; shared mint uses it as the routing header.
    return mergeAnyLayer(
      sharedInstanceLayer(
        tag as ServeRemoteTag & { readonly key: string },
        wireImpl,
        handoffFn,
      ),
      getOrCreateSharedHandlerLayer(tag, workerContext),
    );
  }

  const group = tag[groupSym];
  const handlers: Record<string, (payload: unknown) => unknown> = {};
  // flatten a (possibly nested) impl to path keys matching the flat spec + path-keyed group procedures.
  const flatImpl = flattenImpl(wireImpl as Record<string, unknown>, tag[specSym]);
  for (const [key, member] of Object.entries(flatImpl)) {
    handlers[wireTag(tag[wireKeySym], key)] = (payload) =>
      workerContext === undefined
        ? invokeWireMethod(member, tag[specSym][key] as AnyMethod, payload)
        : invokeWireMethodWithContext(
            member,
            tag[specSym][key] as AnyMethod,
            payload,
            workerContext,
          );
  }
  // RpcGroup.toLayer is a dynamically-keyed factory — bridge with retype so `any`/`unknown`
  // never enter Layer E/R channels.
  const toHandlerLayer = retype<(handlers: never) => Layer.Any>(
    group.toLayer.bind(group) as never,
  );
  const handlerLayer = toHandlerLayer(handlers as never);
  // register into the served-HyperServices registry when one is present (`httpServer` provides it), so the
  // shared server + `/health` discover this HyperService without the caller listing it twice. Merged (not
  // provided) so it isn't pruned as unused; a no-op when no registry is in context (standalone `serve`).
  const registration = Layer.effectDiscard(
    Effect.serviceOption(ServedHyperServices).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (registry) => {
            const bound = overrideNode ?? nodeOf(tag);
            const boundKinds =
              overrideNode !== undefined
                ? nodeKindsOfNode(overrideNode)
                : nodeKindsOf(tag);
            const kind = kindOf(tag) ?? "hyperlink";
            const handoff = servedHandoff(tag, wireImpl, handoffFn);
            return registry.register({
              wireKey: tag[wireKeySym],
              group: retype(group as never),
              kind,
              contractHash: hashContract(tag[wireKeySym], kind, tag[specSym]),
              readiness: readinessCheckServed(tag, wireImpl),
              ...(handoff !== undefined ? { handoff } : {}),
              ...(bound !== undefined ? { nodeLogKey: bound.key } : {}),
              ...(boundKinds.length > 0 ? { nodeKinds: boundKinds } : {}),
            });
          },
        }),
      ),
    ),
  );
  return mergeAnyLayer(handlerLayer, registration);
};

/**
 * A HyperService's **served-only handler layer** — mounts the tag's group handlers (wire members only,
 * **no** local grant), with the handlers' requirement `R` **preserved** (not erased). This is the
 * served-only counterpart to {@link serve}, which additionally grants {@link Local} so
 * members stay callable in-process. `serveRemote`'s `R` rides the layer's requirement channel, so a
 * per-HyperService `Layer.provide` discharges *this* HyperService's dependency in isolation:
 *
 * ```ts
 * Hyperlink.serveRemote(SeasonMatches, seasonMatchesImpl).pipe(Layer.provide(importHandlersLayer))
 * ```
 *
 * The point of `serveRemote` is the run-time-requirement case: N HyperServices needing different
 * implementations of the same tag, each isolated — merge the layers onto one `RpcServer` (groups are
 * prefix-keyed).
 *
 * Plain impls infer `R` via {@link ServeRequirements}. For a {@link Driver}, use
 * {@link serveRemoteDriver} so the driver's `R` is the Layer requirement (no toolkit retype).
 *
 * @category serving
 * @public
 */
export const serveRemote = <S extends Spec, Impl extends ServeImplOf<S, any>>(
  tag: {
    readonly [wireKeySym]: string;
    readonly [specSym]: FlatSpec;
    readonly [specTypeSym]?: S;
    readonly [groupSym]: RpcGroupOf<S>;
  },
  impl: Impl,
  options?: ServeOptions,
): Layer.Layer<HandlerContextOf<S>, never, ServeRequirements<Impl>> =>
  retype<Layer.Layer<HandlerContextOf<S>, never, ServeRequirements<Impl>>>(
    serveRemoteHandlers(
      tag,
      impl,
      undefined,
      resolveServeOptions(options),
    ) as never,
  );

/**
 * Served-only mount for a {@link Driver} — preserves the driver's requirement `R` on the Layer.
 * Separate from {@link serveRemote} so plain-impl `ServeRequirements` inference stays sharp and
 * open-`S` Driver overloads don't hit TS2589. Used by Gate / Daemon / WorkPool / {@link serve}.
 *
 * Success channel is {@link HandlerContextOf}`<S>` when `S` is concrete on the tag; callers that
 * already name handler slots on their public return can treat this as the R-preserving mount.
 *
 * @category serving
 * @public
 */
export const serveRemoteDriver = <S extends Spec, R>(
  tag: {
    readonly [wireKeySym]: string;
    readonly [specSym]: FlatSpec;
    readonly [specTypeSym]?: S;
    readonly [groupSym]: ServeRemoteTag[typeof groupSym];
  },
  driver: Driver<S, R>,
  options?: ServeOptions,
): Layer.Layer<HandlerContextOf<S>, never, R> =>
  retype<Layer.Layer<HandlerContextOf<S>, never, R>>(
    serveRemoteHandlers(
      tag,
      driver.impl,
      driver.workerContext as Context.Context<unknown>,
      resolveServeOptions(options),
    ) as never,
  );

/**
 * Serve a HyperService **and** grant its local instance from **one** materialization — the co-located "expose
 * it over RPC AND consume it in-process" case (a node that serves its HyperServices and also `yield*`s them,
 * e.g. to read a {@link Hyperlink.local} member). The impl runs **once**, so its cells / pollers / resolved
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
  tag: HyperlinkTag<Self, S>,
  impl:
    | ImplWithDefaultOverrides<S>
    | Driver<S, R>
    | Effect.Effect<ImplWithDefaultOverrides<S> | Driver<S, R>, never, R>,
  options?: ServeOptions,
): Layer.Layer<Self | Local<Self> | HandlerContextOf<S>, ValueErrorsOf<S>, R> => {
  const unwrapServe = retype<
    (
      effect: never,
    ) => Layer.Layer<Self | Local<Self> | HandlerContextOf<S>, ValueErrorsOf<S>, R>
  >(Layer.unwrap as never);
  const mergeServe = retype<
    (
      left: Layer.Layer<Self | Local<Self>, ValueErrorsOf<S>, never>,
      right: Layer.Layer<HandlerContextOf<S>, never, R>,
    ) => Layer.Layer<Self | Local<Self> | HandlerContextOf<S>, ValueErrorsOf<S>, R>
  >(Layer.merge as never);
  return unwrapServe(
    Effect.map(Effect.isEffect(impl) ? impl : Effect.succeed(impl), (built) => {
      if (isDriver<S, R>(built)) {
        // Plain local — identity claim (if any) already happened in {@link serve}.
        return mergeServe(
          localLayerPlain(tag, grantLocal(tag, built)),
          serveRemoteDriver(tag, built, options),
        );
      }
      // Wire handlers only: `flattenImpl` drops `local` members. Bridge ImplOf → ServeImplOf at the
      // wire boundary (local members are off the wire; R already discharged by the Effect form).
      return mergeServe(
        localLayerPlain(tag, built),
        retype<Layer.Layer<HandlerContextOf<S>, never, R>>(
          serveRemote(
            tag,
            retype<ServeImplOf<S, never>>(built as never),
            options,
          ) as never,
        ),
      );
    }) as never,
  );
};

/** Stamped on a {@link serve} layer with the served tag's key — lets an anonymous `listen` derive a
 *  legible node name from the first resource it serves without building the layer. @public */
export const servedKeySym: unique symbol = Symbol.for(
  "hyperlink-ts/Hyperlink/servedKey",
);

/** The served tag's key stamped on a {@link serve} layer, or `undefined`. @public */
export const servedKeyOf = (layer: unknown): string | undefined => {
  if (Predicate.hasProperty(layer, servedKeySym)) {
    const k = layer[servedKeySym];
    return typeof k === "string" ? k : undefined;
  }
  return undefined;
};

/**
 * Expose a {@link Tag}'s implementation as an RPC **server** layer — the served counterpart of
 * {@link layer}. Pair it with {@link Node.httpServer} / {@link Node.wsServer} (or {@link listen}) to
 * put it on a transport, and dial it with {@link client} / {@link connect}.
 *
 * Shared-Spec instances (`Tag(wireKey, spec)` → `Factory<Self>()(instanceKey)`) share one
 * RpcGroup: `Layer.mergeAll(serve(A, …), serve(B, …))` mounts handlers once and routes by
 * the per-call `key` header.
 *
 * The optional third argument is either an {@link AnyNode} (sugar for `{ node }`) or a
 * {@link ServeOptions} bag — `{ node?, handoff? }`. A `handoff` fn (Locked #39) runs during
 * {@link Node.shutdown} after drain: `(from, to, ctx) => Effect<void | HandoffOutcome>` moving work
 * from the local handle `from` to the peer client `to`.
 *
 * @category serving
 * @public
 */
export const serve = <Self, S extends Spec, R = never>(
  tag: HyperlinkTag<Self, S>,
  impl:
    | ImplWithDefaultOverrides<S>
    | Driver<S, R>
    | Effect.Effect<ImplWithDefaultOverrides<S> | Driver<S, R>, never, R>,
  options?: AnyNode | ServeOptions,
): Layer.Layer<Self | Local<Self> | HandlerContextOf<S>, ValueErrorsOf<S>, R> => {
  const serveOptions = resolveServeOptions(options);
  // Stamp the served tag's key so an anonymous `listen` can derive a legible node name from the first
  // resource it serves (see {@link servedKeyOf} / anonymousNodeKey). Stamped on the FINAL layer both
  // paths return (servePlain re-merges, which would drop an earlier stamp).
  const plain = Object.assign(servePlain(tag, impl, serveOptions), {
    [servedKeySym]: tag.key,
  });
  if (!isIdentity(tag)) {
    return plain;
  }
  // Identity path requires Lookup.Identity at runtime (fail-closed). Kept off the public
  // `R` channel so plain `serve` stays TS2589-free (HyperlinkTag & identity brand blows up).
  const claimed = identityClaimLayer(tag, plain) as Layer.Layer<
    Self | Local<Self> | HandlerContextOf<S>,
    ValueErrorsOf<S>,
    R
  >;
  return Object.assign(claimed, { [servedKeySym]: tag.key });
};

// [extracted to Node module — was Hyperlink.ts:3193-3978]

/**
 * Provide one dependency `Layer` to several {@link serve} layers at once — sugar for
 * `Layer.mergeAll(resources).pipe(Layer.provide(dependency))`. Reads as "these HyperServices, on this
 * dependency," so a group that shares an implementation states it once:
 *
 * ```ts
 * Hyperlink.provide(ImportHandlers.layer, [
 *   Hyperlink.serve(SeasonMatches,   seasonMatchesImpl),
 *   Hyperlink.serve(LiveScorePoller, pollerImpl),
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
  services: readonly [Layer.Layer<A, E, R>, ...ReadonlyArray<Layer.Layer<A, E, R>>],
): Layer.Layer<A, E | EL, Exclude<R, ROut> | RL> =>
  Layer.mergeAll(...services).pipe(Layer.provide(dependency));

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
 * {@link Hyperlink.client} (production, over a real `Protocol`) and the in-memory
 * round-trip test (client from `RpcTest`).
 *
 * @internal
 */
export const forwardClient = <S extends Spec>(
  rpc: unknown,
  spec: S,
  wireKey: string,
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
    // local / default aren't on the wire — locals are stubbed in clientLayer; defaults installed there.
    if (isLocalMethod(m) || isDefaultMethod(m)) continue;
    // the wire tag is wireKey-prefixed; the service surface keeps the bare method name
    const call = calls[wireTag(wireKey, key)];
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

// [extracted to Node module — was Hyperlink.ts:4183-4261]

/** The default RPC serialization: newline-delimited JSON — handles both one-shot and
 * **streaming** responses, and is shared by {@link http} + {@link httpServer} so a
 * client and server can't silently disagree on the codec. */
/** @internal */
export const defaultSerialization: Layer.Layer<RpcSerialization.RpcSerialization> =
  RpcSerialization.layerNdjson;

const httpClientInBrowserMessage =
  "Hyperlink.protocolHttp / http cannot run in a browser: a dashboard opens many concurrent " +
  "streams (each HyperService's status + metrics + logs) and the browser caps at ~6 HTTP/1.1 " +
  "connections per origin, so the rest are starved (no graphs, no logs, frozen cards). Use " +
  "Hyperlink.ws / a socket-kind node for the browser. See docs/observe/dashboard.md.";

/** The http client transport was built in a browser — it starves at the ~6-connection HTTP/1.1 cap and
 *  ships a blank dashboard. `ws` is the browser transport. A hard failure, not a warning: the
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

/** A Unix-domain / named-pipe ipc transport was built in a browser — IpcSocket is Node-only. Die loud
 *  with a clear "use ws" pointer instead of a cryptic `@effect/platform-node` dynamic-import failure,
 *  mirroring {@link dieIfHttpClientInBrowser}. @internal */
class IpcInBrowser extends Data.TaggedError("IpcInBrowser")<{
  readonly message: string;
}> {}

const dieIfIpcInBrowser = Effect.suspend(() =>
  typeof window === "undefined"
    ? Effect.void
    : Effect.die(
        new IpcInBrowser({
          message:
            "Hyperlink.protocolIpc / unix / nPipe cannot run in a browser: IpcSocket is a Node-only " +
            "Unix-domain / named-pipe transport. Use Hyperlink.ws (WebSocket) for the browser.",
        }),
      ),
);

/**
 * Wire a {@link Node}'s transport over **http** — the server/CLI/backend case. Builds the http client
 * `Protocol` (Fetch + serialization) from a `url` and re-keys it under the node. Serialization defaults
 * to {@link defaultSerialization} (ndjson), matching {@link httpServer}'s default so the two sides agree
 * by construction. **In a browser this fails hard** (`HttpClientInBrowser`) — http starves at the
 * ~6-connection cap; use {@link ws} there.
 *
 * ```ts
 * const EdgeLive = Hyperlink.http(EdgeNode, { url: "http://10.0.0.2:3002/rpc" });
 * ```
 *
 * @category clients
 * @public
 */
const http = <Self>(
  node: NodeKey<Self> & { readonly url?: string; readonly endpoints?: Endpoints },
  options?: {
    readonly url?: string;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self> =>
  // The client sibling of {@link Node.http} = `connect` + {@link protocolHttp}. Prefers the node's own
  // Http endpoint (multi-protocol), then its primary `url`, then `"/rpc"` (same-origin) — `options.url`
  // overrides. The browser guard lives in `protocolHttp` (the root), so it applies here too.
  connectLayer(
    node,
    protocolHttp(
      options?.url ?? node.endpoints?.Http?.url ?? node.url ?? "/rpc",
      options?.serialization,
    ),
  );

// Normalize a `ws` url to `ws://` / `wss://`, resolved **lazily** (in the enclosing
// `Effect.sync`, at layer-build time) so the module doesn't read `location` at import — `ws`
// is called at module scope in files a Node server also imports. Accepts an absolute `ws(s)://` url
// (used as-is), an `http(s)://` url (scheme swapped), or a same-origin **path** like `"/rpc"`
// (resolved against the page `location`, so the browser follows its own host + http/https→ws/wss).
const toWebSocketUrl = (raw: string): string => {
  if (raw.startsWith("ws://") || raw.startsWith("wss://")) return raw;
  if (raw.startsWith("http://")) return `ws://${raw.slice(7)}`;
  if (raw.startsWith("https://")) return `wss://${raw.slice(8)}`;
  if (typeof location === "undefined") {
    throw new Error(
      `Hyperlink.ws: a relative url ("${raw}") resolves against the browser's location; ` +
        `pass an absolute ws:// / wss:// url when not in a browser`,
    );
  }
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${raw.startsWith("/") ? raw : `/${raw}`}`;
};

/**
 * The **standard way to set the RPC client transport**: hand it any `RpcClient.Protocol` layer and
 * it becomes the ambient transport that every nodeless {@link Hyperlink.client} — and each node's
 * {@link peers} fold — reads. This is the primitive; {@link protocolHttp} / {@link protocolWebsocket}
 * build the two common protocols, and {@link ws} / {@link http} are per-node
 * shortcuts layered on top. Provide it once and the whole app agrees on a wire:
 *
 * ```ts
 * Effect.provide(app, Hyperlink.layerProtocol(Hyperlink.protocolWebsocket())); // one knob
 * Effect.provide(app, Hyperlink.layerProtocol(Hyperlink.protocolHttp("http://edge/rpc")));
 * ```
 *
 * @category transports
 * @public
 */
export const layerProtocol = (
  protocol: Layer.Layer<RpcClient.Protocol>,
): Layer.Layer<RpcClient.Protocol> => protocol;

/**
 * The default **host** a bare-**port** client shorthand resolves against — an Effect {@link Config}
 * (`HYPERLINK_CLIENT_HOST`) defaulting to `"localhost"`. In dev nothing is set → `localhost`; in
 * production set it (`HYPERLINK_CLIENT_HOST=api.myapp.com`) and every `protocolHttp(3009)` /
 * `protocolWebsocket(3009)` / `connect(tag, …(port))` becomes `…://api.myapp.com:3009/rpc` — no
 * `NODE_ENV` branching, just "did they configure a host". @category transports @public
 */
export const clientHost: Config.Config<string> = Config.string(
  "HYPERLINK_CLIENT_HOST",
).pipe(Config.withDefault("localhost"));

/** A bare **port** (`3009`) / `":3009"` resolves to `${scheme}://${clientHost}:port/rpc` (Config host,
 *  read at layer build); a path / full url passes through unchanged. @internal */
const clientTargetUrl = (
  scheme: "http" | "ws",
  target: number | string,
): Effect.Effect<string> => {
  // `clientHost` has a default, so a residual ConfigError means a malformed config source — a boot
  // misconfiguration, not a per-call failure; die rather than thread it onto every client's channel.
  const host = Effect.orDie(clientHost);
  if (typeof target === "number") {
    return Effect.map(host, (h) => `${scheme}://${h}:${target}/rpc`);
  }
  if (/^:\d+$/.test(target)) {
    return Effect.map(host, (h) => `${scheme}://${h}${target}/rpc`);
  }
  return Effect.succeed(target);
};

/**
 * Build an **http** client `Protocol` (Fetch + ndjson serialization) for an endpoint — the value you
 * hand {@link layerProtocol} or {@link connect}. `target` is a **port** (`3009` → `http://${clientHost}:3009/rpc`,
 * Config host default `"localhost"`), a full url, or a same-origin path (default `"/rpc"`). The
 * server/CLI transport; a browser should prefer {@link protocolWebsocket} (HTTP/1.1's ~6-connection cap
 * starves streams — `protocolHttp` dies loudly in a browser).
 *
 * @category transports
 * @public
 */
export const protocolHttp = (
  target: number | string = "/rpc",
  serialization: Layer.Layer<RpcSerialization.RpcSerialization> = defaultSerialization,
): Layer.Layer<RpcClient.Protocol> => {
  // guard at the root: `http` / `connect` all build on this, so the browser footgun is closed for
  // every http-client path in one place.
  const build = (url: string): Layer.Layer<RpcClient.Protocol> =>
    Layer.merge(
      RpcClient.layerProtocolHttp({ url }).pipe(
        Layer.provide(serialization),
        Layer.provide(FetchHttpClient.layer),
      ),
      Layer.effectDiscard(dieIfHttpClientInBrowser),
    );
  // A bare port defers to the `clientHost` Config (layer build); a path / url stays sync.
  return typeof target === "number" || /^:\d+$/.test(target)
    ? Layer.unwrap(Effect.map(clientTargetUrl("http", target), build))
    : build(target);
};

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
  target: number | string = "/rpc",
  serialization: Layer.Layer<RpcSerialization.RpcSerialization> = defaultSerialization,
): Layer.Layer<RpcClient.Protocol> => {
  const build = (url: string): Layer.Layer<RpcClient.Protocol> =>
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(serialization),
      Layer.provide(Socket.layerWebSocket(Effect.sync(() => toWebSocketUrl(url)))),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
    );
  // A bare port defers to the `clientHost` Config (→ `ws://${host}:port/rpc`); a path / url stays sync.
  return typeof target === "number" || /^:\d+$/.test(target)
    ? Layer.unwrap(Effect.map(clientTargetUrl("ws", target), build))
    : build(target);
};

/**
 * Dial a HyperService `tag` over a transport **you provide** — the no-batteries client. `connect` bakes in
 * **no** transport of its own (unlike {@link http} / {@link ws} / {@link unix} / {@link nPipe}, whose
 * wire is in the name and bundled): you hand it a {@link protocolHttp} / {@link protocolWebsocket} /
 * {@link protocolIpc} layer, so a browser build pulls in only the one wire it passes.
 *
 * ```ts
 * program.pipe(Effect.provide(Hyperlink.connect(Emails, Hyperlink.protocolHttp(3009))));       // server
 * program.pipe(Effect.provide(Hyperlink.connect(Emails, Hyperlink.protocolWebsocket("/rpc")))); // browser (ws only)
 * ```
 *
 * The port shorthand (`3009`) resolves against {@link clientHost} (default `"localhost"`), so the same
 * `3009` points at your production host once `HYPERLINK_CLIENT_HOST` is set.
 *
 * Replaces the retired `clientHttp(tag, target)` — use `connect(tag, protocolHttp(target))`.
 *
 * @category clients
 * @public
 */
export const connect = <Self, S extends Spec, E = never>(
  tag: HyperlinkTag<Self, S>,
  protocol: Layer.Layer<RpcClient.Protocol, E>,
): Layer.Layer<Self, E | ValueErrorsOf<S>> =>
  clientLayer(tag).pipe(Layer.provide(protocol));

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
 * {@link http}. Every stream (each HyperService's `status` + `metrics` + `logs`) rides **one
 * multiplexed connection**, so a dashboard never trips the browser's ~6-connection-per-origin
 * HTTP/1.1 limit that starves streams over {@link http} (in a browser {@link http} now
 * fails hard — see its note). The server must be a {@link wsServer}.
 *
 * The `url` may be a same-origin **path** (`"/rpc"` — resolved against the page `location`, so the
 * browser follows its own host + scheme, `http→ws` / `https→wss`), an `http(s)://` url (scheme
 * swapped), or an absolute `ws(s)://` url. Resolution is lazy, so this is safe to call at module
 * scope in a file a Node server also imports. Uses the browser's global `WebSocket`.
 *
 * ```ts
 * const EdgeLive = Hyperlink.ws(EdgeNode, { url: "/rpc" }); // same origin as the page
 * ```
 *
 * @category clients
 * @public
 */
const ws = <Self>(
  node: NodeKey<Self> & { readonly url?: string; readonly endpoints?: Endpoints },
  options?: {
    readonly url?: string;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self, NodeUnreachable | UnaddressedNode> => {
  // The client sibling of {@link Node.ws} = `connect` + {@link protocolWebsocket}. Prefers the node's
  // own WebSocket endpoint (multi-protocol — its primary `url` is the Http one on an `{ http, ws }`
  // node), then the primary `url`, then `"/rpc"`; `options.url` overrides.
  const url =
    options?.url ?? node.endpoints?.WebSocket?.url ?? node.url ?? "/rpc";
  const wired = connectLayer(
    node,
    protocolWebsocket(url, options?.serialization),
  );
  return Layer.unwrap(
    Effect.gen(function* () {
      // Relative same-origin paths (`"/rpc"`) are the browser dial target. Resolve to `ws(s)://`
      // when `location` exists so verify probes WebSocket (not Http GET). Elsewhere skip — do
      // **not** fall through to the addressed node's stamped `127.0.0.1` (that reintroduces F5).
      if (isProbeableAddress({ url })) {
        yield* applyClientVerify(node as AnyNode, { url });
      } else if (typeof location !== "undefined") {
        yield* applyClientVerify(node as AnyNode, { url: toWebSocketUrl(url) });
      }
      return wired;
    }),
  ) as Layer.Layer<Self, NodeUnreachable | UnaddressedNode>;
};

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
    // guard BEFORE the node-only dynamic import, so a browser gets the clear die (not the import error).
    dieIfIpcInBrowser.pipe(
      Effect.andThen(Effect.promise(() => import("@effect/platform-node"))),
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

// [extracted to Node module — was Hyperlink.ts:4539-4649]

/**
 * Per-node ipc dial — {@link connect} + {@link protocolIpc}. Shared by {@link unix}`(node)` and
 * {@link nPipe}. Tag / Lookup discovery is the other {@link unix} overload (defined with
 * {@link DiscoverClientOptions} below).
 *
 * @internal
 */
const unixNodeDial = <Self>(
  node: NodeKey<Self> & { readonly path?: string; readonly endpoints?: Endpoints },
  options?: {
    readonly path?: string;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self, UnaddressedNode> => {
  const sock = options?.path ?? node.endpoints?.IpcSocket?.path ?? node.path;
  if (sock === undefined) {
    return unaddressedLayer(node.key);
  }
  return connectLayer(node, protocolIpc(sock, options?.serialization));
};

/** Dial a {@link Node} over a **Windows named pipe** — the client sibling of {@link Node.nPipe}.
 *  Same ipc dial as {@link unix}`(node)` (the `path` is a `\\.\pipe\…` name). @public @category clients */
const nPipe = unixNodeDial;

// [extracted to Node module — was Hyperlink.ts:4669-4685]

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
    // Absolute `ws(s)://` → WebSocket; absolute `http(s)://` → Http; relative same-origin
    // paths (`"/rpc"`, Hyperlink.ws browser override) → WebSocket (never Http GET — that
    // mis-classifies the dial and trips InvalidUrl / a bare GET that isn't the RPC transport).
    const kind: ProtocolKind =
      url.startsWith("ws://") || url.startsWith("wss://")
        ? "WebSocket"
        : url.startsWith("http://") || url.startsWith("https://")
          ? "Http"
          : "WebSocket";
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
 * Tier-2/3/4: after transport is up, dial the reserved node-status RPC over the endpoint's
 * protocol. Failures classify as {@link ProtocolUnanswered}; optional `serviceKey` checks
 * served-key / readiness; optional `contractHash` compares the F4 wire fingerprint.
 *
 * Dynamic-imports the status tag so Hyperlink ⇄ nodeStatus stays acyclic.
 *
 * @internal
 */
const probeEndpointDeep = (
  nodeKey: string,
  ep: VerifyEndpoint,
  timeout: Duration.Input,
  serviceKey: string | undefined,
  expectedHash: string | undefined,
): Effect.Effect<
  void,
  | ProtocolUnanswered
  | ServiceNotServed
  | ServiceNotReady
  | ContractMismatch
  | UnaddressedNode
> => {
  const address = verifyAddressOf(ep);
  if (address === undefined) {
    return Effect.fail(new UnaddressedNode({ node: nodeKey }));
  }
  const dialTarget =
    ep.kind === "IpcSocket"
      ? makeNode()(`hyperlink-ts/verify/${nodeKey}`, { path: address })
      : makeNode()(`hyperlink-ts/verify/${nodeKey}`, {
          url: address,
          kind: ep.kind,
        });
  return Effect.gen(function* () {
    const { NodeStatusTag } = yield* Effect.promise(
      () => import("./internal/nodeStatus"),
    );
    // Skip default-on verify on this nested status client (we *are* the verify probe).
    const ctx = yield* Layer.build(
      clientLayer(NodeStatusTag, dialTarget).pipe(
        Layer.provide(clientVerify(false)),
      ),
    );
    const snap = yield* Effect.gen(function* () {
      const status = yield* NodeStatusTag;
      return yield* status.status.get;
    }).pipe(Effect.provide(ctx));
    if (serviceKey === undefined) {
      return;
    }
    const row = snap.services.find((r) => r.key === serviceKey);
    if (row === undefined) {
      return yield* new ServiceNotServed({
        node: nodeKey,
        url: address,
        serviceKey,
        served: snap.services.map((r) => r.key),
      });
    }
    if (!row.ready) {
      return yield* new ServiceNotReady({
        node: nodeKey,
        url: address,
        serviceKey,
        ...(row.detail !== undefined ? { detail: row.detail } : {}),
      });
    }
    if (expectedHash !== undefined && row.contractHash !== expectedHash) {
      return yield* new ContractMismatch({
        node: nodeKey,
        url: address,
        serviceKey,
        expected: expectedHash,
        actual: row.contractHash,
      });
    }
  }).pipe(
    Effect.scoped,
    Effect.timeout(timeout),
    Effect.mapError((cause) => {
      if (
        cause instanceof ServiceNotServed ||
        cause instanceof ServiceNotReady ||
        cause instanceof ContractMismatch ||
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

/** Options for deep (tier-2/3/4) {@link verifyConnection} — RPC + optional resource / F4 hash. @public */
export type VerifyConnectionDeepOptions = VerifyConnectionOptions & {
  readonly deep: true;
  /** When set, require this HyperService key in `Node.Status.services` and `ready: true`. */
  readonly serviceKey?: string;
  /**
   * Expected F4 {@link contractHash} for `serviceKey`. When set (requires `serviceKey`), mismatch
   * → {@link ContractMismatch}.
   */
  readonly contractHash?: string;
};

/**
 * **Verify a node is reachable, eagerly** — a fail-fast startup check for a remote {@link Node}.
 * Default: one bounded **transport** probe (tier 1) against the endpoint {@link connect} would
 * dial (`selectEndpoint`, or every endpoint with `{ all: true }`). Fails
 * {@link NodeUnreachable} if nothing answers.
 *
 * With `{ deep: true }`, escalates after transport OK: dials the node's auto-served status
 * RPC over that endpoint. Transport up but RPC silent → {@link ProtocolUnanswered}; optional
 * `serviceKey` key → {@link ServiceNotServed} / {@link ServiceNotReady}; optional
 * `contractHash` → {@link ContractMismatch} (F4).
 *
 * ```ts
 * yield* Hyperlink.verifyConnection(Droplet);                          // tier 1
 * yield* Hyperlink.verifyConnection(Droplet, { timeout: "1 second" });
 * yield* Hyperlink.verifyConnection(Droplet, { deep: true });          // + node status RPC
 * yield* Hyperlink.verifyConnection(Droplet, {
 *   deep: true,
 *   serviceKey: Emails.key,
 *   contractHash: Hyperlink.contractHash(Emails),
 * });
 * yield* Hyperlink.verifyConnection(Droplet, { all: true });           // every endpoint
 * ```
 *
 * Complements {@link connect}: `connect` prevents mis-wiring the client transport;
 * `verifyConnection` catches a peer that isn't there (or, with `deep`, isn't speaking RPC /
 * isn't serving the HyperService you need / has a stale contract).
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
): Effect.Effect<void, ClientVerifyError>;
export function verifyConnection(
  node: AnyNode,
  options?: VerifyConnectionOptions & {
    readonly deep?: boolean;
    readonly serviceKey?: string;
    readonly contractHash?: string;
  },
): Effect.Effect<void, ClientVerifyError> {
  const endpoints = verifyEndpointsOf(node, options);
  if (endpoints instanceof UnaddressedNode) {
    return Effect.fail(endpoints);
  }
  const timeout = options?.timeout ?? "3 seconds";
  const deep = options?.deep === true;
  const serviceKey = options?.serviceKey;
  const expectedHash = options?.contractHash;
  return Effect.forEach(
    endpoints,
    (ep) =>
      Effect.gen(function* () {
        yield* probeEndpointReachable(node.key, ep, timeout);
        if (deep) {
          yield* probeEndpointDeep(node.key, ep, timeout, serviceKey, expectedHash);
        }
      }),
    { discard: true },
  );
}

/** Absolute dial targets we can probe at layer build (skip relative same-origin `/rpc`). */
const isProbeableAddress = (options?: {
  readonly url?: string;
  readonly path?: string;
}): boolean =>
  options?.path !== undefined ||
  (options?.url !== undefined &&
    (options.url.startsWith("http://") ||
      options.url.startsWith("https://") ||
      options.url.startsWith("ws://") ||
      options.url.startsWith("wss://")));

/** Tag-aware default-on verify options — deep + serviceKey + F4 hash. @internal */
type ClientVerifyProbeOptions = VerifyConnectionOptions & {
  readonly serviceKey?: string;
  readonly contractHash?: string;
};

/**
 * Default-on client verify (§8.6) — `"reject"` unless {@link ClientVerify} overrides.
 * When `serviceKey` + `contractHash` are set (tag-aware clients), escalates to deep F3/F4.
 * @internal
 */
const applyClientVerify = (
  node: AnyNode,
  options?: ClientVerifyProbeOptions,
): Effect.Effect<void, ClientVerifyError> =>
  Effect.gen(function* () {
    const mode = yield* ClientVerify;
    if (mode === false) {
      return;
    }
    // Relative same-origin URL overrides (`"/rpc"`) are the dial target but not absolute
    // probe addresses. Skip even when the node is addressed — otherwise verify keeps the
    // relative url, classifies it as Http, and/or falls through to probing the stamp
    // (`127.0.0.1`) while the runtime dials the vite proxy (F5).
    if (options?.url !== undefined && !isProbeableAddress({ url: options.url })) {
      return;
    }
    if (
      !isAddressedNode(node) &&
      options?.url === undefined &&
      options?.path === undefined
    ) {
      return;
    }
    const deep =
      options?.serviceKey !== undefined && options.contractHash !== undefined;
    const probe = deep
      ? verifyConnection(node, {
          ...options,
          deep: true,
          serviceKey: options.serviceKey,
          contractHash: options.contractHash,
        })
      : verifyConnection(node, options);
    if (mode === "status") {
      yield* Effect.ignore(Effect.exit(probe));
      return;
    }
    yield* probe;
  });

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
 * class Mail extends Hyperlink.Tag<Mail>()("app/Mail", spec).pipe(
 *   Hyperlink.nodes([WorkerA]), // or Hyperlink.andNode(WorkerA)
 * ) {}
 * class Pool extends Hyperlink.Tag<Pool>()("app/Pool", spec).pipe(
 *   Hyperlink.nodes([A, B, C]),
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
    tag: HyperlinkTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    nodeSet: readonly [AddressedNode<HSelf>],
  ): SoleNodeBind<
    NodeBoundTag<Self, S, HSelf>,
    AddressedNode<HSelf>
  >;
  <Self, S extends Spec, HSelf>(
    tag: HyperlinkTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    nodeSet: readonly [NodeKey<HSelf>],
  ): SoleNodeBind<NodeBoundTag<Self, S, HSelf>, NodeKey<HSelf>>;
  <Self, S extends Spec, HSelf>(
    tag: NodeBoundTag<Self, S, HSelf>,
    nodeSet: ReadonlyArray<AnyNode>,
  ): NodeBoundTag<Self, S, HSelf>;
  <Self, S extends Spec>(
    tag: HyperlinkTag<Self, S>,
    nodeSet: ReadonlyArray<AnyNode>,
  ): HyperlinkTag<Self, S>;
} = Fn.dual(
  2,
  <T extends HyperlinkTag<any, any, any>>(
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
 * class Mail extends Hyperlink.Tag<Mail>()("app/Mail", spec).pipe(
 *   Hyperlink.andNode(Worker), // ≡ nodes([Worker]) when starting empty
 * ) {}
 * class PoolPlus extends PoolBase.pipe(Hyperlink.andNode(StatsNode)) {}
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
    tag: HyperlinkTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    node: AddressedNode<HSelf>,
  ): AndNodeResult<
    HyperlinkTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    AddressedNode<HSelf>
  >;
  <Self, S extends Spec, HSelf>(
    tag: HyperlinkTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    node: NodeKey<HSelf>,
  ): AndNodeResult<
    HyperlinkTag<Self, S> | NodeBoundTag<Self, S, HSelf>,
    NodeKey<HSelf>
  >;
  <Self, S extends Spec, HSelf>(
    tag: NodeBoundTag<Self, S, HSelf>,
    node: AnyNode,
  ): NodeBoundTag<Self, S, HSelf>;
  <Self, S extends Spec>(
    tag: HyperlinkTag<Self, S>,
    node: AnyNode,
  ): HyperlinkTag<Self, S>;
} = Fn.dual(
  2,
  <T extends HyperlinkTag<any, any, any>>(tag: T, node: AnyNode): T => {
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
  tag: HyperlinkTag<Self, S>,
): ReadonlyArray<AnyNode> => tag[nodesSym] ?? [];

/**
 * Stamp a **discoverable** empty Node set (D3) — `.pipe(Hyperlink.distributed)` ≡
 * {@link nodes}`([])`. {@link peersLayer} then reads Lookup `Directory.nodesServing`.
 *
 * For a **fixed** fleet list, use {@link nodes}`([A, B])` (not this pipe). Identity-shaped
 * like {@link identity} so `class extends Tag()(…).pipe(Hyperlink.distributed)` type-checks.
 *
 * @category nodes & fleet
 * @public
 */
export const distributed = <T extends PipeableTag>(tag: T): T =>
  nodes(tag as unknown as HyperlinkTag<any, any, any>, []) as unknown as T;

/**
 * Alias of {@link nodesOf}.
 *
 * @category nodes & fleet
 * @public
 */
export const distributedOf = nodesOf;

/**
 * Mark a Tag as **identity-claiming** (S1): {@link layer} / {@link serve} claim the HyperService key at
 * Lookup first — winner runs the local impl; loser becomes a client of the winner's endpoint.
 * Requires {@link LookupIdentity} in the layer graph (fail-closed if Lookup is down).
 *
 * Pipe onto any Hyperlink / Daemon / Queue tag (same shape as {@link withReadiness}):
 *
 * ```ts
 * class Mail extends Hyperlink.Tag<Mail>()("app/Mail", spec).pipe(Hyperlink.identity) {}
 *
 * // bind a Node on the Tag (or listen with ListenNode) — Lookup decides winner/loser:
 * class Mail extends Hyperlink.Tag<Mail>()("app/Mail", spec, { node: ThisNode }).pipe(
 *   Hyperlink.identity,
 * ) {}
 * Hyperlink.serve(Mail, impl).pipe(Layer.provide(Lookup.client(lookupNode)))
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

/** Dial target resolved by {@link lookupClient}. @internal */
type LookupDialEndpoint = {
  readonly nodeKey: string;
  readonly kind: ProtocolKind;
  readonly url?: string;
  readonly path?: string;
};

const lookupDialKey = (endpoint: LookupDialEndpoint): string =>
  `${endpoint.nodeKey}\0${endpoint.kind}\0${endpoint.url ?? ""}\0${endpoint.path ?? ""}`;

/** Define a live getter at a (possibly dotted) path. @internal */
const definePathGetter = (
  obj: Record<string, unknown>,
  path: string,
  get: () => unknown,
): void => {
  const parts = path.split(".");
  const last = parts.pop();
  if (last === undefined) return;
  let node = obj;
  for (const part of parts) {
    const next = node[part];
    if (next === undefined || typeof next !== "object" || next === null) {
      node[part] = {};
    }
    node = node[part] as Record<string, unknown>;
  }
  Object.defineProperty(node, last, {
    enumerable: true,
    configurable: true,
    get,
  });
};

/**
 * True when a lookup-client RPC failed on the transport (peer gone / socket closed
 * mid-call). App-declared errors and remapped {@link ProtocolMismatch} stay out.
 *
 * @internal
 */
const isLookupDialTransportError = (err: unknown): boolean =>
  Predicate.hasProperty(err, "_tag") && err._tag === "RpcClientError";

/**
 * Stable service facade that always reads {@link holder}.current — so Directory
 * dial swaps can replace the underlying client without changing the Context value.
 *
 * Effect methods (query / mutate) run through {@link withDialRetry} once so a brief
 * A→B rebind gap does not surface `RpcClientError` to the app. Streams / refs are
 * not auto-retried (resubscribe after rebind).
 *
 * @internal
 */
const makeLiveLookupService = <Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
  holder: { current: ServiceOf<S, Self> },
  withDialRetry: <A, E, R>(
    run: () => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>,
): ServiceOf<S, Self> => {
  const service: Record<string, unknown> = {};
  const cap = tag[localCapSym];
  for (const [path, m] of Object.entries(tag[specSym])) {
    if (isLocalMethod(m)) {
      setPath(
        service,
        path,
        Effect.flatMap(cap, () =>
          Effect.die(new LocalOnlyMethod({ method: path })),
        ),
      );
    } else if (isDefaultMethod(m)) {
      setPath(service, path, m.value);
    } else if (isValueMethod(m)) {
      definePathGetter(service, path, () => getPath(holder.current, path));
    } else if (isRefMethod(m)) {
      setPath(service, path, {
        get: withDialRetry(() => {
          const sub = getPath(holder.current, path) as {
            readonly get: Effect.Effect<unknown>;
          };
          return sub.get;
        }),
        changes: Stream.unwrap(
          Effect.sync(() => {
            const sub = getPath(holder.current, path) as {
              readonly changes: Stream.Stream<unknown>;
            };
            return sub.changes;
          }),
        ),
      });
    } else if (Predicate.hasProperty(m, "stream") && m.stream === true) {
      setPath(
        service,
        path,
        Stream.unwrap(
          Effect.sync(
            () => getPath(holder.current, path) as Stream.Stream<unknown>,
          ),
        ),
      );
    } else if (m.payload === undefined) {
      setPath(
        service,
        path,
        withDialRetry(
          () => getPath(holder.current, path) as Effect.Effect<unknown>,
        ),
      );
    } else {
      setPath(service, path, (...args: ReadonlyArray<unknown>) =>
        withDialRetry(() => {
          const member = getPath(holder.current, path) as (
            ...a: ReadonlyArray<unknown>
          ) => Effect.Effect<unknown>;
          return member(...args);
        }),
      );
    }
  }
  return service as ServiceOf<S, Self>;
};

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
 * **Hot-rebind:** after the initial resolve, watches {@link Lookup.Directory}`changes`
 * and rebuilds the dial when the chosen endpoint moves (`dialChanged`) or membership
 * for this service key changes — same plane as directory {@link peersLayer}. The prior
 * dial stays live until the next dial builds successfully (no close-first gap).
 *
 * **Transparent retry (Track D v1):** Effect RPCs that fail with `RpcClientError` wait
 * briefly for a successful rebind (or proactively resolve once), then retry **once** on
 * the new dial. Prefer B Directory-visible / Advice-preferred before A leaves so the
 * wait has a target. Streams are not auto-retried. Mutates retry once too — keep them
 * idempotent when cutover-safe.
 *
 * Bake name sketch was `unsafeLookupClient` (“trust Lookup or die”); bare
 * `lookupClient(Tag)` keeps that fail-closed contract when advice is absent/stale.
 *
 * ```ts
 * // Sole endpoint (identity winner or one directory row):
 * Hyperlink.lookupClient(Mail).pipe(Layer.provide(Lookup.layer))
 *
 * // Coordinator published advice — bare client honors prefer:
 * yield* Lookup.advise({ serviceKey: Mail.key, prefer: "fleet/Mail#w2" })
 * Hyperlink.lookupClient(Mail)
 *
 * // N>1 replicas — opt-in pick when no advice (still fail on 0):
 * Hyperlink.lookupClient(Mail, { pick: "first" })
 *
 * // You already know an addressed Node — client auto-connects:
 * Hyperlink.client(Mail, East)
 * ```
 *
 * @category clients
 * @public
 */
export const lookupClient = <Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
  options?: LookupClientOptions,
): Layer.Layer<
  Self,
  LookupClientError,
  LookupIdentity | LookupDirectory | LookupAdvice
> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      const Lookup = yield* Effect.promise(() => import("./Lookup"));
      const identity = yield* Lookup.Identity;
      const directory = yield* Lookup.Directory;
      const advice = yield* Lookup.Advice;
      const serviceKey = tag[wireKeySym];

      // Closed over Identity/Directory/Advice services so call-time dial retry
      // does not re-require Lookup tags in the app Effect's R.
      const resolve = Effect.gen(function* () {
        const resolved = yield* identity.resolve(
          new Lookup.ResolveRequest({ key: tag.key }),
        );
        if (Option.isSome(resolved)) {
          return resolved.value satisfies LookupDialEndpoint;
        }
        const entries = yield* directory.nodesServing(
          new Lookup.NodesServingRequest({ serviceKey: tag.key }),
        );
        if (entries.length === 0) {
          return yield* new LookupClientError({
            tag: tag.key,
            reason: "missing",
            count: 0,
          });
        }
        if (entries.length === 1) {
          return entries[0]!;
        }
        const prefer = yield* advice.preferred(
          new Lookup.PreferredRequest({ serviceKey: tag.key }),
        );
        if (Option.isSome(prefer)) {
          const advised = entries.find((row) => row.nodeKey === prefer.value);
          if (advised !== undefined) {
            return advised;
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
        return pick === "first" ? entries[0]! : pick(entries);
      });

      let clientScope: Scope.Closeable | undefined;
      const holder: { current: ServiceOf<S, Self> } = {
        current: null as unknown as ServiceOf<S, Self>,
      };
      const generation = yield* Ref.make(0);
      const installGen = yield* SubscriptionRef.make(0);
      const installGate = yield* Semaphore.make(1);

      /** Build next dial first; swap + close prior only on success (real keep-prior). */
      const install = (endpoint: LookupDialEndpoint): Effect.Effect<void> =>
        installGate.withPermits(1)(
          Effect.gen(function* () {
            const scope = yield* Scope.make();
            const built = yield* Layer.build(
              clientLayerForEndpoint(tag, endpoint),
            ).pipe(Scope.provide(scope), Effect.exit);
            if (Exit.isFailure(built)) {
              yield* Scope.close(scope, Exit.void);
              return yield* Effect.fail(
                new LookupClientError({
                  tag: tag.key,
                  reason: "missing",
                  count: 0,
                }),
              );
            }
            const prev = clientScope;
            clientScope = scope;
            holder.current = Context.get(built.value, tag);
            const gen = yield* Ref.updateAndGet(generation, (n) => n + 1);
            yield* SubscriptionRef.set(installGen, gen);
            if (prev !== undefined) {
              yield* Scope.close(prev, Exit.void);
            }
          }),
        );

      const endpoint = yield* resolve;
      yield* install(endpoint);
      let currentKey = lookupDialKey(endpoint);
      let currentNodeKey = endpoint.nodeKey;

      yield* directory.changes.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event._tag === "DirectoryRemoved") {
              if (event.nodeKey !== currentNodeKey) return;
            } else {
              const servesUs =
                event.entry.serves.includes(serviceKey) ||
                event.entry.serves.includes(tag.key);
              const isCurrent = event.entry.nodeKey === currentNodeKey;
              if (!servesUs && !isCurrent) return;
              if (
                isCurrent &&
                servesUs &&
                event.previous !== undefined &&
                !event.dialChanged
              ) {
                return;
              }
            }
            const next = yield* Effect.option(resolve);
            if (Option.isNone(next)) return;
            const nextKey = lookupDialKey(next.value);
            if (nextKey === currentKey) return;
            const installed = yield* Effect.exit(install(next.value));
            if (Exit.isSuccess(installed)) {
              currentKey = nextKey;
              currentNodeKey = next.value.nodeKey;
              return;
            }
            yield* Effect.logWarning(
              "lookupClient rebind failed; keeping prior dial",
            ).pipe(
              Effect.annotateLogs({
                "lookupClient.tag": tag.key,
                "lookupClient.node": next.value.nodeKey,
              }),
            );
          }),
        ),
        Effect.forkScoped,
      );

      const withDialRetry = <A, E, R>(
        run: () => Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E, R> =>
        Effect.suspend(run).pipe(
          Effect.catch((err: E) => {
            if (!isLookupDialTransportError(err)) {
              return Effect.fail(err);
            }
            return Effect.gen(function* () {
              const before = yield* Ref.get(generation);
              const next = yield* Effect.option(resolve);
              if (Option.isSome(next)) {
                const nextKey = lookupDialKey(next.value);
                if (nextKey !== currentKey) {
                  const installed = yield* Effect.exit(install(next.value));
                  if (Exit.isSuccess(installed)) {
                    currentKey = nextKey;
                    currentNodeKey = next.value.nodeKey;
                  }
                }
              }
              if ((yield* Ref.get(generation)) <= before) {
                yield* SubscriptionRef.changes(installGen).pipe(
                  Stream.filter((g) => g > before),
                  Stream.take(1),
                  Stream.runDrain,
                  Effect.timeoutOption(Duration.seconds(2)),
                  Effect.asVoid,
                );
              }
              if ((yield* Ref.get(generation)) <= before) {
                return yield* Effect.fail(err);
              }
              return yield* Effect.suspend(run);
            });
          }),
        );

      yield* Effect.addFinalizer(() =>
        clientScope === undefined
          ? Effect.void
          : Scope.close(clientScope, Exit.void),
      );

      return makeLiveLookupService(tag, holder, withDialRetry);
    }),
  ) as Layer.Layer<
    Self,
    LookupClientError,
    LookupIdentity | LookupDirectory | LookupAdvice
  >;

/**
 * Options for {@link unix}`(tag)` / {@link discoverClients} — Lookup soft-pick plus
 * default-lookup bootstrap knobs (`lookupPath`, `unlink`).
 *
 * @category models
 * @public
 */
export type DiscoverClientOptions = LookupClientOptions & {
  readonly lookupPath?: string;
  readonly unlink?: boolean;
};

/** True when `u` is a Hyperlink resource Tag (`specSym`), not a {@link Node}. @internal */
const isUnixDiscoverTag = (u: unknown): u is HyperlinkTag<any, any> =>
  (typeof u === "object" || typeof u === "function") &&
  u !== null &&
  specSym in u;

/**
 * Lookup bootstrap + {@link lookupClient} for one tag — body of {@link unix}`(tag)`.
 *
 * @internal
 */
const unixDiscoverDial = <Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
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

/**
 * Same-machine ipc client — sibling of {@link Node.unix}.
 *
 * - **`unix(node)`** — dial that Node’s Unix-domain path (`connect` + {@link protocolIpc}).
 * - **`unix(tag)`** — nameless / Lookup path: soft-bake Lookup, resolve an endpoint for `tag`,
 *   and dial it (identity, then directory). Pairs with nameless {@link Node.unix}`([serve…])`.
 *
 * ```ts
 * // Named node you already addressed:
 * Hyperlink.unix(Worker)
 *
 * // Nameless serve advertised via Lookup:
 * Hyperlink.unix(Emails)
 * Hyperlink.unix(Jobs, { lookupPath, pick: "first" })
 * ```
 *
 * @category clients
 * @public
 */
function unix<Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
  options?: DiscoverClientOptions,
): Layer.Layer<Self, LookupClientError>;
function unix<Self>(
  node: NodeKey<Self> & { readonly path?: string; readonly endpoints?: Endpoints },
  options?: {
    readonly path?: string;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<Self, UnaddressedNode>;
function unix(
  tagOrNode: unknown,
  options?: DiscoverClientOptions & {
    readonly path?: string;
    readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  },
): Layer.Layer<unknown, LookupClientError | UnaddressedNode> {
  if (isUnixDiscoverTag(tagOrNode)) {
    return unixDiscoverDial(tagOrNode, options);
  }
  return unixNodeDial(
    tagOrNode as NodeKey<unknown> & {
      readonly path?: string;
      readonly endpoints?: Endpoints;
    },
    options,
  );
}

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
 * {@link unix}`(tag)` for many tags — one Lookup bootstrap, then
 * {@link Layer.mergeAll} of each {@link lookupClient}.
 *
 * Options (`lookupPath`, `pick`, …) ride the **array** form; rest uses Lookup defaults.
 *
 * ```ts
 * Hyperlink.discoverClients([Jobs, Emails], { lookupPath })
 * Hyperlink.discoverClients(Jobs, Emails)
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
    lookupClient(tag as HyperlinkTag<any, any>, clientOptions),
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

// [extracted to Node module — was Hyperlink.ts:5053-5132]

/**
 * Build a **peer** service — a fully **lazy** client for folding across nodes ({@link combineQuery} /
 * {@link combineStream}). Unlike {@link buildClientService} it never resolves `value`s or subscribes
 * `value` fields at build: those open a connection and (for a `value`) block on the initial push, so a
 * co-booting or down peer would hang the whole serve. A `value` is read **one-shot** here (`Stream.runHead`
 * → its replayed current), so the network is touched only when a fold runs, and `combineQuery` drops an
 * unreachable peer instead of deadlocking at build. @internal
 */
const buildPeerService = <Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
  rpc: unknown,
): PeerServiceOf<S> => {
  const wire = forwardClient(rpc, tag[specSym], tag[wireKeySym], tag.key) as Record<
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
      // effect / effectFn / stream / value — already their lazy wire form (Effect/Stream); no eager
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
  "hyperlink-ts/Hyperlink/peerProtocol",
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
 *   Layer.provide(Hyperlink.peersLayer(WorkerPool, ThisNode)),
 *   Layer.provide(Hyperlink.layerPeerProtocol(Hyperlink.protocolWebsocket)),
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
  tag: HyperlinkTag<Self, S>,
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
  tag: HyperlinkTag<Self, S>,
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
  tag: HyperlinkTag<Self, S>,
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
    new Error(`Hyperlink.peersLayer: peer "${target.key}" has no dial target`),
  );
};

/**
 * The HyperService's **peer clients** — the OTHER nodes' full services, keyed by node — for a HyperService's
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
  tag: HyperlinkTag<Self, S>,
): Effect.Effect<Record<string, PeerServiceOf<S>>, never, PeersId<Self>> => tag[peersSym];

/**
 * The node key this instance runs as — the **same key** its {@link peers} are keyed by. For folds that
 * key per node (`combineByNode`), so a HyperService's own logic can name its **own** row without
 * hand-threading the node key. Requires the {@link selfNodeLayer} / {@link peersLayer} capability:
 *
 * ```ts
 * fleetStatus: Effect.gen(function* () {
 *   const self = yield* Hyperlink.selfNode(FleetDatabase); // the node key I am
 *   const peers = yield* Hyperlink.peers(FleetDatabase);
 *   const byNode = yield* combineQuery(peers, (p) => p.status, combineByNode);
 *   return { ...byNode, [self]: yield* ownStatus }; // key my own row, consistently
 * })
 * ```
 *
 * @category nodes & fleet
 * @public
 */
export const selfNode = <Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
): Effect.Effect<string, never, SelfNodeId<Self>> => tag[selfNodeSym];

/**
 * Provide the {@link selfNode} capability on **this** node — the node key this instance runs as. Bundled
 * into {@link peersLayer} (so a mesh resource gets it for free); use this standalone when a HyperService
 * keys per node but doesn't gather peers, or alongside {@link peersFrom} in a test. No transport, no
 * failure path — just the identity.
 *
 * @category nodes & fleet
 * @public
 */
export const selfNodeLayer = <Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
  self: AnyNode,
): Layer.Layer<SelfNodeId<Self>> => Layer.succeed(tag[selfNodeSym], self.key);

/**
 * Provide the {@link peers} capability on **this** node: connect every OTHER node in the tag's
 * {@link distributed} / {@link nodes} set and expose them as the peer clients. Also provides the
 * {@link selfNode} capability (this node's key) for `byNode`-style folds. The **opt-in mesh** — add
 * it to a node's serve only where the HyperService's own logic reaches across nodes. `self` is the node
 * you are, so you're excluded from your own peer set.
 *
 * **Membership (D3):**
 * - **Fixed** — non-empty `options.nodes` or stamped `nodes([…])` / `distributed([…])`.
 * - **Directory** — stamped **empty** set (bare `.pipe(Hyperlink.distributed)` / `nodes([])`): read
 *   Lookup `Directory.nodesServing(tag.key)` at layer build, then **hot-rebind** on
 *   `Directory.changes` when a peer's dial moves (`dialChanged`) or membership changes.
 *   Soft empty map when Directory is absent.
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
  tag: HyperlinkTag<Self, S>,
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
        // Live rebind on Directory.changes when dial moves / peers appear or leave.
        if (stamped !== undefined && stamped.length === 0) {
          const Lookup = yield* Effect.promise(() => import("./Lookup"));
          const dirOpt = yield* Effect.serviceOption(Lookup.Directory);
          if (Option.isNone(dirOpt)) {
            return {} as Record<string, PeerServiceOf<S>>;
          }
          const directory = dirOpt.value;
          const serviceKey = tag[wireKeySym];
          type DialTarget = {
            readonly key: string;
            readonly kind: ProtocolKind;
            readonly url?: string;
            readonly path?: string;
          };
          const peersRecord = Object.create(null) as Record<
            string,
            PeerServiceOf<S>
          >;
          const peerScopes = new Map<string, Scope.Closeable>();

          const dialTargetOf = (row: {
            readonly nodeKey: string;
            readonly kind: ProtocolKind;
            readonly url?: string;
            readonly path?: string;
          }): DialTarget | undefined => {
            if (row.nodeKey === self.key) return undefined;
            if (row.kind === "IpcSocket" && row.path !== undefined) {
              return { key: row.nodeKey, kind: row.kind, path: row.path };
            }
            if (row.url !== undefined) {
              return { key: row.nodeKey, kind: row.kind, url: row.url };
            }
            return undefined;
          };

          const removePeer = (nodeKey: string): Effect.Effect<void> =>
            Effect.gen(function* () {
              const scope = peerScopes.get(nodeKey);
              if (scope === undefined) return;
              peerScopes.delete(nodeKey);
              delete peersRecord[nodeKey];
              yield* Scope.close(scope, Exit.void);
            });

          const upsertPeer = (row: {
            readonly nodeKey: string;
            readonly kind: ProtocolKind;
            readonly url?: string;
            readonly path?: string;
            readonly serves: ReadonlyArray<string>;
          }): Effect.Effect<void> =>
            Effect.gen(function* () {
              if (!row.serves.includes(serviceKey)) {
                yield* removePeer(row.nodeKey);
                return;
              }
              const target = dialTargetOf(row);
              if (target === undefined) {
                yield* removePeer(row.nodeKey);
                return;
              }
              yield* removePeer(row.nodeKey);
              const scope = yield* Scope.make();
              const client = yield* buildPeerClientAt(tag, target).pipe(
                Scope.provide(scope),
              );
              peerScopes.set(row.nodeKey, scope);
              peersRecord[row.nodeKey] = client;
            });

          const rows = yield* Lookup.nodesServing(tag).pipe(
            Effect.provideService(Lookup.Directory, directory),
          );
          yield* Effect.forEach(rows, upsertPeer, { discard: true });

          yield* directory.changes.pipe(
            Stream.runForEach((event) => {
              if (event._tag === "DirectoryRemoved") {
                return removePeer(event.nodeKey);
              }
              // New peer, dial moved, or serves list may add/remove this service key.
              if (
                event.previous === undefined ||
                event.dialChanged ||
                peersRecord[event.entry.nodeKey] === undefined ||
                !event.entry.serves.includes(serviceKey)
              ) {
                return upsertPeer(event.entry);
              }
              return Effect.void;
            }),
            Effect.forkScoped,
          );

          yield* Effect.addFinalizer(() =>
            Effect.forEach([...peerScopes.keys()], removePeer, {
              discard: true,
            }),
          );

          return peersRecord;
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
  tag: HyperlinkTag<Self, S>,
  peers: Record<string, PeerServiceOf<S>>,
): Layer.Layer<PeersId<Self>> => Layer.succeed(tag[peersSym], peers);

/**
 * A **fleet fold** of successful peer leaf picks keyed by node (plus {@link selfNode}). Soft on
 * down peers — failures are skipped (partial table). Prefer this for **optional** metric-style
 * aggregates. For **health**, use `hyperlink-ts/FleetHealth` (`Exit` → Reachable /
 * Unreachable) or `MultiNode.combineByNodeExit`.
 *
 * ```ts
 * // metric-style: missing peers omitted
 * inFlightByNode: Hyperlink.fleetHealth(FleetMetrics, (peer) => peer.snapshot.pipe(...), own)
 * ```
 *
 * Requires the {@link peersLayer} capability (which bundles {@link selfNode}). The only error /
 * requirement is `own`'s.
 *
 * @category nodes & fleet
 * @public
 */
export const fleetHealth = <Self, S extends Spec, A, EPick, EOwn, ROwn>(
  tag: HyperlinkTag<Self, S>,
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
 * (group-prefixed, id-pinned), and stub each {@link Hyperlink.local} member with a value that
 * requires the never-granted {@link Local} (so calling one through a client is a
 * compile error, and unreachable at runtime). Shared by both {@link clientLayer} paths.
 */
const buildClientService = <Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
  rpc: unknown,
): Effect.Effect<ServiceOf<S, Self>, ValueErrorsOf<S>, Scope.Scope> =>
  Effect.gen(function* () {
    const wire = forwardClient(rpc, tag[specSym], tag[wireKeySym], tag.key) as Record<
      string,
      unknown
    >;
    const cap = tag[localCapSym];
    // build directly into the nested shape (via setPath) so materialize `value`s write the object the
    // consumer holds; `wire` + `tag[specSym]` are flat path keys.
    const service: Record<string, unknown> = {};
    for (const [key, m] of Object.entries(tag[specSym])) {
      if (isLocalMethod(m)) {
        setPath(
          service,
          key,
          Effect.flatMap(cap, () => Effect.die(new LocalOnlyMethod({ method: key }))),
        );
      } else if (isDefaultMethod(m)) {
        // Tag-baked — same value the local layer installs (no wire round-trip).
        setPath(service, key, m.value);
      } else if (isValueMethod(m)) {
        // resolve the value's query once at acquire → a plain value (fails acquire on E)
        setPath(
          service,
          key,
          yield* (wire[key] as Effect.Effect<unknown, ValueErrorsOf<S>>),
        );
      } else if (isRefMethod(m)) {
        // a Subscribable over the RPC changes stream (one kept-open subscription → local cache)
        setPath(service, key, yield* clientSubscribable(wire[key] as Stream.Stream<unknown>));
      } else {
        setPath(service, key, wire[key]);
      }
    }
    // Piped defaults — same bag on the client (no wire). No impl overrides on the client path.
    applyDefaultsBag(
      service,
      (tag as { readonly [defaultsSym]?: DefaultsBag })[defaultsSym],
      undefined,
    );
    // Boundary assertion (runtime-safe): built from the spec, key-for-key.
    return service as ServiceOf<S, Self>;
  });

/**
 * The **client** layer for a serviceKey: drive it over RPC **as if it were local** — the exact
 * same `yield* Tag` code as the local layer, only the provided layer differs, so it doesn't
 * matter where the HyperService actually runs.
 *
 * Paths, by whether — and where — the tag names a {@link Node}:
 * - **node-bearing + {@link AddressedNode}** — `client(Hosted)` when the tag's `{ node }` is
 *   dialable: auto-wires connect (`R = never`). Bare bound nodes still require the node service.
 * - **nodeless tag + {@link AddressedNode}** — `client(tag, Worker)` same auto-connect gate.
 * - **bare node** — `client(tag, Bare)` / bare-bound `client(Hosted)` still require the node;
 *   provide {@link Node.connect}`(Bare, protocol)` (or lookup / {@link unix}`(tag)`) yourself.
 * - **nodeless tag, ambient transport** — ambient `RpcClient.Protocol`.
 *
 * @category clients
 * @public
 */
function clientLayer<Self, S extends Spec, HSelf>(
  tag: NodeBoundTag<Self, S, HSelf> & {
    readonly [nodeSym]: AddressedNode<HSelf>;
  },
): Layer.Layer<Self, ClientVerifyError | ValueErrorsOf<S>>;
function clientLayer<Self, S extends Spec, HSelf>(
  tag: NodeBoundTag<Self, S, HSelf>,
): Layer.Layer<Self, ValueErrorsOf<S>, HSelf>;
function clientLayer<Self, S extends Spec, HSelf>(
  tag: HyperlinkTag<Self, S>,
  node: AddressedNode<HSelf>,
): Layer.Layer<Self, ClientVerifyError | ValueErrorsOf<S>>;
function clientLayer<Self, S extends Spec, HSelf>(
  tag: HyperlinkTag<Self, S>,
  node: NodeKey<HSelf>,
): Layer.Layer<Self, ValueErrorsOf<S>, HSelf>;
function clientLayer<Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
): Layer.Layer<Self, ValueErrorsOf<S>, RpcClient.Protocol>;
function clientLayer<Self, S extends Spec>(
  tag: HyperlinkTag<Self, S>,
  node?: NodeKey<unknown>,
): Layer.Layer<Self, ClientVerifyError | ValueErrorsOf<S>, RpcClient.Protocol> {
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
          return yield* new MissingClientProtocol({ serviceKey: tag.key });
        }
        const client = yield* Effect.provideService(
          RpcClient.make(group),
          RpcClient.Protocol,
          protocol.value,
        );
        return yield* buildClientService(tag, client);
      }),
    ) as any;
  }
  // node chosen (from the tag or the argument): resolve the transport from that node service and
  // provide it locally to the client, so the layer requires the node rather than the ambient
  // Protocol. Reading a provided node service can't fail and `RpcClient.make` has no error channel,
  // so client construction never fails or dies — only the resulting method calls carry typed errors.
  // The node identity is erased to `unknown` on the base tag; the two node-typed overloads pin the
  // precise `HSelf` for callers, so this one contained boundary assertion restates the impl's return.
  const layer: any = (Layer.effect as any)(
    tag,
    Effect.gen(function* () {
      const { protocol } = yield* nodeKey as any;
      const client = yield* (Effect.provideService as any)(
        (RpcClient.make as any)(group),
        RpcClient.Protocol,
        protocol,
      );
      return yield* buildClientService(tag, client);
    }) as any,
  );
  // Dialable node (explicit 2nd arg *or* tag-bound): bake the canonical connect Layer
  // (WeakMap-memoized per Node class) so multiple clients share one MemoMap transport.
  // Default-on verify (reject): peer down / wrong-or-stale contract fails Layer build —
  // opt out via {@link clientVerify}. Reserved node-status is auto-served and absent from
  // `status.services`, so it stays tier-1 (reachability only).
  if (isAddressedNode(nodeKey as AnyNode)) {
    const addressed = nodeKey as AddressedNode<unknown>;
    const connected: any = layer.pipe(Layer.provide(connectAddressed(addressed)));
    const deepResource =
      tag[wireKeySym] === "hyperlink-ts/node-status"
        ? undefined
        : {
            serviceKey: tag[wireKeySym],
            contractHash: contractHash(tag),
          };
    return Layer.unwrap(
      Effect.gen(function* () {
        yield* applyClientVerify(addressed, deepResource);
        return connected;
      }),
    ) as any;
  }
  return layer as any;
}

// ── stream helpers: tag-dispatched consumption of an event stream ──

/** Anything with a string discriminant `_tag` — the element of an event stream. @internal */
type TaggedEvent = { readonly _tag: string };

/**
 * A partial set of per-`_tag` handlers over a tagged-event union — the handler-map form of
 * {@link Hyperlink.runForEachTag}. Each handler receives the **narrowed** event for its tag.
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
 * yield* jobs.events.pipe(Hyperlink.runForEachTag({
 *   Failed:  ({ entry, cause }) => Effect.logError(`failed ${entry.entryId}`, cause),
 *   Drained: ({ completed })    => Effect.log(`drained @ ${completed}`),
 * }))
 * yield* Hyperlink.runForEachTag(jobs.events, "Failed", (e) =>
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
 * yield* queue.events.pipe(Hyperlink.runForEachTagScoped({
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
 * Hyperlink toolkit — schema-defined service tags. Same `yield* Tag` everywhere; only the
 * layer changes: {@link Hyperlink.layer} runs it locally, {@link Hyperlink.client} drives it
 * remotely, {@link Hyperlink.serve} / {@link Hyperlink.serveRemote} expose an impl over RPC.
 *
 * @public
 */
export {
  makeTag as Tag,
  // Node module: import * as Node from "hyperlink-ts/Node"
  http,
  ws,
  unix,
  nPipe,
  localLayer as layer,
  clientLayer as client,
};
// `query`, `mutate`, `stream`, `local`, `runForEachTag`, `runForEachTagScoped` are already
// exported above under their public names. The whole surface is now a tree-shakeable module
// namespace: **`import * as Hyperlink from "hyperlink-ts/Hyperlink"`** — `Hyperlink.Tag`
// pulls only what's used. Transport nodes: `import * as Node from "hyperlink-ts/Node"`.

/**
 * CLI + default-TUI control surface (`hyperlink-ts/cli`). Bare paths open the TUI when
 * `hyperlink-ts/tui`'s `layer` is provided; full `<resource> <action>` paths run verbs.
 *
 * @public
 */
export { cli, Tui, TuiNotConfigured } from "./cli/index";

