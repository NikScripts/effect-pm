/**
 * Lookup — identity claims (first wins) + node directory (advertise / list).
 *
 * Same-machine default: bind a well-known {@link Resource} `ipc` path (OS exclusivity).
 * Cross-network: pass an explicit {@link Node.Lookup} with an address — no self-elect (L1).
 *
 * - {@link Identity} — `claim` by resource key (first wins / {@link DuplicateIdentity}).
 * - {@link Directory} — `advertise` / `unregister` / `nodesServing` (D5/D6). Duplicate
 *   `nodeKey` uses **livenessReplace**: ping incumbent {@link NodeStatus} `ping`; alive →
 *   {@link IncumbentAlive}; dead/unreachable → replace row.
 *
 * @module Lookup
 * @since 0.8.0
 */
import { Data, Duration, Effect, Exit, Layer, Option, Schema } from "effect";
import * as Resource from "./Resource";
import type { AnyNode } from "./internal/nodeCore";
import { Lookup as LookupNodeTag, Tag as NodeTag } from "./internal/nodeCore";
import { connectIpc } from "./internal/node";
import { ipcServer } from "./internal/nodeIpcServer";
import * as NodeStatus from "./NodeStatus";
import * as internal from "./internal/lookup";

// ============================================================================
// Wire schemas
// ============================================================================

/**
 * Where a winning claimant / advertised node lives — node key + transport address.
 *
 * @public
 */
export class Endpoint extends Schema.Class<Endpoint>("LookupEndpoint")({
  nodeKey: Schema.String,
  kind: Schema.Literals(["Http", "WebSocket", "IpcSocket"]),
  url: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
}) {}

/**
 * Claim payload — resource identity key plus the claimant's endpoint.
 *
 * @public
 */
export class ClaimRequest extends Schema.Class<ClaimRequest>("LookupClaimRequest")({
  key: Schema.String,
  nodeKey: Schema.String,
  kind: Schema.Literals(["Http", "WebSocket", "IpcSocket"]),
  url: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
}) {}

/**
 * Resolve payload — look up a winning claim by resource key (nodeless clients).
 *
 * @public
 */
export class ResolveRequest extends Schema.Class<ResolveRequest>("LookupResolveRequest")({
  key: Schema.String,
}) {}

/**
 * Another process already owns this resource key — `original` is where to dial.
 *
 * @public
 */
export class DuplicateIdentity extends Schema.TaggedErrorClass<DuplicateIdentity>()(
  "DuplicateIdentity",
  {
    key: Schema.String,
    original: Endpoint,
  },
) {}

/**
 * Directory row — dial target plus resource keys this node serves (`listen` catalog).
 *
 * @public
 */
export class DirectoryEntry extends Schema.Class<DirectoryEntry>("LookupDirectoryEntry")({
  nodeKey: Schema.String,
  kind: Schema.Literals(["Http", "WebSocket", "IpcSocket"]),
  url: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  serves: Schema.Array(Schema.String),
}) {}

/**
 * Advertise / refresh a directory row.
 *
 * @public
 */
export class AdvertiseRequest extends Schema.Class<AdvertiseRequest>(
  "LookupAdvertiseRequest",
)({
  nodeKey: Schema.String,
  kind: Schema.Literals(["Http", "WebSocket", "IpcSocket"]),
  url: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  serves: Schema.Array(Schema.String),
}) {}

/**
 * Unregister payload — remove a directory row by `nodeKey`.
 *
 * @public
 */
export class UnregisterRequest extends Schema.Class<UnregisterRequest>(
  "LookupUnregisterRequest",
)({
  nodeKey: Schema.String,
}) {}

/**
 * List nodes that advertised a given resource key in `serves`.
 *
 * @public
 */
export class NodesServingRequest extends Schema.Class<NodesServingRequest>(
  "LookupNodesServingRequest",
)({
  resourceKey: Schema.String,
}) {}

/**
 * Advertise rejected — an incumbent with the same `nodeKey` still answers NodeStatus ping.
 *
 * @public
 */
export class IncumbentAlive extends Schema.TaggedErrorClass<IncumbentAlive>()(
  "IncumbentAlive",
  {
    nodeKey: Schema.String,
    incumbent: DirectoryEntry,
  },
) {}

/**
 * {@link LookupNode} has no dialable address (need `{ path }` / url, or use {@link layerDefaultLocal}).
 *
 * @public
 */
/**
 * Lookup node has no dialable address — Layer error channel (not a sync throw).
 *
 * @public
 */
export class LookupUnaddressed extends Data.TaggedError("LookupUnaddressed")<{
  readonly node: string;
}> {}

// ============================================================================
// Contracts
// ============================================================================

/** Canonical kind stamped on Lookup resources. @public */
export const kind = "@nikscripts/effect-pm/Lookup";

const identitySpec = {
  claim: Resource.effectFn({
    payload: ClaimRequest,
    success: Endpoint,
    error: DuplicateIdentity,
  }).annotate({
    description:
      "First claim for `key` wins and returns the endpoint; later claims fail with DuplicateIdentity.",
  }),
  resolve: Resource.effectFn({
    payload: ResolveRequest,
    success: Schema.Option(Endpoint),
  }).annotate({
    description:
      "Read the winning endpoint for `key` without claiming (nodeless / lookupClient).",
  }),
};

/**
 * Lookup identity service — claim resource keys (first wins).
 *
 * @public
 */
export class Identity extends Resource.Tag<Identity>()(
  "@nikscripts/effect-pm/Lookup/Identity",
  identitySpec,
  { kind },
) {}

const directorySpec = {
  advertise: Resource.effectFn({
    payload: AdvertiseRequest,
    success: DirectoryEntry,
    error: IncumbentAlive,
  }).annotate({
    description:
      "Register or refresh a node directory row. Same dial target refreshes serves; " +
      "a different dial target runs livenessReplace (NodeStatus.ping on the incumbent).",
  }),
  unregister: Resource.effectFn({
    payload: UnregisterRequest,
    success: Schema.Boolean,
  }).annotate({
    description: "Remove a directory row by nodeKey (clean listen scope close).",
  }),
  nodesServing: Resource.effectFn({
    payload: NodesServingRequest,
    success: Schema.Array(DirectoryEntry),
  }).annotate({
    description: "List advertised nodes whose serves[] includes resourceKey.",
  }),
};

/**
 * Lookup node directory — advertise / unregister / list by served resource key.
 *
 * @public
 */
export class Directory extends Resource.Tag<Directory>()(
  "@nikscripts/effect-pm/Lookup/Directory",
  directorySpec,
  { kind },
) {}

// ============================================================================
// Defaults (L1) — Lookup Node ctor is {@link Node.Lookup}
// ============================================================================

/**
 * Well-known Unix socket path for same-machine default lookup (L1).
 * Prefer overriding in tests so suites don't collide on one machine.
 *
 * @public
 */
export const defaultIpcPath = "/tmp/effect-pm-lookup.sock";

// ============================================================================
// Codec helpers
// ============================================================================

const toEndpoint = (stored: internal.StoredEndpoint): Endpoint =>
  new Endpoint({
    nodeKey: stored.nodeKey,
    kind: stored.kind,
    ...(stored.url !== undefined ? { url: stored.url } : {}),
    ...(stored.path !== undefined ? { path: stored.path } : {}),
  });

const toDirectoryEntry = (
  stored: internal.StoredDirectoryEntry,
): DirectoryEntry =>
  new DirectoryEntry({
    nodeKey: stored.nodeKey,
    kind: stored.kind,
    serves: [...stored.serves],
    ...(stored.url !== undefined ? { url: stored.url } : {}),
    ...(stored.path !== undefined ? { path: stored.path } : {}),
  });

const storedFromClaim = (req: ClaimRequest): internal.StoredEndpoint => ({
  nodeKey: req.nodeKey,
  kind: req.kind,
  ...(req.url !== undefined ? { url: req.url } : {}),
  ...(req.path !== undefined ? { path: req.path } : {}),
});

const storedFromAdvertise = (
  req: AdvertiseRequest,
): internal.StoredDirectoryEntry => ({
  nodeKey: req.nodeKey,
  kind: req.kind,
  serves: [...req.serves],
  ...(req.url !== undefined ? { url: req.url } : {}),
  ...(req.path !== undefined ? { path: req.path } : {}),
});

/** Ping incumbent via NodeStatus.ping — true if reachable within timeout. */
const incumbentAlive = (
  entry: internal.StoredDirectoryEntry,
): Effect.Effect<boolean> => {
  const target =
    entry.kind === "IpcSocket" && entry.path !== undefined
      ? NodeTag()(`@pm/lookup-ping/${entry.nodeKey}`, {
          path: entry.path,
        })
      : entry.url !== undefined
        ? NodeTag()(`@pm/lookup-ping/${entry.nodeKey}`, {
            url: entry.url,
            kind: entry.kind,
          })
        : undefined;
  if (target === undefined) {
    return Effect.succeed(false);
  }
  // Layer.build + Context provide (not Effect.provide(Layer)) — library helper, not an app entry.
  // Addressed target → Resource.client auto-wires connect (shared MemoMap Layer).
  const probe = Effect.gen(function* () {
    const ctx = yield* Layer.build(Resource.client(NodeStatus.Tag, target));
    yield* Effect.gen(function* () {
      const status = yield* NodeStatus.Tag;
      yield* status.ping;
    }).pipe(Effect.provide(ctx));
  }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(2)));
  return Effect.map(Effect.exit(probe), Exit.isSuccess);
};

/** Identity + Directory impl over one shared in-memory registry pair. */
const lookupServeLayers = () =>
  Layer.unwrap(
    Effect.gen(function* () {
      const registries = yield* internal.makeRegistries();
      const identity = Resource.serve(Identity, {
        claim: (req: ClaimRequest) =>
          registries.claims.claim(req.key, storedFromClaim(req)).pipe(
            Effect.flatMap((outcome) =>
              outcome._tag === "Duplicate"
                ? Effect.fail(
                    new DuplicateIdentity({
                      key: outcome.key,
                      original: toEndpoint(outcome.original),
                    }),
                  )
                : Effect.succeed(toEndpoint(outcome.endpoint)),
            ),
          ),
        resolve: (req: ResolveRequest) =>
          registries.claims.resolve(req.key).pipe(
            Effect.map(Option.map(toEndpoint)),
          ),
      });
      const directory = Resource.serve(Directory, {
        advertise: (req: AdvertiseRequest) =>
          Effect.gen(function* () {
            const next = storedFromAdvertise(req);
            const prior = yield* registries.directory.get(req.nodeKey);
            if (Option.isSome(prior)) {
              if (!internal.sameDialTarget(prior.value, next)) {
                const alive = yield* incumbentAlive(prior.value);
                if (alive) {
                  return yield* new IncumbentAlive({
                    nodeKey: req.nodeKey,
                    incumbent: toDirectoryEntry(prior.value),
                  });
                }
              }
            }
            const stored = yield* registries.directory.set(next);
            return toDirectoryEntry(stored);
          }),
        unregister: (req: UnregisterRequest) =>
          registries.directory.remove(req.nodeKey),
        nodesServing: (req: NodesServingRequest) =>
          registries.directory.nodesServing(req.resourceKey).pipe(
            Effect.map((entries) => entries.map(toDirectoryEntry)),
          ),
      });
      return Layer.mergeAll(identity, directory);
    }),
  );

/**
 * Serve {@link Identity} + {@link Directory} on a Unix-domain path (same-machine lookup).
 *
 * @public
 */
export const layerIpc = (
  path: string,
  options?: { readonly unlink?: boolean },
) =>
  ipcServer([lookupServeLayers()], {
    path,
    ...(options?.unlink === undefined ? {} : { unlink: options.unlink }),
  });

/**
 * L1 same-machine default — bind {@link defaultIpcPath} (or `options.path`).
 * Second binder loses with `EADDRINUSE` (OS exclusivity).
 *
 * @public
 */
export const layerDefaultLocal = (options?: {
  readonly path?: string;
  readonly unlink?: boolean;
}) => layerIpc(options?.path ?? defaultIpcPath, options);

/**
 * Serve Lookup on an addressed {@link LookupNode} (ipc `{ path }` in v1).
 *
 * @public
 */
/** Fail a Layer build with {@link LookupUnaddressed}. @internal */
const lookupUnaddressedLayer = <A = never>(
  node: string,
): Layer.Layer<A, LookupUnaddressed> =>
  Layer.unwrap(
    Effect.map(
      Effect.fail(new LookupUnaddressed({ node })),
      (impossible: never): Layer.Layer<A> => impossible,
    ),
  );

export const layer = (
  node: AnyNode & { readonly key: string },
  options?: { readonly unlink?: boolean },
): Layer.Layer<never, LookupUnaddressed> => {
  if (node.kind === "IpcSocket" && node.path !== undefined) {
    return layerIpc(node.path, options);
  }
  return lookupUnaddressedLayer(node.key);
};

/**
 * Soft directory advertise for {@link Node.unix} / {@link Node.http} / {@link Node.ws}: when
 * {@link Directory} is in the environment, register `node` with the given `serves` keys and
 * {@link unregister} on scope close. No-op when Directory is absent (local-only listen).
 *
 * `serves` is derived from the protocol-listen serve list (group ids) after registration.
 * Duplicate `nodeKey` with a live incumbent fails the layer with {@link IncumbentAlive}.
 *
 * @public
 */
export const directoryAdvertiseLayer = (
  node: AnyNode & { readonly key: string },
  serves: ReadonlyArray<string>,
): Layer.Layer<never, IncumbentAlive> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const dirOpt = yield* Effect.serviceOption(Directory);
      if (Option.isNone(dirOpt)) {
        return;
      }
      const kind = node.kind;
      if (kind === undefined) {
        return;
      }
      yield* dirOpt.value.advertise(
        new AdvertiseRequest({
          nodeKey: node.key,
          kind,
          serves: [...serves],
          ...(typeof node.path === "string" ? { path: node.path } : {}),
          ...(typeof node.url === "string" ? { url: node.url } : {}),
        }),
      );
      yield* Effect.addFinalizer(() =>
        dirOpt.value
          .unregister(new UnregisterRequest({ nodeKey: node.key }))
          .pipe(Effect.ignore),
      );
    }),
  );

/**
 * Client for {@link Identity} + {@link Directory} via an ipc {@link LookupNode}.
 *
 * @public
 */
export const client = (
  node: AnyNode & { readonly path?: string },
): Layer.Layer<Identity | Directory, LookupUnaddressed> => {
  if (node.path === undefined) {
    return lookupUnaddressedLayer(
      "key" in node && typeof node.key === "string" ? node.key : "lookup",
    );
  }
  const path = node.path;
  // Path overload of connectIpc — no UnaddressedNode on the error channel.
  return Layer.mergeAll(
    Resource.client(Identity, node),
    Resource.client(Directory, node),
  ).pipe(Layer.provide(node.pipe(connectIpc(path))));
};

/**
 * Client for the same-machine default lookup path.
 *
 * @public
 */
export const clientDefaultLocal = (options?: {
  readonly path?: string;
}): Layer.Layer<Identity | Directory, LookupUnaddressed> => {
  const path = options?.path ?? defaultIpcPath;
  const node = LookupNodeTag("effect-pm/Lookup/default", { path });
  return client(node);
};

/**
 * Bind-or-dial the same-machine default Lookup path (D7).
 * First process serves Identity+Directory; later processes dial it (`Layer.catchCause`).
 *
 * @public
 */
export const bootstrapDefaultLocal = (options?: {
  readonly path?: string;
  readonly unlink?: boolean;
}): Layer.Layer<Identity | Directory> => {
  const path = options?.path ?? defaultIpcPath;
  // Bind-or-dial: try serve first. Default `unlink: false` so a second process cannot
  // unlink-steal a live Lookup sock (stale socks: pass `unlink: true` or use a fresh path).
  return layerIpc(path, {
    unlink: options?.unlink ?? false,
  }).pipe(
    Layer.catchCause(() => clientDefaultLocal({ path })),
  ) as Layer.Layer<Identity | Directory>;
};
