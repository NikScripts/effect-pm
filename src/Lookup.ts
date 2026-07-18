/**
 * Lookup — identity server for resource keys (first claim wins).
 *
 * Same-machine default: bind a well-known {@link Resource} `ipc` path (OS exclusivity).
 * Cross-network: pass an explicit {@link LookupNode} with an address — no self-elect (L1).
 *
 * v1 surface: **claim** over IPC (first wins / {@link DuplicateIdentity}). Resolve/getClaim,
 * nodeless clients, check-in maps, manager LB streams, and Singleton layer-swap are follow-ons.
 *
 * @module Lookup
 * @since 0.8.0
 */
import { Data, Effect, Layer, Schema } from "effect";
import * as Resource from "./Resource";
import type { AnyNode, ProtocolKind } from "./Resource";
import * as internal from "./internal/lookup";

// ============================================================================
// Wire schemas
// ============================================================================

/**
 * Where a winning claimant lives — node key + transport address.
 *
 * @public
 */
export class Endpoint extends Schema.Class<Endpoint>("LookupEndpoint")({
  nodeKey: Schema.String,
  kind: Schema.Literals(["http", "socket", "ipc"]),
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
  kind: Schema.Literals(["http", "socket", "ipc"]),
  url: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
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
 * {@link LookupNode} has no dialable address (need `{ path }` / url, or use {@link layerDefaultLocal}).
 *
 * @public
 */
export class LookupUnaddressed extends Data.TaggedError("LookupUnaddressed")<{
  readonly node: string;
}> {}

// ============================================================================
// Contract
// ============================================================================

/** Canonical kind stamped on {@link Identity}. @public */
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
};

/**
 * Lookup identity service — claim / resolve resource keys.
 *
 * @public
 */
export class Identity extends Resource.Tag<Identity>()(
  "@nikscripts/effect-pm/Lookup/Identity",
  identitySpec,
  { kind },
) {}

// ============================================================================
// LookupNode + defaults (L1)
// ============================================================================

/**
 * Well-known Unix socket path for same-machine default lookup (L1).
 * Prefer overriding in tests so suites don't collide on one machine.
 *
 * @public
 */
export const defaultIpcPath = "/tmp/effect-pm-lookup.sock";

/**
 * A {@link Resource.Node} marked as the identity/lookup server.
 *
 * Same-machine: `{ path }` (ipc). Cross-network: pass a full address — required; no elect (L1).
 *
 * @public
 */
export const LookupNode = <Self>(
  name: string,
  target?:
    | number
    | string
    | {
        readonly url?: string;
        readonly path?: string;
        readonly kind?: ProtocolKind;
      },
): AnyNode & {
  readonly isLookupNode: true;
  readonly key: string;
} => {
  const node = Resource.Node<Self>(name, target);
  return Object.assign(node, { isLookupNode: true as const });
};

/** True when `node` was built with {@link LookupNode}. @public */
export const isLookupNode = (
  node: unknown,
): node is AnyNode & { readonly isLookupNode: true } =>
  // Context.Service tags are callable functions — `typeof` is `"function"`, not `"object"`.
  (typeof node === "object" || typeof node === "function") &&
  node !== null &&
  (node as { readonly isLookupNode?: boolean }).isLookupNode === true;

const toEndpoint = (stored: internal.StoredEndpoint): Endpoint =>
  new Endpoint({
    nodeKey: stored.nodeKey,
    kind: stored.kind,
    ...(stored.url !== undefined ? { url: stored.url } : {}),
    ...(stored.path !== undefined ? { path: stored.path } : {}),
  });

const storedFromClaim = (req: ClaimRequest): internal.StoredEndpoint => ({
  nodeKey: req.nodeKey,
  kind: req.kind,
  ...(req.url !== undefined ? { url: req.url } : {}),
  ...(req.path !== undefined ? { path: req.path } : {}),
});

/** Identity impl over a fresh in-memory registry. */
const identityServeLayer = () =>
  Layer.unwrap(
    Effect.gen(function* () {
      const registry = yield* internal.makeRegistry();
      return Resource.serve(Identity, {
        claim: (req: ClaimRequest) =>
          registry.claim(req.key, storedFromClaim(req)).pipe(
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
      });
    }),
  );

/**
 * Serve {@link Identity} on a Unix-domain path (same-machine lookup).
 *
 * @public
 */
export const layerIpc = (
  path: string,
  options?: { readonly unlink?: boolean },
) =>
  Resource.ipcServer([identityServeLayer()], {
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
 * Serve {@link Identity} on an addressed {@link LookupNode} (ipc `{ path }` in v1).
 *
 * @public
 */
export const layer = (
  node: AnyNode & { readonly key: string },
  options?: { readonly unlink?: boolean },
) => {
  if (node.kind === "ipc" && node.path !== undefined) {
    return layerIpc(node.path, options);
  }
  throw new LookupUnaddressed({ node: node.key });
};

/**
 * Client for {@link Identity} via an ipc {@link LookupNode} / Node with `{ path }`.
 *
 * @public
 */
export const client = (
  node: AnyNode & { readonly path?: string },
): Layer.Layer<Identity> => {
  if (node.path === undefined) {
    throw new LookupUnaddressed({
      node: "key" in node && typeof node.key === "string" ? node.key : "lookup",
    });
  }
  return Resource.client(Identity, node).pipe(
    Layer.provide(Resource.connectIpc(node)),
  );
};

/**
 * Client for the same-machine default lookup path.
 *
 * @public
 */
export const clientDefaultLocal = (options?: {
  readonly path?: string;
}): Layer.Layer<Identity> => {
  const path = options?.path ?? defaultIpcPath;
  const node = LookupNode("effect-pm/Lookup/default", { path });
  return client(node);
};
