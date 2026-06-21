/**
 * **Resource toolkit** — schema-defined service tags with local + remote (RPC) layers.
 *
 * @remarks
 * **Slice 1 — the spec → contract foundation.** Lightweight by construction: imports
 * only `Schema` and `effect/unstable/rpc`, never a heavy implementation. This is the
 * single source for a resource's wire contract; the inferred service interface, the
 * client forwarder, and the server handlers all derive from one {@link Spec}.
 *
 * `Resource.Tag` / `Resource.Host` and the client/server layers land in later slices.
 *
 * @module Resource
 */
import { Context, Effect, Layer, Schema } from "effect";
import { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc";

/**
 * One method of a resource contract:
 * - a **bare `Schema`** — its success type, with no payload (`current: Schema.Number`,
 *   `reset: Schema.Void`); or
 * - a **descriptor** — `{ payload?, success?, error? }`, where `error` becomes the
 *   Effect error channel.
 *
 * @public
 */
export type MethodSpec =
  | Schema.Top
  | {
      readonly payload?: Schema.Struct.Fields;
      readonly success?: Schema.Top;
      readonly error?: Schema.Top;
    };

/**
 * A resource contract: method name → {@link MethodSpec}. The single source of truth.
 *
 * @public
 */
export type Spec = Record<string, MethodSpec>;

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

// ── runtime: one Spec → the shared RPC contract group ──

/**
 * Build the shared RPC contract group from a {@link Spec}. A bare `Schema` becomes a
 * payload-free rpc returning that schema; a descriptor maps straight to its parts.
 *
 * @internal
 */
export const buildRpcGroup = (spec: Spec) => {
  const rpcs = Object.entries(spec).map(([tag, m]) => {
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
  return RpcGroup.make(...rpcs);
};

// ── the Tag: a Context service whose value is `ServiceOf<Spec>` ──

/** Where the contract spec is stowed on a Tag (hidden from the value surface). */
const SpecSym = Symbol.for("@nikscripts/effect-pm/Resource/spec");
/** Where the built RPC group is stowed on a Tag (used by the client/server slices). */
const GroupSym = Symbol.for("@nikscripts/effect-pm/Resource/group");

/** Claimed ids — duplicate declarations fail fast (Effect won't catch same-key Tags). */
const claimedIds = new Set<string>();

/**
 * The single tag-creation primitive: dup-id guard + `Context.Service` + stow spec/group.
 * Both {@link makeTag} (per-tag spec) and {@link tagFor} (shared spec) go through it.
 */
const buildInstanceTag = <Self, S extends Spec>(
  id: string,
  spec: S,
  group: ReturnType<typeof buildRpcGroup>,
) => {
  if (claimedIds.has(id)) {
    throw new Error(
      `Resource id "${id}" is already declared — resource ids must be unique.`,
    );
  }
  claimedIds.add(id);
  const base = Context.Service<Self, ServiceOf<S>>()(id);
  return Object.assign(base, { id, [SpecSym]: spec, [GroupSym]: group });
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
 *
 * @public
 */
const makeTag =
  <Self>(id: string) =>
  <const S extends Spec>(spec: S) =>
    buildInstanceTag<Self, S>(id, spec, buildRpcGroup(spec));

/**
 * Build a **factory** tag-maker that bakes a shared {@link Spec} once: every instance
 * shares the same contract + RPC group, and callers **never pass the spec** — only an id.
 * Use for resource families (many instances, one contract).
 *
 * ```ts
 * const Queue = Resource.tagFor({ pause: Schema.Void, resume: Schema.Void });
 * class Jobs extends Queue<Jobs>("@app/Jobs") {}  // spec baked in; just the id
 * class Mail extends Queue<Mail>("@app/Mail") {}  // shares the same contract + group
 * ```
 *
 * @public
 */
const tagFor = <const S extends Spec>(spec: S) => {
  const group = buildRpcGroup(spec);
  return <Self>(id: string) => buildInstanceTag<Self, S>(id, spec, group);
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
    readonly [SpecSym]: S;
    readonly [GroupSym]: ReturnType<typeof buildRpcGroup>;
  },
  impl: ServiceOf<S>,
) => {
  const group = tag[GroupSym];
  const handlers: Record<string, (payload: unknown) => unknown> = {};
  for (const [key, member] of Object.entries(impl)) {
    // runtime-checked: payload methods are functions (call them); no-payload methods
    // are `Effect` properties (return as-is, ignoring the payload arg).
    handlers[key] = (payload) =>
      typeof member === "function" ? member(payload) : member;
  }
  // Boundary assertion (runtime-safe): the handlers mirror the same spec the group was
  // built from, and RPC validates every payload/result against the spec schemas at the
  // wire — so the asserted handler shape is enforced at runtime.
  return group.toLayer(handlers as Parameters<(typeof group)["toLayer"]>[0]);
};

/**
 * The RPC group built from a tag's spec — used to wire the client/server and tests.
 *
 * @internal
 */
export const groupOf = (tag: {
  readonly [GroupSym]: ReturnType<typeof buildRpcGroup>;
}): ReturnType<typeof buildRpcGroup> => tag[GroupSym];

/**
 * The {@link Spec} a tag was built from — used to wire the client forwarder and tests.
 *
 * @internal
 */
export const specOf = <S extends Spec>(tag: { readonly [SpecSym]: S }): S =>
  tag[SpecSym];

/**
 * Map an RPC client + a spec into the typed service, forwarding each method with the
 * resource id as a header. Shared by {@link Resource.client} (production, over a real
 * `Protocol`) and the in-memory round-trip test (client from `RpcTest`).
 *
 * @internal
 */
export const forwardClient = <S extends Spec>(
  rpc: unknown,
  spec: S,
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
    const call = calls[key];
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
    readonly [SpecSym]: S;
    readonly [GroupSym]: ReturnType<typeof buildRpcGroup>;
  },
) =>
  Layer.effect(
    tag,
    Effect.map(RpcClient.make(tag[GroupSym]), (rpc) =>
      forwardClient(rpc, tag[SpecSym], tag.id),
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
  client: clientLayer,
} as const;
