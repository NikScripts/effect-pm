/**
 * Node core — Tag / Prototype constructors, withProtocol / asLookup combinators + catalog types.
 * No Resource runtime imports (avoids circular init). Store binding is late via
 * {@link bindNodeStore}.
 *
 * @internal
 */
import { Context, Data, Result } from "effect"
import type { Layer } from "effect"
import type { HttpRouter } from "effect/unstable/http"
import type { RpcClient } from "effect/unstable/rpc"
import type { RpcSerialization } from "effect/unstable/rpc"

/** @internal */
export interface NodeProtocol {
  readonly protocol: Context.Service.Shape<typeof RpcClient.Protocol>
}

/** Late-bound {@link Resource.store} for `Node.Tag()(...).logs`. @internal */
type StoreFn = (tag: { readonly key: string }) => unknown
let storeImpl: StoreFn | undefined

/** Called from Resource after `store` is defined. @internal */
export const bindNodeStore = (fn: StoreFn): void => {
  storeImpl = fn
}

const storeOrThrow = (tag: { readonly key: string }): unknown => {
  if (storeImpl === undefined) {
    throw new Error(
      "@nikscripts/effect-pm: Node.logs used before Resource.store was bound",
    )
  }
  return storeImpl(tag)
}

/**
 * The Context key of a {@link Node} (`HSelf` = its identity): a service whose value is the
 * transport {@link NodeProtocol}. Stored on a node-bearing tag under {@link nodeSym}; read by
 * {@link Resource.client} to resolve *where* to connect (its requirement channel).
 *
 * @category models
 * @public
 */
export type NodeKey<HSelf> = Context.Key<HSelf, NodeProtocol>;

/**
 * The transport a {@link Node} speaks — tag-style names (apps rarely type this alias; they write
 * the literals or get inference from `url` / `path`):
 * - `"Http"` — `RpcClient.layerProtocolHttp` (servers / CLIs)
 * - `"WebSocket"` — browser WS (`layerProtocolWebsocket` / client `layerProtocolSocket` over WS)
 * - `"IpcSocket"` — Unix-domain socket (same-machine; see {@link ipcServer})
 *
 * Stamped on the node so the topology is self-describing about *how* to reach it — `connect`/`client`
 * derive the transport from it. Inferred from a `ws(s)://` url, an http target, or `{ path }` →
 * IpcSocket; otherwise declare it explicitly.
 *
 * @category models
 * @public
 */
export type ProtocolKind = "Http" | "WebSocket" | "IpcSocket";

/** The set of transports one {@link Tag} node speaks — a record keyed by {@link ProtocolKind}. A
 *  single-protocol node has one entry; a multi-protocol node (the `{ http, ws }` shorthand or piped
 *  {@link overHttp}/{@link overSocket}/{@link overIpc}) has several. `connect` selects one; the server
 *  ({@link ProtocolKindMismatch}) asserts its transport is a member. @public */
export interface Endpoints {
  readonly Http?: { readonly url: string };
  readonly WebSocket?: { readonly url: string };
  readonly IpcSocket?: { readonly path: string };
}

/**
 * Directory advertise conflict policy when the same `nodeKey` already has a row.
 *
 * - `livenessReplace` — ping incumbent; alive → reject; dead → replace
 * - `askIncumbent` — if alive, Lookup asks `NodeStatus.yield`; refuse/timeout → reject
 * - `reject` — alive → reject; dead → still replace
 * - `inherit` — continue up the resolve chain (call-site → node → Lookup → hard fallback)
 *
 * @category models
 * @public
 */
export type OnConflict =
  | "livenessReplace"
  | "askIncumbent"
  | "reject"
  | "inherit";

/**
 * Concrete advertise conflict policy (no `"inherit"`) — what Lookup runs.
 *
 * @category models
 * @public
 */
export type OnConflictResolved = Exclude<OnConflict, "inherit">;

/**
 * Walk preference layers (first concrete wins). Hard fallback: `livenessReplace`.
 *
 * @category utils
 * @public
 */
export const resolveOnConflict = (
  ...prefs: ReadonlyArray<OnConflict | undefined>
): OnConflictResolved => {
  for (const pref of prefs) {
    if (pref !== undefined && pref !== "inherit") {
      return pref;
    }
  }
  return "livenessReplace";
};

/** Read a node's stamped {@link OnConflict}, if any. @internal */
export const onConflictOf = (node: unknown): OnConflict | undefined => {
  if (
    (typeof node === "object" || typeof node === "function") &&
    node !== null &&
    "onConflict" in node
  ) {
    const value = (node as { readonly onConflict?: unknown }).onConflict;
    if (
      value === "livenessReplace" ||
      value === "askIncumbent" ||
      value === "reject" ||
      value === "inherit"
    ) {
      return value;
    }
  }
  return undefined;
};

/** A {@link Tag} erased — its transport `endpoints` set, plus the **primary** address
 *  (`url` and/or Unix `path`) and {@link ProtocolKind} `kind` (the first-declared endpoint, kept for
 *  single-protocol readers), so a tag's `distributed` set is self-describing about *where* AND *how* to
 *  reach each one. @public
 *
 * @category models
 */
export type AnyNode = NodeKey<unknown> & {
  readonly url: string | undefined;
  readonly path: string | undefined;
  readonly kind: ProtocolKind | undefined;
  readonly endpoints?: Endpoints;
  /** Stamped advertise conflict policy (default `"inherit"` on ordinary nodes). */
  readonly onConflict?: OnConflict;
};

/** An {@link AnyNode} that can derive {@link connect} with no protocol argument —
 *  `kind` set, and either a `url` (Http/WebSocket) or a Unix `path` (IpcSocket). @public
 *
 * @category models
 */
export type AddressedNode<HSelf> = NodeKey<HSelf> &
  (
    | {
        readonly kind: "IpcSocket";
        readonly path: string;
        readonly url: string | undefined;
      }
    | {
        readonly kind: "Http";
        readonly url: string;
        readonly path: string | undefined;
      }
    | {
        readonly kind: "WebSocket";
        readonly url: string;
        readonly path: string | undefined;
      }
    // Loose url Tag (`kind: "Http" | "WebSocket"`) — still dialable at runtime.
    | {
        readonly kind: "Http" | "WebSocket";
        readonly url: string;
        readonly path: string | undefined;
      }
  );

/**
 * Type-only catalog brand on a {@link Node} — `ROut` is erased at runtime (C2 / C4).
 *
 * @internal
 */
export const catalogSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Resource/catalog",
);

/**
 * A {@link Node} with typed catalog `ROut` (union of resource handles). Prefer
 * `import type` for those handles (C4). Use with {@link listen} / {@link clients}.
 *
 * Catalog members must be structurally distinct types (different specs / service shapes) —
 * identical Tag shapes collapse in TypeScript, so `Jobs | Emails` cannot prove C3.
 *
 * @category models
 * @public
 */
export type CatalogNode<Self, ROut = never> = NodeKey<Self> & {
  readonly url: string | undefined;
  readonly path: string | undefined;
  readonly kind: ProtocolKind | undefined;
  readonly [catalogSym]?: ROut;
};

/**
 * Address-less {@link unix} / {@link http} / {@link ws} lost the `Node.key` claim — another
 * process owns this Node. Winner endpoint is in `original` (dial via Lookup / `client`).
 *
 * @category errors
 * @public
 */
export class AddressLessClaimLost extends Data.TaggedError("AddressLessClaimLost")<{
  readonly node: string;
  readonly original: {
    readonly nodeKey: string;
    readonly kind: ProtocolKind;
    readonly url?: string;
    readonly path?: string;
  };
}> {}

/**
 * The Node a protocol listen (`unix` / `http` / `ws`) is binding (concrete or minted).
 * Identity claims prefer this over a Tag-bound Node when present.
 *
 * @category models
 * @public
 */
export class ListenNode extends Context.Service<ListenNode, AnyNode>()(
  "@nikscripts/effect-pm/internal/nodeCore/ListenNode",
) {}

/**
 * Shared options for {@link unix} / {@link http} / {@link ws} (and low-level `*Server`) —
 * rpc path / health / ipc unlink. Not the TCP bind port (platform layer owns that).
 *
 * @category models
 * @public
 */
export type ListenOptions = {
  readonly path?: HttpRouter.PathInput;
  readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  readonly health?: { readonly path?: HttpRouter.PathInput };
  readonly node?: string | { readonly key: string };
  readonly unlink?: boolean;
  /**
   * Directory advertise conflict policy for this listen (call-site; wins over node stamp).
   * Omit / `"inherit"` → continue resolve chain.
   */
  readonly onConflict?: OnConflict;
};

/**
 * Options for {@link unix} / {@link http} / {@link ws} / {@link Node.listenLocal}.
 * Same as {@link ListenOptions} — Lookup is composed with `.pipe(Layer.provide(…))`,
 * not listen options (`lookupPath` / `bootstrapLookup` removed).
 *
 * @category models
 * @public
 */
export type NamelessListenOptions = ListenOptions;

/**
 * {@link resolveHttpTarget} / a positional `Node.Tag()(name, badString)` got a string that is
 * neither a port (`":3009"`), a port number, nor an `http(s)://` url. Surfaces on the
 * **Layer / Effect error channel** (same precedent as {@link UnaddressedNode}) — never a
 * sync throw. Catch via `Exit` / `CatchTag` when building `clientHttp` or derived `connect`.
 *
 * @category errors
 * @public
 */
export class InvalidHttpTarget extends Data.TaggedError("InvalidHttpTarget")<{
  readonly target: string;
}> {}

/**
 * Stamped on a {@link Tag} built from a positional target that failed
 * {@link resolveHttpTarget} — {@link connect} / protocol derivation fail with that error.
 *
 * @internal
 */
export const invalidHttpTargetSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Node/invalidHttpTarget",
);

/** Read a stamped {@link InvalidHttpTarget}, if any. @internal */
export const invalidHttpTargetOf = (
  node: unknown,
): InvalidHttpTarget | undefined => {
  if (
    (typeof node === "object" || typeof node === "function") &&
    node !== null &&
    invalidHttpTargetSym in node
  ) {
    const value = (node as { readonly [invalidHttpTargetSym]?: unknown })[
      invalidHttpTargetSym
    ];
    return value instanceof InvalidHttpTarget ? value : undefined;
  }
  return undefined;
};

/**
 * Resolve a {@link clientHttp} / positional Tag target to an RPC url.
 * Port (`3009` / `":3009"`) → `http://localhost:3009/rpc`; `http(s)://…` as-is;
 * anything else → {@link InvalidHttpTarget} (Failure). Pure — no throw.
 *
 * @internal
 */
export const resolveHttpTarget = (
  target: number | string,
): Result.Result<string, InvalidHttpTarget> => {
  if (typeof target === "number") {
    return Result.succeed(`http://localhost:${target}/rpc`);
  }
  if (/^:\d+$/.test(target)) {
    return Result.succeed(`http://localhost${target}/rpc`);
  }
  if (/^https?:\/\//.test(target)) {
    return Result.succeed(target);
  }
  return Result.fail(new InvalidHttpTarget({ target }));
};

/**
 * Dialable {@link Tag} targets — enough address for {@link connect} / auto-wired
 * {@link Resource.client} with no extra protocol argument.
 *
 * @category models
 * @public
 */
export type DialableTarget =
  | number
  | string
  | { readonly path: string; readonly kind?: "IpcSocket" }
  | { readonly url: string; readonly kind?: ProtocolKind };

/** Loose target bag (may omit address — not an {@link AddressedNode}). @internal */
type LooseNodeTarget =
  | number
  | string
  | {
      readonly url?: string;
      readonly path?: string;
      readonly kind?: ProtocolKind;
      readonly onConflict?: OnConflict;
    }
  | ShorthandTarget;

/**
 * Constructable {@link Tag} result — `Context.ServiceClass` plus address fields.
 *
 * @internal
 */
type NodeTagClass<Self, ROut, Address> =
  Context.ServiceClass<Self, string, NodeProtocol> &
    Address & {
      readonly [catalogSym]?: ROut;
      readonly logs: unknown;
      readonly onConflict: OnConflict;
    };

/** Bare (address-less) node fields. @internal */
type BareAddress = {
  readonly url: undefined;
  readonly path: undefined;
  readonly kind: undefined;
};

/** Dialable ipc node fields. @internal */
type IpcAddress = {
  readonly url: undefined;
  readonly path: string;
  readonly kind: "IpcSocket";
};

/** Dialable http node fields. @internal */
type HttpAddress = {
  readonly url: string;
  readonly path: undefined;
  readonly kind: "Http";
};

/** Dialable WebSocket node fields. @internal */
type WsAddress = {
  readonly url: string;
  readonly path: undefined;
  readonly kind: "WebSocket";
};

/**
 * Loose dialable url node — single object type (not a union) so `class extends Tag()(…)`
 * stays constructable. Precise overloads return {@link HttpAddress} / {@link WsAddress}.
 *
 * @internal
 */
type UrlAddressLoose = {
  readonly url: string;
  readonly path: undefined;
  readonly kind: "Http" | "WebSocket";
};

/** A **multi-protocol** node's fields — its transport `endpoints` set, `kind` the union of the set
 *  (the primary at runtime), plus the primary `url`/`path`. Single object type (not a union) so
 *  `class extends Tag()(…)` stays constructable. @internal */
type MultiAddress<Kinds extends ProtocolKind> = {
  readonly url: string | undefined;
  readonly path: string | undefined;
  readonly kind: Kinds;
  readonly endpoints: Endpoints;
};

/** The {@link ProtocolKind}s present in a `{ http, ws, ipc }` shorthand target. @internal */
type KindsOf<T> =
  | (T extends { readonly http: string } ? "Http" : never)
  | (T extends { readonly ws: string } ? "WebSocket" : never)
  | (T extends { readonly ipc: string } ? "IpcSocket" : never);

/** The `{ http, ws, ipc }` multi-protocol shorthand target. `url`/`path`/`kind` are pinned to `never`
 *  so it stays disjoint from the single-address `{ url, kind }` / `{ path }` forms. @internal */
type ShorthandTarget = {
  readonly http?: string;
  readonly ws?: string;
  readonly ipc?: string;
  readonly onConflict?: OnConflict;
  readonly url?: never;
  readonly path?: never;
  readonly kind?: never;
};

/** Constructable ipc {@link Tag} (for {@link Prototype}.make). @internal */
export type IpcNodeTagClass<Self, ROut = never> = NodeTagClass<
  Self,
  ROut,
  IpcAddress
>;

/** Constructable loose-url {@link Tag} (for {@link Prototype}.make). @internal */
export type UrlNodeTagClass<Self, ROut = never> = NodeTagClass<
  Self,
  ROut,
  UrlAddressLoose
>;

/** Constructable http {@link Tag}. @internal */
export type HttpNodeTagClass<Self, ROut = never> = NodeTagClass<
  Self,
  ROut,
  HttpAddress
>;

/** Constructable WebSocket {@link Tag}. @internal */
export type WsNodeTagClass<Self, ROut = never> = NodeTagClass<
  Self,
  ROut,
  WsAddress
>;

/**
 * Runtime predicate: node declares a {@link ProtocolKind} and the matching address
 * (`path` for IpcSocket, `url` otherwise) so {@link connect} can derive a transport.
 *
 * @category guards
 * @public
 */
export const isAddressedNode = (
  node: AnyNode,
): node is AddressedNode<unknown> => {
  if (node.kind === "IpcSocket") return typeof node.path === "string";
  if (node.kind === "Http" || node.kind === "WebSocket") {
    return typeof node.url === "string";
  }
  return false;
};

/** Is a target the `{ http, ws, ipc }` multi-protocol shorthand? @internal */
const isShorthandTarget = (
  t: LooseNodeTarget | undefined,
): t is ShorthandTarget =>
  typeof t === "object" &&
  t !== null &&
  ("http" in t || "ws" in t || "ipc" in t);

/** The advertise policy a construction target carries, if any — the single reader of `target.onConflict`
 *  for both {@link Tag} (default `"inherit"`) and {@link asLookup} (folds via {@link resolveOnConflict}).
 *  @internal */
const onConflictFromTarget = (
  target: LooseNodeTarget | undefined,
): OnConflict | undefined =>
  typeof target === "object" && target !== null ? target.onConflict : undefined;

/**
 * A node was built with inconsistent transport fields — a programming invariant, thrown at
 * declaration (like {@link DuplicateResourceKey}) so a malformed node fails loudly *there* instead of
 * as a confusing dial/serve failure later. @public
 */
export class MalformedNode extends Data.TaggedError("MalformedNode")<{
  readonly key: string;
  readonly reason: string;
}> {
  override get message() {
    return `Node "${this.key}" is malformed: ${this.reason}.`;
  }
}

/**
 * Assemble a node tag value from resolved address fields — a `Context.Service` class stamped with the
 * transport fields, the `logs` accessor, and the catalog brand. **The single place** the runtime →
 * `NodeTagClass` impedance is bridged: a node's runtime `kind` is always looser (`ProtocolKind |
 * undefined`) than any precise address form `Addr`, so exactly one construction cast lives here and
 * every caller ({@link Tag}, {@link withProtocol}) stays cast-free. @internal
 */

const assembleNode = <Self, ROut, Addr>(
  key: string,
  fields: {
    readonly url: string | undefined;
    readonly path: string | undefined;
    readonly kind: ProtocolKind | undefined;
    readonly endpoints: Endpoints;
    readonly onConflict: OnConflict;
    readonly invalidTarget?: InvalidHttpTarget;
  },
): NodeTagClass<Self, ROut, Addr> => {
  // Validate the fields are well-formed BEFORE the (generic-`Addr`) construction cast — the cast can't
  // be type-checked, so a runtime check is what makes it safe. NOTE: a node may declare a `kind`
  // WITHOUT a `url`/`path` — an address-less listen node (e.g. the anonymous http/ws mint) knows *how*
  // it'll be reached but binds *where* only at listen. So we validate the invariants that always hold:
  // a non-empty key, and that any endpoint actually present in the set carries a non-empty address.
  const { endpoints } = fields;
  if (typeof key !== "string" || key.length === 0) {
    throw new MalformedNode({
      key,
      reason: "empty key (a node needs a Context service key)",
    });
  }
  for (const [transport, endpoint] of Object.entries(endpoints)) {
    const address =
      "url" in endpoint
        ? endpoint.url
        : "path" in endpoint
          ? endpoint.path
          : undefined;
    if (typeof address !== "string" || address.length === 0) {
      throw new MalformedNode({
        key,
        reason: `${transport} endpoint has an empty ${"url" in endpoint ? "url" : "path"}`,
      });
    }
  }
  const node = Object.assign(Context.Service<Self, NodeProtocol>()(key), {
    url: fields.url,
    path: fields.path,
    kind: fields.kind,
    endpoints: fields.endpoints,
    onConflict: fields.onConflict,
    ...(fields.invalidTarget !== undefined
      ? { [invalidHttpTargetSym]: fields.invalidTarget }
      : {}),
  });
  const built = Object.assign(node, {
    /** Node-wide durable log registration — same as {@link store}`(this node)`. */
    get logs() {
      return storeOrThrow(node);
    },
    [catalogSym]: undefined,
  });
  // Narrow to the node-tag type with a guard instead of a blind `as unknown` — the guard verifies the
  // built value carries the node-tag shape (the checkable part) and catches a broken build. `Addr` is
  // an erased type parameter, so its precision is asserted by the predicate rather than checked.
  if (!isNodeTagValue<Self, ROut, Addr>(built)) {
    throw new MalformedNode({
      key,
      reason: "assembled value is not a well-formed node tag",
    });
  }
  return built;
};

/** Does a freshly-assembled value carry the node-tag shape? The type-guard form of the construction
 *  assertion — verifies the checkable structure; `Addr`'s precision is trusted (erased). @internal */
const isNodeTagValue = <Self, ROut, Addr>(
  x: unknown,
): x is NodeTagClass<Self, ROut, Addr> =>
  (typeof x === "object" || typeof x === "function") &&
  x !== null &&
  "endpoints" in x &&
  "logs" in x &&
  catalogSym in x;

/**
 * Declare a **node** — a named transport endpoint a resource connects to. **Two-stage** and keyed by
 * a string, mirroring Effect's `Context.Service<Self, Shape>()(key)` (a node *is* a `Context.Key`,
 * resolved by its `key` in the Context map) and every sibling factory (`Resource.Tag<Self>()`, …).
 * The second call infers the target shape, so the `{ http, ws }` shorthand types its
 * {@link ProtocolKind} set precisely. Optional catalog type param `ROut` (C2) — prefer `import type`
 * for those handles (C4). Templates (no address until cloned) live on {@link Node}.Prototype:
 *
 * ```ts
 * class EdgeNode extends Node.Tag<EdgeNode>()("edge") {}                       // no address yet
 * class Worker extends Node.Tag<Worker>()("worker", 3001) {}                   // → http://localhost:3001/rpc, kind "Http"
 * class Mail extends Node.Tag<Mail>()("mail", "https://mail.internal/rpc") {}  // full url, as-is, kind "Http"
 * class Live extends Node.Tag<Live>()("live", { url: "wss://live/rpc" }) {}    // kind "WebSocket" (inferred from ws url)
 * class Push extends Node.Tag<Push>()("push", { url: "/rpc", kind: "WebSocket" }) {} // same-origin path, explicit kind
 * class Local extends Node.Tag<Local>()("local", { path: "/tmp/local.sock" }) {} // kind "IpcSocket" (Unix domain)
 * class Droplet extends Node.Tag<Droplet>()("droplet", { http: "http://d/rpc", ws: "ws://d/rpc" }) {} // multi-protocol
 * import type { Jobs, Emails } from "@app/contracts"
 * class AppWorker extends Node.Tag<AppWorker, Jobs | Emails>()("app/Worker", { path: "/tmp/w.sock" }) {}
 * class MailWorker extends Node.Prototype<MailWorker, Mail>("app/MailWorker") {}
 * ```
 *
 * The `key` is the service key. The optional address matches {@link clientHttp}'s `target`: a **port**
 * (`3001` or `":3001"` → `http://localhost:3001/rpc`), a full **url** (used as-is), `{ url, kind }` for
 * an explicit endpoint, `{ path }` for a **Unix-domain** socket (`kind: "IpcSocket"`), or the
 * `{ http, ws, ipc }` multi-protocol shorthand. The node carries {@link ProtocolKind} so the topology
 * is self-describing about *where* AND *how*: {@link connect}`(node)` derives the transport with no
 * protocol argument.
 *
 * Dialable targets return an {@link AddressedNode} (`kind: ProtocolKind`) so
 * `Resource.client(Tag, Worker)` can auto-wire {@link connect}. Bare `Node.Tag()("x")`
 * stays address-less (`kind: undefined`) — still needs explicit connect / lookup.
 *
 * @category constructors
 * @public
 */
export const Tag = <Self, ROut = never>() => {
  function build(key: string): NodeTagClass<Self, ROut, BareAddress>;
  function build(
    key: string,
    target: {
      readonly path: string;
      readonly kind?: "IpcSocket";
      readonly onConflict?: OnConflict;
    },
  ): NodeTagClass<Self, ROut, IpcAddress>;
  function build(
    key: string,
    target: number | `:${number}`,
  ): NodeTagClass<Self, ROut, HttpAddress>;
  function build(
    key: string,
    target: `ws://${string}` | `wss://${string}`,
  ): NodeTagClass<Self, ROut, WsAddress>;
  function build(
    key: string,
    target: `http://${string}` | `https://${string}`,
  ): NodeTagClass<Self, ROut, HttpAddress>;
  function build(
    key: string,
    target: {
      readonly url: `ws://${string}` | `wss://${string}`;
      readonly kind?: "WebSocket";
      readonly onConflict?: OnConflict;
    },
  ): NodeTagClass<Self, ROut, WsAddress>;
  function build(
    key: string,
    target: {
      readonly url: string;
      readonly kind: "WebSocket";
      readonly onConflict?: OnConflict;
    },
  ): NodeTagClass<Self, ROut, WsAddress>;
  function build(
    key: string,
    target: {
      readonly url: string;
      readonly kind: "Http";
      readonly onConflict?: OnConflict;
    },
  ): NodeTagClass<Self, ROut, HttpAddress>;
  function build<const T extends ShorthandTarget>(
    key: string,
    target: T,
  ): NodeTagClass<Self, ROut, MultiAddress<KindsOf<T>>>;
  function build(
    key: string,
    target:
      | string
      | {
          readonly url: string;
          readonly kind?: ProtocolKind;
          readonly onConflict?: OnConflict;
        },
  ): NodeTagClass<Self, ROut, UrlAddressLoose>;
  function build(
    key: string,
    target?: LooseNodeTarget,
  ): NodeTagClass<
    Self,
    ROut,
    | BareAddress
    | IpcAddress
    | HttpAddress
    | WsAddress
    | UrlAddressLoose
    | MultiAddress<ProtocolKind>
  >;
  function build(
    key: string,
    target?: LooseNodeTarget,
  ): NodeTagClass<
    Self,
    ROut,
    | BareAddress
    | IpcAddress
    | HttpAddress
    | WsAddress
    | UrlAddressLoose
    | MultiAddress<ProtocolKind>
  > {
  // matches clientHttp's target: a port / ":port" / url resolves to an /rpc url; an explicit
  // `{ url }` is used verbatim. IPC nodes omit `url`. Bad positional strings do **not** throw —
  // stamp {@link InvalidHttpTarget} and leave the node unaddressed (fail on connect / clientHttp).
  let url: string | undefined;
  let path: string | undefined;
  let kind: ProtocolKind | undefined;
  let endpoints: Endpoints;
  let invalidTarget: InvalidHttpTarget | undefined;
  if (isShorthandTarget(target)) {
    // Multi-protocol shorthand `{ http?, ws?, ipc? }` — build the transport set; the primary
    // (for single-protocol readers) is http > ws > ipc. `connect` selects from the full set.
    const httpUrl = target.http;
    const wsUrl = target.ws;
    const ipcPath = target.ipc;
    endpoints = {
      ...(httpUrl !== undefined ? { Http: { url: httpUrl } } : {}),
      ...(wsUrl !== undefined ? { WebSocket: { url: wsUrl } } : {}),
      ...(ipcPath !== undefined ? { IpcSocket: { path: ipcPath } } : {}),
    };
    url = httpUrl ?? wsUrl;
    path = ipcPath;
    kind =
      httpUrl !== undefined
        ? "Http"
        : wsUrl !== undefined
          ? "WebSocket"
          : ipcPath !== undefined
            ? "IpcSocket"
            : undefined;
  } else {
    path = typeof target === "object" && target !== null ? target.path : undefined;
    if (path !== undefined || target === undefined) {
      url = undefined;
    } else if (typeof target === "object") {
      url = target.url;
    } else {
      const resolved = resolveHttpTarget(target);
      if (Result.isSuccess(resolved)) {
        url = resolved.success;
      } else {
        invalidTarget = resolved.failure;
        url = undefined;
      }
    }
    // `kind` is the SSOT for *how* to reach the node: explicit `{ kind }` wins; else `path` →
    // IpcSocket, `ws(s)://` → WebSocket, any other url → Http. Bare / invalid leave kind undefined.
    kind =
      (typeof target === "object" && target !== null ? target.kind : undefined) ??
      (path !== undefined
        ? "IpcSocket"
        : url === undefined
          ? undefined
          : url.startsWith("ws://") || url.startsWith("wss://")
            ? "WebSocket"
            : "Http");
    // The transport set — one entry from the resolved primary (multi-protocol shorthand / `over*`
    // add more). `connect` selects from it; the server asserts its transport is a member.
    endpoints =
      kind === "IpcSocket" && path !== undefined
        ? { IpcSocket: { path } }
        : kind === "WebSocket" && url !== undefined
          ? { WebSocket: { url } }
          : kind === "Http" && url !== undefined
            ? { Http: { url } }
            : {};
  }
  // Advertise conflict policy — an explicit `{ onConflict }` on the target wins (shorthand included);
  // an ordinary node defaults to `"inherit"` (resolved up the chain at advertise time).
  const onConflict: OnConflict = onConflictFromTarget(target) ?? "inherit";
  return assembleNode<
    Self,
    ROut,
    | BareAddress
    | IpcAddress
    | HttpAddress
    | WsAddress
    | UrlAddressLoose
    | MultiAddress<ProtocolKind>
  >(key, { url, path, kind, endpoints, onConflict, invalidTarget });
  }

  return build;
};

/**
 * Add transports to a node — piped on to derive a **same-identity** handle that speaks more
 * protocols: `class DropletWs extends Droplet.pipe(Node.withProtocol({ ws: "/rpc" })) {}`. Takes the
 * same `{ http, ws, ipc }` record as the declaration; keeps the node's **key** and served resources,
 * merges the transports into its `endpoints`, and **widens** its {@link ProtocolKind} set in the type.
 * Accepts single- or multi-protocol nodes alike.
 *
 * @public
 */
export const withProtocol =
  <const T extends ShorthandTarget>(transports: T) =>
  <Self, ROut, K extends ProtocolKind>(
    node: NodeTagClass<
      Self,
      ROut,
      {
        readonly kind: K;
        readonly url?: string;
        readonly path?: string;
        readonly endpoints?: Endpoints;
      }
    >,
  ): NodeTagClass<Self, ROut, MultiAddress<K | KindsOf<T>>> => {
    const add: Endpoints = {
      ...(transports.http !== undefined ? { Http: { url: transports.http } } : {}),
      ...(transports.ws !== undefined ? { WebSocket: { url: transports.ws } } : {}),
      ...(transports.ipc !== undefined
        ? { IpcSocket: { path: transports.ipc } }
        : {}),
    };
    const endpoints: Endpoints = { ...node.endpoints, ...add };
    // Keep the base node's primary if it had one, else the first of the merged set (http > ws > ipc).
    const kind: ProtocolKind | undefined =
      node.kind ??
      (endpoints.Http !== undefined
        ? "Http"
        : endpoints.WebSocket !== undefined
          ? "WebSocket"
          : endpoints.IpcSocket !== undefined
            ? "IpcSocket"
            : undefined);
    return assembleNode<Self, ROut, MultiAddress<K | KindsOf<T>>>(node.key, {
      url: node.url ?? endpoints.Http?.url ?? endpoints.WebSocket?.url,
      path: node.path ?? endpoints.IpcSocket?.path,
      kind,
      endpoints,
      // Same-identity derived handle keeps the base node's advertise policy.
      onConflict: node.onConflict,
    });
  };

/**
 * Brand a node as the fleet **lookup / identity server** — piped onto a {@link Tag} node (sibling to
 * {@link withProtocol}). Reuses the node verbatim (address, transports, key, served resources) and
 * folds its advertise policy to a **concrete** default: an explicit `{ onConflict }` survives, while an
 * ordinary node's `"inherit"` (or none) becomes `"livenessReplace"` — a lookup root never inherits.
 *
 * ```ts
 * class Directory extends Node.Tag<Directory>()("app/Lookup", { path: "/tmp/lookup.sock" }).pipe(Node.asLookup) {}
 * class Dual extends Node.Tag<Dual>()("app/Lookup", { http: "http://l/rpc", ws: "ws://l/rpc" }).pipe(Node.asLookup) {}
 * ```
 *
 * @category constructors
 * @public
 */
export const asLookup = <N extends AnyNode>(
  node: N,
): N & { readonly isLookupNode: true } =>
  Object.assign(node, {
    isLookupNode: true as const,
    onConflict: resolveOnConflict(node.onConflict),
  });

/**
 * Deriving a transport from a node that never declared one — a bare `Node.Tag()("x")` has no
 * address/`kind`, so `connect` / `listen` can't know how to reach it. Surfaces on the Layer / Effect
 * error channel (never a sync `throw`).
 *
 * @category errors
 * @public
 */
export class UnaddressedNode extends Data.TaggedError("UnaddressedNode")<{
  readonly node: string;
}> {
  override get message() {
    return (
      `Node "${this.node}" declares no address/kind, so a transport can't be derived from it. ` +
      `Give the node an address (e.g. Node.Tag()("${this.node}", 3001), { url, kind }, or { path }), ` +
      `or pass a protocol explicitly: connect(node, protocol).`
    );
  }
}

/**
 * Protocol Tag+impl (`unix` / `http` / `ws`(Tag, impl)) needs exactly one Node on the resource
 * handle (`{ node }` / {@link Resource.nodes}`([X])` / {@link Resource.andNode}).
 * `missing` = none; `ambiguous` = two or more (pick with `unix/http/ws(node, [serve…])`).
 * Anonymous transport stays `unix/http/ws([serve…])` / `unix/http/ws(serve)` — never this overload.
 *
 * @category errors
 * @public
 */
export class ListenTagNodeRequired extends Data.TaggedError(
  "ListenTagNodeRequired",
)<{
  readonly tag: string;
  readonly reason: "missing" | "ambiguous";
  readonly count: number;
}> {
  override get message() {
    if (this.reason === "ambiguous") {
      return (
        `Tag+impl listen for "${this.tag}" saw ${String(this.count)} Nodes — ` +
        `use Node.unix/http/ws(node, [Resource.serve(${this.tag}, impl)]) to pick one.`
      );
    }
    return (
      `Tag+impl listen for "${this.tag}" needs a sole Node on the Tag ` +
      `(Resource.andNode / nodes([X]) / { node }). ` +
      `For anonymous transport use Node.unix/http/ws(Resource.serve(${this.tag}, impl)).`
    );
  }
}

/**
 * {@link unix} only speaks Unix-domain IPC. The Node (or Tag-bound Node) was Http / WebSocket
 * — use {@link http} / {@link ws} for those transports.
 *
 * @category errors
 * @public
 */
export class UnixListenRequiresIpc extends Data.TaggedError(
  "UnixListenRequiresIpc",
)<{
  readonly node: string;
  readonly kind: string;
}> {
  override get message() {
    return (
      `Node.unix requires an IpcSocket Node (Unix-domain path); ` +
      `"${this.node}" is ${this.kind}. Use Node.http / Node.ws (or httpServer / wsServer) for those transports.`
    );
  }
}

/**
 * {@link http} only speaks local Http. The Node (or Tag-bound Node) was IpcSocket / WebSocket
 * (or a non-loopback URL) — use {@link unix} / {@link ws}, or {@link httpServer} for custom binds.
 *
 * @category errors
 * @public
 */
export class HttpListenRequiresHttp extends Data.TaggedError(
  "HttpListenRequiresHttp",
)<{
  readonly node: string;
  readonly kind: string;
}> {
  override get message() {
    return (
      `Node.http requires a local Http Node (loopback url or address-less mint); ` +
      `"${this.node}" is ${this.kind}. Use Node.unix / Node.ws (or httpServer / wsServer) for other transports.`
    );
  }
}

/**
 * {@link ws} only speaks local WebSocket. The Node (or Tag-bound Node) was IpcSocket / Http
 * (or a non-loopback URL) — use {@link unix} / {@link http}, or {@link wsServer} for custom binds.
 *
 * @category errors
 * @public
 */
export class WsListenRequiresWs extends Data.TaggedError("WsListenRequiresWs")<{
  readonly node: string;
  readonly kind: string;
}> {
  override get message() {
    return (
      `Node.ws requires a local WebSocket Node (loopback ws:// url or address-less mint); ` +
      `"${this.node}" is ${this.kind}. Use Node.unix / Node.http (or ipcServer / httpServer) for other transports.`
    );
  }
}

/**
 * {@link nPipe} only speaks IpcSocket (named-pipe path). The Node was Http / WebSocket —
 * use {@link http} / {@link ws} for those transports.
 *
 * @category errors
 * @public
 */
export class NPipeListenRequiresIpc extends Data.TaggedError(
  "NPipeListenRequiresIpc",
)<{
  readonly node: string;
  readonly kind: string;
}> {
  override get message() {
    return (
      `Node.nPipe requires an IpcSocket Node (Windows named-pipe path); ` +
      `"${this.node}" is ${this.kind}. Use Node.http / Node.ws (or httpServer / wsServer) for those transports.`
    );
  }
}

/**
 * {@link nPipe} is Windows-only. On POSIX use {@link unix}.
 *
 * @category errors
 * @public
 */
export class NPipeRequiresWindows extends Data.TaggedError(
  "NPipeRequiresWindows",
)<{
  readonly platform: string;
}> {
  override get message() {
    return (
      `Node.nPipe requires win32 (got "${this.platform}"). ` +
      `On POSIX use Node.unix for IpcSocket listen.`
    );
  }
}

/**
 * {@link listen} no longer binds a transport. Use the protocol entry instead.
 *
 * @category errors
 * @public
 */
export class ListenUseProtocol extends Data.TaggedError("ListenUseProtocol")<{
  readonly protocol: "unix" | "http" | "ws";
  readonly detail: string;
}> {
  override get message() {
    return (
      `Node.listen does not bind a transport (${this.detail}). ` +
      `Use Node.${this.protocol}(…) for that protocol.`
    );
  }
}

/**
 * A remote {@link Node} that didn't answer at its declared address — down, wrong port/url, or (for a
 * `socket` node) a server not speaking the socket protocol. Surfaced eagerly by {@link verifyConnection}
 * so a client fails fast at startup instead of hanging or erroring opaquely at the first call.
 *
 * @category errors
 * @public
 */
export class NodeUnreachable extends Data.TaggedError("NodeUnreachable")<{
  readonly node: string;
  readonly url: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Node "${this.node}" did not respond at ${this.url} — is it running, and are the url and kind right?`;
  }
}

/**
 * Transport answered, but the Effect RPC protocol did not — typically something else is listening
 * on the address (wrong process / wrong protocol). Surfaced by
 * {@link Resource.verifyConnection}`(node, { deep: true })` after the cheap reachability probe
 * succeeds.
 *
 * @category errors
 * @public
 */
export class ProtocolUnanswered extends Data.TaggedError("ProtocolUnanswered")<{
  readonly node: string;
  readonly url: string;
  readonly kind: ProtocolKind;
  readonly cause: unknown;
}> {
  override get message() {
    return (
      `Node "${this.node}" is reachable at ${this.url} but did not answer the RPC protocol ` +
      `(${this.kind}) — is something else listening there?`
    );
  }
}

/**
 * The peer answered {@link NodeStatus}, but the target resource key is not in `status.resources`.
 * Surfaced by {@link Resource.verifyConnection}`(node, { deep: true, resource })`.
 *
 * @category errors
 * @public
 */
export class ServiceNotServed extends Data.TaggedError("ServiceNotServed")<{
  readonly node: string;
  readonly url: string;
  readonly resource: string;
  readonly served: ReadonlyArray<string>;
}> {
  override get message() {
    const list = this.served.length === 0 ? "none" : this.served.join(", ");
    return (
      `Node "${this.node}" at ${this.url} does not serve "${this.resource}" ` +
      `(serves: ${list}).`
    );
  }
}

/**
 * The peer serves the target resource, but reports it not ready (`ready: false`).
 * Surfaced by {@link Resource.verifyConnection}`(node, { deep: true, resource })`.
 *
 * @category errors
 * @public
 */
export class ServiceNotReady extends Data.TaggedError("ServiceNotReady")<{
  readonly node: string;
  readonly url: string;
  readonly resource: string;
  readonly detail?: string;
}> {
  override get message() {
    const why = this.detail !== undefined ? ` (${this.detail})` : "";
    return `Node "${this.node}" serves "${this.resource}" but it is not ready${why}.`;
  }
}

/**
 * A node-bound resource is being served over a transport that isn't in its node's declared
 * {@link ProtocolKind} set. Because a client derives its transport *from* the node's declared
 * transports, serving it over one the node doesn't advertise (e.g. a `WebSocket`-only node served on
 * an `httpServer`) means every client dials a protocol the server never answers — the silent "blank
 * dashboard / no live data" failure. The server refuses to boot with this instead, so the mismatch is
 * loud and immediate. A multi-protocol node served over any of its declared transports passes.
 *
 * @category errors
 * @public
 */
export class ProtocolKindMismatch extends Data.TaggedError("ProtocolKindMismatch")<{
  readonly resource: string;
  readonly declared: ReadonlyArray<ProtocolKind>;
  readonly servedOver: ProtocolKind;
}> {
  override get message() {
    const serverFor = (k: ProtocolKind): string =>
      k === "Http" ? "httpServer" : k === "WebSocket" ? "wsServer" : "ipcServer";
    const kinds = this.declared.join(" / ");
    const servers = this.declared.map((k) => `Node.${serverFor(k)}`).join(" / ");
    return `Resource "${this.resource}" declares its node over ${kinds}, but is being served over ${this.servedOver} — a client dials one of [${kinds}] and would never reach it. Serve it over a declared transport (${servers}), or add ${this.servedOver} to the node.`;
  }
}

/**
 * True when `node` was branded by {@link asLookup} (the fleet lookup/identity server).
 *
 * @category guards
 * @public
 */
export const isLookupNode = (
  node: unknown,
): node is AnyNode & { readonly isLookupNode: true } =>
  (typeof node === "object" || typeof node === "function") &&
  node !== null &&
  (node as { readonly isLookupNode?: boolean }).isLookupNode === true
