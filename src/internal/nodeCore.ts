/**
 * Node core — Tag / Prototype / Lookup constructors + catalog types.
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

/** Late-bound {@link Resource.store} for `Node.Tag(...).logs`. @internal */
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
 * @public
 */
export type ProtocolKind = "Http" | "WebSocket" | "IpcSocket";

/** A {@link Tag} erased — transport address (`url` and/or Unix `path`) plus
 *  {@link ProtocolKind} `kind`, so a tag's `distributed` set is self-describing about
 *  *where* AND *how* to reach each one. @public */
export type AnyNode = NodeKey<unknown> & {
  readonly url: string | undefined;
  readonly path: string | undefined;
  readonly kind: ProtocolKind | undefined;
};

/** An {@link AnyNode} that can derive {@link connect} with no protocol argument —
 *  `kind` set, and either a `url` (Http/WebSocket) or a Unix `path` (IpcSocket). @public */
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
 * `import type` for those handles (C4). Use with {@link listen} / {@link clientsFor}.
 *
 * Catalog members must be structurally distinct types (different specs / service shapes) —
 * identical Tag shapes collapse in TypeScript, so `Jobs | Emails` cannot prove C3.
 *
 * @public
 */
export type CatalogNode<Self, ROut = never> = NodeKey<Self> & {
  readonly url: string | undefined;
  readonly path: string | undefined;
  readonly kind: ProtocolKind | undefined;
  readonly [catalogSym]?: ROut;
};

/**
 * Address-less {@link listen} lost the `Node.key` claim — another process owns this Node.
 * Winner endpoint is in `original` (dial via {@link lookupClient} / `client`).
 *
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
 * The Node {@link listen} is binding (concrete or minted address-less). Identity claims prefer
 * this over a Tag-bound Node when present.
 *
 * @public
 */
export class ListenNode extends Context.Service<ListenNode, AnyNode>()(
  "@nikscripts/effect-pm/internal/nodeCore/ListenNode",
) {}

/** Options for {@link listen} — rpc path / health / ipc unlink; not the Http bind port (C2). @public */
export type ListenOptions = {
  readonly path?: HttpRouter.PathInput;
  readonly serialization?: Layer.Layer<RpcSerialization.RpcSerialization>;
  readonly health?: { readonly path?: HttpRouter.PathInput };
  readonly node?: string | { readonly key: string };
  readonly unlink?: boolean;
};

/**
 * {@link resolveHttpTarget} / a positional `Node.Tag(name, badString)` got a string that is
 * neither a port (`":3009"`), a port number, nor an `http(s)://` url. Surfaces on the
 * **Layer / Effect error channel** (same precedent as {@link UnaddressedNode}) — never a
 * sync throw. Catch via `Exit` / `CatchTag` when building `clientHttp` or derived `connect`.
 *
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
    };

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
 * Loose dialable url node — single object type (not a union) so `class extends Tag(…)`
 * stays constructable. Precise overloads return {@link HttpAddress} / {@link WsAddress}.
 *
 * @internal
 */
type UrlAddressLoose = {
  readonly url: string;
  readonly path: undefined;
  readonly kind: "Http" | "WebSocket";
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

/**
 * Declare a **node** — a named transport endpoint a resource connects to. A `Context.Service`
 * whose value is the RPC client {@link NodeProtocol}; extend it like any Effect service.
 * Optional catalog type param `ROut` (C2) — prefer `import type` for those handles (C4).
 * Templates (no address until cloned) live on {@link Node}.Prototype:
 *
 * ```ts
 * class EdgeNode extends Node.Tag<EdgeNode>("edge") {}                       // no address yet
 * class Worker extends Node.Tag<Worker>("worker", 3001) {}                   // → http://localhost:3001/rpc, kind "Http"
 * class Mail extends Node.Tag<Mail>("mail", "https://mail.internal/rpc") {}  // full url, as-is, kind "Http"
 * class Live extends Node.Tag<Live>("live", { url: "wss://live/rpc" }) {}    // kind "WebSocket" (inferred from ws url)
 * class Push extends Node.Tag<Push>("push", { url: "/rpc", kind: "WebSocket" }) {} // same-origin path, explicit kind
 * class Local extends Node.Tag<Local>("local", { path: "/tmp/local.sock" }) {} // kind "IpcSocket" (Unix domain)
 * import type { Jobs, Emails } from "@app/contracts"
 * class AppWorker extends Node.Tag<AppWorker, Jobs | Emails>("app/Worker", { path: "/tmp/w.sock" }) {}
 * class MailWorker extends Node.Prototype<MailWorker, Mail>("app/MailWorker") {}
 * ```
 *
 * The address is optional and matches {@link clientHttp}'s `target`: a **port** (`3001` or `":3001"`
 * → `http://localhost:3001/rpc`), a full **url** (used as-is), `{ url, kind }` for an explicit
 * endpoint, or `{ path }` for a **Unix-domain** socket (`kind: "IpcSocket"`). The node carries
 * {@link ProtocolKind} so the topology is self-describing about *where* AND *how*:
 * {@link connect}`(node)` derives the transport with no protocol argument.
 *
 * Dialable targets return an {@link AddressedNode} (`kind: ProtocolKind`) so
 * `Resource.client(Tag, Worker)` can auto-wire {@link connect}. Bare `Node.Tag("x")`
 * stays address-less (`kind: undefined`) — still needs explicit connect / lookup.
 *
 * @public
 */
export function Tag<Self, ROut = never>(
  name: string,
): NodeTagClass<Self, ROut, BareAddress>;
export function Tag<Self, ROut = never>(
  name: string,
  target: { readonly path: string; readonly kind?: "IpcSocket" },
): NodeTagClass<Self, ROut, IpcAddress>;
export function Tag<Self, ROut = never>(
  name: string,
  target: number | `:${number}`,
): NodeTagClass<Self, ROut, HttpAddress>;
export function Tag<Self, ROut = never>(
  name: string,
  target: `ws://${string}` | `wss://${string}`,
): NodeTagClass<Self, ROut, WsAddress>;
export function Tag<Self, ROut = never>(
  name: string,
  target: `http://${string}` | `https://${string}`,
): NodeTagClass<Self, ROut, HttpAddress>;
export function Tag<Self, ROut = never>(
  name: string,
  target: {
    readonly url: `ws://${string}` | `wss://${string}`;
    readonly kind?: "WebSocket";
  },
): NodeTagClass<Self, ROut, WsAddress>;
export function Tag<Self, ROut = never>(
  name: string,
  target: { readonly url: string; readonly kind: "WebSocket" },
): NodeTagClass<Self, ROut, WsAddress>;
export function Tag<Self, ROut = never>(
  name: string,
  target: { readonly url: string; readonly kind: "Http" },
): NodeTagClass<Self, ROut, HttpAddress>;
export function Tag<Self, ROut = never>(
  name: string,
  target: string | { readonly url: string; readonly kind?: ProtocolKind },
): NodeTagClass<Self, ROut, UrlAddressLoose>;
export function Tag<Self, ROut = never>(
  name: string,
  target?: LooseNodeTarget,
): NodeTagClass<
  Self,
  ROut,
  BareAddress | IpcAddress | HttpAddress | WsAddress | UrlAddressLoose
>;
export function Tag<Self, ROut = never>(
  name: string,
  target?: LooseNodeTarget,
): NodeTagClass<
  Self,
  ROut,
  BareAddress | IpcAddress | HttpAddress | WsAddress | UrlAddressLoose
> {
  const path =
    typeof target === "object" && target !== null ? target.path : undefined;
  // matches clientHttp's target: a port / ":port" / url resolves to an /rpc url; an explicit
  // `{ url }` is used verbatim. IPC nodes omit `url`. Bad positional strings do **not** throw —
  // stamp {@link InvalidHttpTarget} and leave the node unaddressed (fail on connect / clientHttp).
  let url: string | undefined;
  let invalidTarget: InvalidHttpTarget | undefined;
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
  const kind: ProtocolKind | undefined =
    (typeof target === "object" && target !== null ? target.kind : undefined) ??
    (path !== undefined
      ? "IpcSocket"
      : url === undefined
        ? undefined
        : url.startsWith("ws://") || url.startsWith("wss://")
          ? "WebSocket"
          : "Http");
  const node = Object.assign(Context.Service<Self, NodeProtocol>()(name), {
    url,
    path,
    kind,
    ...(invalidTarget !== undefined
      ? { [invalidHttpTargetSym]: invalidTarget }
      : {}),
  });
  // Stamp catalog brand — preserves Context.Service constructability
  // (`class X extends Node.Tag()`); `ROut` stays type-only at the value (C2 / C4).
  // Overload impl return: runtime fields are narrower than the union of address shapes.
  return Object.assign(node, {
    /**
     * Node-wide durable log registration — same as {@link store}`(this node)`.
     * Use on an app `Store.Service`: `Store.Service(...)(WnbaNode.logs, Process.store(Daily))`.
     */
    get logs() {
      return storeOrThrow(node);
    },
    [catalogSym]: undefined as ROut | undefined,
  }) as NodeTagClass<
    Self,
    ROut,
    BareAddress | IpcAddress | HttpAddress | WsAddress | UrlAddressLoose
  >;
}

/**
 * Deriving a transport from a node that never declared one — a bare `Node.Tag("x")` has no
 * address/`kind`, so `connect` / `listen` can't know how to reach it. Surfaces on the Layer / Effect
 * error channel (never a sync `throw`).
 *
 * @public
 */
export class UnaddressedNode extends Data.TaggedError("UnaddressedNode")<{
  readonly node: string;
}> {
  override get message() {
    return (
      `Node "${this.node}" declares no address/kind, so a transport can't be derived from it. ` +
      `Give the node an address (e.g. Node.Tag("${this.node}", 3001), { url, kind }, or { path }), ` +
      `or pass a protocol explicitly: connect(node, protocol).`
    );
  }
}

/**
 * A remote {@link Node} that didn't answer at its declared address — down, wrong port/url, or (for a
 * `socket` node) a server not speaking the socket protocol. Surfaced eagerly by {@link verifyConnection}
 * so a client fails fast at startup instead of hanging or erroring opaquely at the first call.
 *
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
 * A {@link Tag} marked as the identity/lookup server.
 *
 * Same-machine: `{ path }` (ipc). Cross-network: pass a full address — required; no elect (L1).
 * Dialable targets return an {@link AddressedNode} (same overloads as {@link Tag}).
 *
 * @public
 */
export function Lookup<Self>(
  name: string,
): NodeTagClass<Self, never, BareAddress> & {
  readonly isLookupNode: true
};
export function Lookup<Self>(
  name: string,
  target: { readonly path: string; readonly kind?: "IpcSocket" },
): NodeTagClass<Self, never, IpcAddress> & {
  readonly isLookupNode: true
};
export function Lookup<Self>(
  name: string,
  target: number | `:${number}`,
): NodeTagClass<Self, never, HttpAddress> & {
  readonly isLookupNode: true
};
export function Lookup<Self>(
  name: string,
  target: `ws://${string}` | `wss://${string}`,
): NodeTagClass<Self, never, WsAddress> & {
  readonly isLookupNode: true
};
export function Lookup<Self>(
  name: string,
  target: `http://${string}` | `https://${string}`,
): NodeTagClass<Self, never, HttpAddress> & {
  readonly isLookupNode: true
};
export function Lookup<Self>(
  name: string,
  target: string | { readonly url: string; readonly kind?: ProtocolKind },
): NodeTagClass<Self, never, UrlAddressLoose> & {
  readonly isLookupNode: true
};
export function Lookup<Self>(
  name: string,
  target?: LooseNodeTarget,
): NodeTagClass<
  Self,
  never,
  BareAddress | IpcAddress | HttpAddress | WsAddress | UrlAddressLoose
> & {
  readonly isLookupNode: true
};
export function Lookup<Self>(
  name: string,
  target?: LooseNodeTarget,
): NodeTagClass<
  Self,
  never,
  BareAddress | IpcAddress | HttpAddress | WsAddress | UrlAddressLoose
> & {
  readonly isLookupNode: true
} {
  const node = Tag<Self>(name, target)
  return Object.assign(node, { isLookupNode: true as const })
}

/** True when `node` was built with {@link Lookup}. @public */
export const isLookupNode = (
  node: unknown,
): node is AnyNode & { readonly isLookupNode: true } =>
  (typeof node === "object" || typeof node === "function") &&
  node !== null &&
  (node as { readonly isLookupNode?: boolean }).isLookupNode === true
