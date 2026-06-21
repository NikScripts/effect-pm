/**
 * **Resource toolkit** — schema-defined service tags with local + remote (RPC) layers.
 *
 * @remarks
 * Lightweight by construction: imports only `Schema` and `effect/unstable/rpc`, never a
 * heavy implementation. A {@link Spec} is the single source for a resource's wire
 * contract — the inferred service interface, the client forwarder, and the server
 * handlers all derive from it.
 *
 * Define a tag with {@link Resource.Tag} (one resource) or {@link Resource.tagFor} (a
 * factory: many instances sharing one contract). The same `yield* Tag` code runs
 * anywhere; only the layer changes:
 * - {@link Resource.layer} — run it locally with a real implementation;
 * - {@link Resource.client} — drive it remotely over RPC, as if local;
 * - {@link Resource.server} — expose one local impl over RPC;
 * - {@link Resource.serverFamily} — serve many factory instances behind one group,
 *   routed by the per-call `id` header.
 *
 * @module Resource
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Headers } from "effect/unstable/http";
import { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc";

/**
 * How a method behaves, for tools (CLI/TUI/dashboard) — **explicit, never inferred**:
 * - **`query`** — an idempotent read (CLI prints it, dashboard reads it as an Atom);
 * - **`action`** — a mutation (CLI confirms, dashboard calls it as `runtime.fn`).
 *
 * @public
 */
export type MethodKind = "query" | "action";

/**
 * One method of a resource contract:
 * - a **bare `Schema`** — its success type, with no payload (`current: Schema.Number`,
 *   `reset: Schema.Void`); shorthand for a {@link MethodKind} `query`; or
 * - a **descriptor** — `{ payload?, success?, error? }` (where `error` becomes the Effect
 *   error channel) plus optional **tool metadata** ({@link MethodSpec.description},
 *   {@link MethodKind}, `destructive`). The metadata is inert to the type inference and the
 *   wire contract — it only feeds the tools that render this resource.
 *
 * @public
 */
export type MethodSpec =
  | Schema.Top
  | {
      readonly payload?: Schema.Struct.Fields;
      readonly success?: Schema.Top;
      readonly error?: Schema.Top;
      /** Help text — CLI/TUI help, dashboard tooltips. */
      readonly description?: string;
      /** Query (read) vs action (mutation), explicit. Defaults to `query` when omitted. */
      readonly kind?: MethodKind;
      /** An action that loses state (`shutdown`/`clear`/`drop`) → confirm / danger styling. */
      readonly destructive?: boolean;
    };

/**
 * A resource contract: method name → {@link MethodSpec}. The single source of truth.
 *
 * @public
 */
export type Spec = Record<string, MethodSpec>;

/**
 * The resolved tool metadata for one method — what CLI/TUI/dashboard read to render it.
 *
 * @public
 */
export interface MethodMeta {
  /** Query (read) vs action (mutation). A bare-schema method is a `query`. */
  readonly kind: MethodKind;
  /** Help text, if declared. */
  readonly description: string | undefined;
  /** Whether the action loses state — only meaningful for `action`s. */
  readonly destructive: boolean;
}

/**
 * Read the tool metadata for a {@link MethodSpec}. A bare schema is a non-destructive
 * `query`; a descriptor reports its declared `kind` (defaulting to `query`), `description`,
 * and `destructive` flag. Pure annotation — does not touch the wire contract.
 *
 * @public
 */
export const methodMeta = (m: MethodSpec): MethodMeta =>
  Schema.isSchema(m)
    ? { kind: "query", description: undefined, destructive: false }
    : {
        kind: m.kind ?? "query",
        description: m.description,
        destructive: m.destructive ?? false,
      };

// ── type-level inference: one Spec → the service interface ──

type SuccessOf<M extends MethodSpec> = M extends Schema.Top
  ? M["Type"]
  : M extends { readonly success: Schema.Top }
    ? M["success"]["Type"]
    : void;

type ErrorOf<M extends MethodSpec> = M extends { readonly error: Schema.Top }
  ? M["error"]["Type"]
  : never;

type PayloadOf<M extends MethodSpec> = M extends {
  readonly payload: infer F extends Schema.Struct.Fields;
}
  ? Schema.Struct<F>["Type"]
  : never;

type HasPayload<M extends MethodSpec> = M extends {
  readonly payload: Schema.Struct.Fields;
}
  ? true
  : false;

/**
 * The inferred shape of one method: a **property** `Effect<Success, Error>` when there
 * is no payload, or a **function** `(payload) => Effect<Success, Error>` when there is.
 *
 * @internal
 */
export type Method<M extends MethodSpec> = HasPayload<M> extends true
  ? (payload: PayloadOf<M>) => Effect.Effect<SuccessOf<M>, ErrorOf<M>>
  : Effect.Effect<SuccessOf<M>, ErrorOf<M>>;

/**
 * The full service interface inferred from a {@link Spec}.
 *
 * @public
 */
export type ServiceOf<S extends Spec> = {
  readonly [K in keyof S]: Method<S[K]>;
};

// ── type-level: one Spec → the precisely-typed RPC contract group ──

/** The payload schema of a method: `Schema.Struct<F>` when it declares fields, else `Schema.Void`. */
type PayloadSchemaOf<M extends MethodSpec> = M extends {
  readonly payload: infer F extends Schema.Struct.Fields;
}
  ? Schema.Struct<F>
  : Schema.Void;

/** The success schema of a method: bare schema → itself; `{ success }` → that; else `Schema.Void`. */
type SuccessSchemaOf<M extends MethodSpec> = M extends Schema.Top
  ? M
  : M extends { readonly success: infer Su extends Schema.Top }
    ? Su
    : Schema.Void;

/** The error schema of a method: `{ error }` → that; else `Schema.Never`. */
type ErrorSchemaOf<M extends MethodSpec> = M extends {
  readonly error: infer Er extends Schema.Top;
}
  ? Er
  : Schema.Never;

/** The `Rpc` for one spec method — tag = the method name, schemas from the {@link MethodSpec}. */
type RpcOf<K extends string, M extends MethodSpec> = Rpc.Rpc<
  K,
  PayloadSchemaOf<M>,
  SuccessSchemaOf<M>,
  ErrorSchemaOf<M>
>;

/** The union of every method's {@link RpcOf} — the group's full RPC set. */
type RpcUnionOf<S extends Spec> = {
  readonly [K in keyof S & string]: RpcOf<K, S[K]>;
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
  const rpcs = Object.entries(spec).map(([method, m]) => {
    const tag = wireTag(groupId, method);
    if (Schema.isSchema(m)) {
      return Rpc.make(tag, { success: m });
    }
    const options: {
      payload?: Schema.Struct.Fields;
      success?: Schema.Top;
      error?: Schema.Top;
    } = {};
    if (m.payload !== undefined) options.payload = m.payload;
    if (m.success !== undefined) options.success = m.success;
    if (m.error !== undefined) options.error = m.error;
    return Rpc.make(tag, options);
  });
  // Boundary assertion (runtime-correct): each entry is built to be exactly the `Rpc`
  // the type derives from the same `spec` — but `Object.entries` erases the literal keys
  // to `string` (and the wire tag carries the group prefix the logical type omits), so the
  // precise per-method type is reattached here. One single source (the spec) drives both.
  return RpcGroup.make(...rpcs) as unknown as RpcGroupOf<S>;
};

// ── the Tag: a Context service whose value is `ServiceOf<Spec>` ──

/** Where the contract spec is stowed on a Tag (hidden from the value surface). */
const SpecSym = Symbol.for("@nikscripts/effect-pm/Resource/spec");
/** Where the built RPC group is stowed on a Tag (used by the client/server slices). */
const GroupSym = Symbol.for("@nikscripts/effect-pm/Resource/group");

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
) => {
  if (claimedIds.has(id)) {
    throw new Error(
      `Resource id "${id}" is already declared — resource ids must be unique.`,
    );
  }
  claimedIds.add(id);
  const base = Context.Service<Self, ServiceOf<S>>()(id);
  return Object.assign(base, { id, groupId, [SpecSym]: spec, [GroupSym]: group });
};

/**
 * Create a resource service tag from a {@link Spec}. Extend the result, like
 * `Context.Tag`, but the value type is **inferred from the spec**:
 *
 * ```ts
 * class Counter extends Resource.Tag<Counter>("Counter")({
 *   increment: { payload: { by: Schema.Number } },
 *   current: Schema.Number,
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
  <Self>(id: string) =>
  <const S extends Spec>(spec: S) => {
    // single resource: id doubles as the group id (its wire prefix)
    claimGroupId(id);
    return buildInstanceTag<Self, S>(id, id, spec, buildRpcGroup(id, spec));
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
const tagFor = <const S extends Spec>(groupId: string, spec: S) => {
  claimGroupId(groupId);
  const group = buildRpcGroup(groupId, spec);
  const factory = <Self>(id: string) =>
    buildInstanceTag<Self, S>(groupId, id, spec, group);
  // Stow the shared groupId/spec/group on the factory too, so the family server
  // ({@link serverFamily}) can read the contract + prefix without an instance in hand.
  return Object.assign(factory, { groupId, [SpecSym]: spec, [GroupSym]: group });
};

/**
 * The **local** layer for a resource: provide a real implementation of its service.
 * (Remote `client` / `server` layers arrive in a later slice.)
 *
 * @public
 */
const localLayer = <I, S>(tag: Context.Key<I, S>, impl: S): Layer.Layer<I> =>
  Layer.succeed(tag, impl);

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
    readonly [SpecSym]: S;
    readonly [GroupSym]: RpcGroupOf<S>;
  },
  impl: ServiceOf<S>,
): Layer.Layer<HandlerContextOf<S>> => {
  const group = tag[GroupSym];
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
 * The **family server** layer: serve **many instances of one factory** behind a
 * single contract group, dispatching each request to the right instance by the
 * per-call `id` header. Instances share one {@link tagFor} factory (one spec, one
 * RPC group); each is listed once with its implementation.
 *
 * Why an explicit list rather than one-layer-per-instance: composing instances as
 * sibling layers would silently keep only the last (Effect's `Context` is a map —
 * same-key layers last-write-wins). Listing them together is the foolproof shape:
 * every instance is wired, and a duplicate id **throws at assembly**.
 *
 * ```ts
 * const Queue = Resource.tagFor("queue", { pause: Schema.Void, resume: Schema.Void });
 * class Jobs extends Queue<Jobs>("@app/Jobs") {}
 * class Mail extends Queue<Mail>("@app/Mail") {}
 *
 * const serveAll = Resource.serverFamily(Queue, [
 *   [Jobs, { pause: …, resume: … }],
 *   [Mail, { pause: …, resume: … }],
 * ]);
 * ```
 *
 * @public
 */
const serverFamily = <S extends Spec>(
  factory: {
    readonly groupId: string;
    readonly [SpecSym]: S;
    readonly [GroupSym]: RpcGroupOf<S>;
  },
  instances: ReadonlyArray<readonly [{ readonly id: string }, ServiceOf<S>]>,
): Layer.Layer<HandlerContextOf<S>> => {
  const group = factory[GroupSym];
  const spec = factory[SpecSym];

  // Build the routing table once, at assembly: id → instance impl. A duplicate id
  // is a wiring mistake — fail loudly rather than silently shadow an instance.
  const table = new Map<string, ServiceOf<S>>();
  for (const [tag, impl] of instances) {
    if (table.has(tag.id)) {
      throw new Error(
        `Resource server family: instance id "${tag.id}" is listed more than once.`,
      );
    }
    table.set(tag.id, impl);
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
  readonly [SpecSym]: S;
  readonly [GroupSym]: RpcGroupOf<S>;
}): RpcGroupOf<S> => tag[GroupSym];

/**
 * The {@link Spec} a tag was built from — used to wire the client forwarder and tests.
 *
 * @internal
 */
export const specOf = <S extends Spec>(tag: { readonly [SpecSym]: S }): S =>
  tag[SpecSym];

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
): ServiceOf<S> => {
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
    // the wire tag is group-prefixed; the service surface keeps the bare method name
    const call = calls[wireTag(groupId, key)];
    // completeness check — fail loudly if a contract method isn't on the client
    if (call === undefined) {
      throw new Error(
        `Resource client: contract method "${key}" is missing from the RPC client.`,
      );
    }
    service[key] =
      Schema.isSchema(m) || m.payload === undefined
        ? call(undefined, { headers })
        : (payload: unknown) => call(payload, { headers });
  }
  // Boundary assertion (runtime-safe): every method verified present above; RPC validates
  // every payload/result against the spec schemas at the wire.
  return service as ServiceOf<S>;
};

/**
 * The **client** layer for a resource: drive it over RPC **as if it were local** —
 * the exact same `yield* Tag` code as the local layer, only the provided layer differs,
 * so it doesn't matter where the resource is actually running. Needs an ambient RPC
 * `Protocol` (the transport).
 *
 * @public
 */
const clientLayer = <Self, S extends Spec>(
  tag: Context.Key<Self, ServiceOf<S>> & {
    readonly id: string;
    readonly groupId: string;
    readonly [SpecSym]: S;
    readonly [GroupSym]: RpcGroupOf<S>;
  },
) =>
  Layer.effect(
    tag,
    Effect.map(RpcClient.make(tag[GroupSym]), (rpc) =>
      forwardClient(rpc, tag[SpecSym], tag.groupId, tag.id),
    ),
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
  layer: localLayer,
  server: serverLayer,
  serverFamily,
  client: clientLayer,
} as const;
