/**
 * Lookup — bind/dial layers that serve Identity / Directory / Advice Tags together.
 *
 * Same-machine default: {@link layer} / {@link layerOptions} on a well-known `ipc` path
 * (OS exclusivity; bind-or-dial). Cross-network: {@link layerNode} / {@link client} on an
 * explicit {@link Node.asLookup}-branded node — no self-elect (L1).
 *
 * **Dialers:** {@link client} is a **static** dial (one install). {@link follow} is the
 * hot dialer for the **same address** across an orchestrated Lookup A→B ownership move —
 * holder + `RpcClientError` retry + {@link Policy.streamGap}. Compose gap Policy at the
 * call site; orchestration (who binds the sock) is outside this module.
 *
 * **Tags are sibling modules** — not members of this namespace:
 *
 * ```ts
 * import * as Lookup from "hyperlink-ts/Lookup"
 * import * as Advice from "hyperlink-ts/Advice"
 * import * as Directory from "hyperlink-ts/Directory"
 * import * as Policy from "hyperlink-ts/Policy"
 *
 * Layer.provide(Lookup.layer)
 * Lookup.follow(lookupNode).pipe(Policy.provide(Policy.streamGap("stall")))
 * yield* Advice.prefer(Mail, "fleet/Mail#w2")
 * yield* Directory.changes.pipe(Stream.runDrain)
 * ```
 *
 * Never `import { Advice } from "hyperlink-ts/Lookup"` / `Lookup.Advice.*`.
 *
 * @module Lookup
 */
import {
  Data,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Stream,
} from "effect";
import * as Hyperlink from "./Hyperlink";
import {
  Tag as Advice,
  AdviseRequest,
  ClearAdviceRequest,
  PreferredRequest,
  AdvicePreferred,
  AdviceCleared,
  type AdviceChange,
} from "./Advice";
import {
  Tag as Directory,
  DirectoryEntry,
  DirectoryUpserted,
  DirectoryRemoved,
  AdvertiseRequest,
  UnregisterRequest,
  NodesServingRequest,
  IncumbentAlive,
  type DirectoryChange,
} from "./Directory";
import {
  Tag as Identity,
  Endpoint,
  ClaimRequest,
  ResolveRequest,
  DuplicateIdentity,
} from "./Identity";
import type { AnyNode } from "./internal/nodeCore";
import { asLookup, Tag as NodeTag } from "./internal/nodeCore";
import type { OnConflict, OnConflictResolved } from "./Policy";
import { onConflictOf, resolveOnConflict } from "./Policy";
import * as Policy from "./Policy";
import { connectIpc } from "./internal/node";
import { ipcServer } from "./internal/nodeIpcServer";
import * as internal from "./internal/lookup";
import { followLayer } from "./internal/lookupFollow";

/** Wire + resolve helpers — SSOT is {@link Policy}. @public */
export type { OnConflict, OnConflictResolved } from "./Policy";
export { resolveOnConflict } from "./Policy";

// Wire schemas + sugars from sibling modules (Tags stay on Advice/Directory/Identity).
export {
  Endpoint,
  ClaimRequest,
  ResolveRequest,
  DuplicateIdentity,
} from "./Identity";
export {
  DirectoryEntry,
  DirectoryUpserted,
  DirectoryRemoved,
  DirectoryChange,
  AdvertiseRequest,
  UnregisterRequest,
  NodesServingRequest,
  IncumbentAlive,
  nodesServing,
  changes,
  directoryTable,
} from "./Directory";
export {
  AdviseRequest,
  ClearAdviceRequest,
  PreferredRequest,
  AdvicePreferred,
  AdviceCleared,
  AdviceChange,
  advise,
  prefer,
  preferEntry,
  clearAdvice,
  preferred,
} from "./Advice";

/**
 * Lookup node has no dialable address — need `{ path }` / url, or use {@link layer} /
 * {@link layerOptions}. Layer error channel (not a sync throw).
 *
 * @category errors
 * @public
 */
export class LookupUnaddressed extends Data.TaggedError("LookupUnaddressed")<{
  readonly node: string;
}> {}

/**
 * Canonical kind stamped on Lookup HyperServices.
 *
 * @category utils
 * @public
 */
export const kind = "hyperlink-ts/Lookup";

/**
 * Services a Lookup client layer provides — identity, directory, and placement advice.
 *
 * @category models
 * @public
 */
export type Services = Identity | Directory | Advice;

// ============================================================================
// Defaults (L1) — Lookup node = Tag node branded with {@link Node.asLookup}
// ============================================================================

/**
 * Well-known Unix socket path for same-machine default lookup (L1).
 * Prefer overriding in tests so suites don't collide on one machine.
 *
 * @category utils
 * @public
 */
export const defaultIpcPath = "/tmp/hyperlink-ts-lookup.sock";

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

const toDirectoryChange = (
  event: internal.StoredDirectoryChange,
): DirectoryChange => {
  if (event._tag === "DirectoryRemoved") {
    return new DirectoryRemoved({
      nodeKey: event.nodeKey,
      previous: toDirectoryEntry(event.previous),
    });
  }
  return new DirectoryUpserted({
    entry: toDirectoryEntry(event.entry),
    ...(event.previous !== undefined
      ? { previous: toDirectoryEntry(event.previous) }
      : {}),
    dialChanged: event.dialChanged,
  });
};

const toAdviceChange = (
  event: internal.StoredAdviceChange,
): AdviceChange => {
  if (event._tag === "AdviceCleared") {
    return new AdviceCleared({
      serviceKey: event.serviceKey,
      previous: event.previous,
    });
  }
  return new AdvicePreferred({
    serviceKey: event.serviceKey,
    prefer: event.prefer,
    ...(event.previous !== undefined ? { previous: event.previous } : {}),
  });
};

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

/** Ping incumbent via the node-handle status path — true if reachable within timeout. */
const incumbentAlive = (
  entry: internal.StoredEndpoint,
): Effect.Effect<boolean> => {
  const target =
    entry.kind === "IpcSocket" && entry.path !== undefined
      ? NodeTag()(`hyperlink-ts/lookup-ping/${entry.nodeKey}`, {
          path: entry.path,
        })
      : entry.url !== undefined
        ? NodeTag()(`hyperlink-ts/lookup-ping/${entry.nodeKey}`, {
            url: entry.url,
            kind: entry.kind,
          })
        : undefined;
  if (target === undefined) {
    return Effect.succeed(false);
  }
  // Layer.build + Context provide (not Effect.provide(Layer)) — library helper, not an app entry.
  // Addressed target → Hyperlink.client auto-wires connect (shared MemoMap Layer).
  // Skip default-on verify — this *is* the liveness probe (`ping`); nested verify deadlocks
  // under claim (verify dials the incumbent while claim holds the registry fiber).
  const probe = Effect.gen(function* () {
    // Node-status engine is Hyperlink-internal (dynamic import dodges the Hyperlink⇄Lookup cycle).
    const { NodeStatusTag } = yield* Effect.promise(
      () => import("./internal/nodeStatus"),
    );
    const ctx = yield* Layer.build(
      Hyperlink.client(NodeStatusTag, target).pipe(
        Policy.provide(Policy.verifyOff),
      ),
    );
    yield* Effect.gen(function* () {
      const status = yield* NodeStatusTag;
      yield* status.ping;
    }).pipe(Effect.provide(ctx));
  }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(2)));
  return Effect.map(Effect.exit(probe), Exit.isSuccess);
};

/**
 * Ask incumbent node-status `yield` — true only on explicit accept within timeout.
 * Refuse / timeout / dial error → false (fail-closed).
 *
 * Note: wire RPC `status.yield` is unrelated to Effect generator `yield*`.
 */
const incumbentYield = (
  entry: internal.StoredDirectoryEntry,
): Effect.Effect<boolean> => {
  const target =
    entry.kind === "IpcSocket" && entry.path !== undefined
      ? NodeTag()(`hyperlink-ts/lookup-yield/${entry.nodeKey}`, {
          path: entry.path,
        })
      : entry.url !== undefined
        ? NodeTag()(`hyperlink-ts/lookup-yield/${entry.nodeKey}`, {
            url: entry.url,
            kind: entry.kind,
          })
        : undefined;
  if (target === undefined) {
    return Effect.succeed(false);
  }
  // Same as incumbentAlive — skip nested default-on verify around the yield RPC.
  const ask = Effect.gen(function* () {
    const { NodeStatusTag } = yield* Effect.promise(
      () => import("./internal/nodeStatus"),
    );
    const ctx = yield* Layer.build(
      Hyperlink.client(NodeStatusTag, target).pipe(
        Policy.provide(Policy.verifyOff),
      ),
    );
    return yield* Effect.gen(function* () {
      const status = yield* NodeStatusTag;
      return yield* status.yield;
    }).pipe(Effect.provide(ctx));
  }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(2)));
  return Effect.map(Effect.exit(ask), (exit) =>
    Exit.isSuccess(exit) ? exit.value === true : false,
  );
};

/** Identity + Directory + Advice impl over one shared in-memory registry. */
const lookupServeLayers = (serverOnConflict: OnConflictResolved) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const registries = yield* internal.makeRegistries();
      const identity = Hyperlink.serve(Identity, {
        claim: (req: ClaimRequest) =>
          Effect.gen(function* () {
            const next = storedFromClaim(req);
            const outcome = yield* registries.claims.claim(req.key, next);
            if (outcome._tag === "Won") {
              return toEndpoint(outcome.endpoint);
            }
            // Idempotent reclaim / refresh of the same dial target.
            if (internal.sameDialTarget(outcome.original, next)) {
              return toEndpoint(outcome.original);
            }
            const alive = yield* incumbentAlive(outcome.original);
            if (!alive) {
              const removed = yield* registries.claims.removeIfSameDial(
                req.key,
                outcome.original,
              );
              if (removed) {
                const retry = yield* registries.claims.claim(req.key, next);
                if (retry._tag === "Won") {
                  return toEndpoint(retry.endpoint);
                }
                // Raced with another claimant — surface their endpoint.
                return yield* new DuplicateIdentity({
                  key: retry.key,
                  original: toEndpoint(retry.original),
                });
              }
              // Concurrent replace already cleared the dead row — try once more.
              const retry = yield* registries.claims.claim(req.key, next);
              if (retry._tag === "Won") {
                return toEndpoint(retry.endpoint);
              }
              return yield* new DuplicateIdentity({
                key: retry.key,
                original: toEndpoint(retry.original),
              });
            }
            return yield* new DuplicateIdentity({
              key: outcome.key,
              original: toEndpoint(outcome.original),
            });
          }),
        resolve: (req: ResolveRequest) =>
          registries.claims.resolve(req.key).pipe(
            Effect.map(Option.map(toEndpoint)),
          ),
      });
      const directory = Hyperlink.serve(Directory, {
        advertise: (req: AdvertiseRequest) =>
          Effect.gen(function* () {
            const next = storedFromAdvertise(req);
            const prior = yield* registries.directory.get(req.nodeKey);
            if (Option.isSome(prior)) {
              if (!internal.sameDialTarget(prior.value, next)) {
                const policy = resolveOnConflict(
                  req.onConflict,
                  serverOnConflict,
                );
                const alive = yield* incumbentAlive(prior.value);
                if (alive) {
                  if (policy === "askIncumbent") {
                    const yielded = yield* incumbentYield(prior.value);
                    if (!yielded) {
                      return yield* new IncumbentAlive({
                        nodeKey: req.nodeKey,
                        incumbent: toDirectoryEntry(prior.value),
                      });
                    }
                    // accepted yield → fall through and replace
                  } else {
                    // livenessReplace | reject — alive means refuse
                    return yield* new IncumbentAlive({
                      nodeKey: req.nodeKey,
                      incumbent: toDirectoryEntry(prior.value),
                    });
                  }
                }
              }
            }
            const stored = yield* registries.directory.set(next);
            return toDirectoryEntry(stored);
          }),
        unregister: (req: UnregisterRequest) => {
          if (req.kind !== undefined) {
            return registries.directory.removeIfSameDial({
              nodeKey: req.nodeKey,
              kind: req.kind,
              ...(req.url !== undefined ? { url: req.url } : {}),
              ...(req.path !== undefined ? { path: req.path } : {}),
            });
          }
          return registries.directory.remove(req.nodeKey);
        },
        nodesServing: (req: NodesServingRequest) =>
          registries.directory.nodesServing(req.serviceKey).pipe(
            Effect.map((entries) => entries.map(toDirectoryEntry)),
          ),
        changes: Stream.fromPubSub(registries.directoryChanges).pipe(
          Stream.map(toDirectoryChange),
        ),
      });
      const advice = Hyperlink.serve(Advice, {
        advise: (req: AdviseRequest) =>
          registries.advice.set(req.serviceKey, req.prefer),
        clear: (req: ClearAdviceRequest) =>
          registries.advice.clear(req.serviceKey),
        preferred: (req: PreferredRequest) =>
          registries.advice.get(req.serviceKey),
        changes: Stream.fromPubSub(registries.adviceChanges).pipe(
          Stream.map(toAdviceChange),
        ),
      });
      return Layer.mergeAll(identity, directory, advice);
    }),
  );

/**
 * Serve {@link Identity} + {@link Directory} + {@link Advice} on a Unix-domain path.
 *
 * Pass `assumeToken` / `node` when this Lookup is a Launcher-custody child
 * (`Launcher.ensureLookup`).
 *
 * @category layers & serving
 * @public
 */
export const layerIpc = (
  path: string,
  options?: {
    readonly unlink?: boolean;
    /** Fleet-parent conflict policy (concrete). Default `livenessReplace`. */
    readonly onConflict?: OnConflictResolved;
    /** Node key for auto-mounted node-status / {@link Node.assume}. */
    readonly node?: string | { readonly key: string };
    /** Expected launcher ownership-ack token for {@link Node.assume}. */
    readonly assumeToken?: string | Redacted.Redacted<string>;
    /** Cooperative `askIncumbent` handler on node-status `yield`. */
    readonly onYield?: Effect.Effect<boolean>;
  },
) =>
  ipcServer(
    [
      lookupServeLayers(
        options?.onConflict !== undefined
          ? options.onConflict
          : "livenessReplace",
      ),
    ],
    {
      path,
      ...(options?.unlink === undefined ? {} : { unlink: options.unlink }),
      ...(options?.node !== undefined ? { node: options.node } : {}),
      ...(options?.assumeToken !== undefined
        ? { assumeToken: options.assumeToken }
        : {}),
      ...(options?.onYield !== undefined ? { onYield: options.onYield } : {}),
    },
  );

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

/**
 * Serve Lookup exclusively on an addressed {@link Node.Lookup} (ipc `{ path }` in v1).
 * Reads concrete {@link OnConflict} from the Lookup node stamp.
 * Same-machine bind-or-dial without a Node: {@link layer} / {@link layerOptions}.
 *
 * For Launcher custody of a Lookup-only child, pass `assumeToken` (and optionally
 * `onYield`) — the node's key is forwarded to auto-mounted node-status for
 * `Node.assume`.
 *
 * @category layers & serving
 * @public
 */
export const layerNode = (
  node: AnyNode & { readonly key: string },
  options?: {
    readonly unlink?: boolean;
    readonly assumeToken?: string | Redacted.Redacted<string>;
    readonly onYield?: Effect.Effect<boolean>;
  },
): Layer.Layer<never, LookupUnaddressed> => {
  if (node.kind === "IpcSocket" && node.path !== undefined) {
    const stamped = onConflictOf(node);
    const onConflict = resolveOnConflict(stamped);
    return layerIpc(node.path, {
      ...options,
      onConflict,
      node: node.key,
    });
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
 * `options.onConflict` is the call-site preference; combined with the node's stamp before
 * the wire request (may still be `"inherit"` for the Lookup server to finish).
 *
 * @category layers & serving
 * @public
 */
export const directoryAdvertiseLayer = (
  node: AnyNode & { readonly key: string },
  serves: ReadonlyArray<string>,
  options?: { readonly onConflict?: OnConflict },
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
      // Advertiser: call-site → node stamp → Policy.Conflict; leave `"inherit"` for Lookup.
      const callSite = options?.onConflict;
      const nodeStamp = onConflictOf(node);
      const ambient = yield* Policy.Conflict;
      const wirePref: OnConflict =
        [callSite, nodeStamp, ambient].find(
          (pref): pref is OnConflictResolved =>
            pref !== undefined && pref !== "inherit",
        ) ?? "inherit";
      yield* dirOpt.value.advertise(
        new AdvertiseRequest({
          nodeKey: node.key,
          kind,
          serves: [...serves],
          onConflict: wirePref,
          ...(typeof node.path === "string" ? { path: node.path } : {}),
          ...(typeof node.url === "string" ? { url: node.url } : {}),
        }),
      );
      yield* Effect.addFinalizer(() =>
        dirOpt.value
          .unregister(
            new UnregisterRequest({
              nodeKey: node.key,
              kind,
              ...(typeof node.path === "string" ? { path: node.path } : {}),
              ...(typeof node.url === "string" ? { url: node.url } : {}),
            }),
          )
          .pipe(Effect.ignore),
      );
    }),
  );

/**
 * Client for {@link Identity} + {@link Directory} via an ipc {@link LookupNode}.
 *
 * Static dial — one install for the process lifetime. For Lookup A→B on the **same**
 * address (orchestrated ownership handoff), use {@link follow}.
 *
 * @category clients
 * @public
 */
export const client = (
  node: AnyNode & { readonly path?: string },
): Layer.Layer<Services, LookupUnaddressed> => {
  if (node.path === undefined) {
    return lookupUnaddressedLayer(
      "key" in node && typeof node.key === "string" ? node.key : "lookup",
    );
  }
  const path = node.path;
  // Path overload of connectIpc — no UnaddressedNode on the error channel.
  // Opt out of default-on client verify: Lookup.client is often composed before (or
  // beside) the Lookup listen, and bind-or-dial ({@link layerOptions}) builds the
  // dial side without a guaranteed live peer at Layer.build. Connectivity fails on
  // the first Identity/Directory call instead.
  const clients: any = Layer.mergeAll(
    Hyperlink.client(Identity, node) as any,
    Hyperlink.client(Directory, node) as any,
    Hyperlink.client(Advice, node) as any,
  ) as any;
  return clients.pipe(
    Layer.provide(node.pipe(connectIpc(path))),
    Policy.provide(Policy.verifyOff),
  ) as any;
};

/**
 * Dial the same-machine Lookup path ({@link defaultIpcPath} or `options.path`).
 * Effect precedent: options factory beside a default Layer value (`layerAgentOptions`).
 *
 * @category clients
 * @public
 */
export const clientOptions = (options?: {
  readonly path?: string;
}): Layer.Layer<Services, LookupUnaddressed> => {
  const path = options?.path ?? defaultIpcPath;
  const node = NodeTag()("hyperlink-ts/Lookup/default", { path }).pipe(asLookup);
  return client(node);
};

/**
 * Hot dialer for one Lookup address — survives orchestrated A→B ownership moves on the
 * **same** `path` (build-then-swap; Effect RPCs retry on `RpcClientError`; streams follow
 * dial generations via {@link Policy.streamGap}).
 *
 * Unlike {@link client} (static install), {@link follow} reinstalls to the **same** seed
 * when the sock owner changes. Dialers never track two Lookup endpoints — orchestration
 * (start B → shut down A → B binds) is outside Policy.
 *
 * ```ts
 * Lookup.follow(lookupNode).pipe(
 *   Policy.provide(Policy.streamGap("stall")),
 * )
 * ```
 *
 * @category clients
 * @public
 */
export const follow = (
  node: AnyNode & { readonly path?: string },
): Layer.Layer<Services, LookupUnaddressed> => {
  if (node.path === undefined) {
    return lookupUnaddressedLayer(
      "key" in node && typeof node.key === "string" ? node.key : "lookup",
    );
  }
  return followLayer(
    node as AnyNode & { readonly path: string },
  ).pipe(Policy.provide(Policy.verifyOff)) as Layer.Layer<
    Services,
    LookupUnaddressed
  >;
};

/**
 * {@link follow} on {@link defaultIpcPath} or `options.path` — options factory beside
 * {@link follow}, mirroring {@link clientOptions}.
 *
 * @category clients
 * @public
 */
export const followOptions = (options?: {
  readonly path?: string;
}): Layer.Layer<Services, LookupUnaddressed> => {
  const path = options?.path ?? defaultIpcPath;
  const node = NodeTag()("hyperlink-ts/Lookup/default", { path }).pipe(asLookup);
  return follow(node);
};

/**
 * Bind-or-dial a same-machine Lookup path (L1 / D7).
 * First process serves {@link Identity}+{@link Directory}+{@link Advice}; later processes dial
 * (`Layer.catchCause`). Default `unlink: false` so a second process cannot unlink-steal
 * a live sock (stale socks: pass `unlink: true` or a fresh `path`).
 *
 * Effect precedent: `layerAgentOptions` — pair with {@link layer} for the zero-config value.
 *
 * @category layers & serving
 * @public
 */
export const layerOptions = (options?: {
  readonly path?: string;
  readonly unlink?: boolean;
}): Layer.Layer<Services> => {
  const path = options?.path ?? defaultIpcPath;
  return layerIpc(path, {
    unlink: options?.unlink ?? false,
  }).pipe(
    Layer.catchCause(() => clientOptions({ path })),
  ) as Layer.Layer<Services>;
};

/**
 * Same-machine default Lookup — {@link layerOptions}() on {@link defaultIpcPath}.
 * Use `Layer.provide(Lookup.layer)` with no call. Override path via {@link layerOptions}.
 *
 * Effect precedent: `layerAgent` = `layerAgentOptions()`.
 *
 * @category layers & serving
 * @public
 */
export const layer: Layer.Layer<Services> = layerOptions();
