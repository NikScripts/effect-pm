/**
 * Shared helpers for {@link listen} / {@link unix} (catalog serve lists, Tag args, fail layers).
 *
 * @internal
 */
import { Effect, Layer, Option, Random } from "effect"
import * as Hyperlink from "../Hyperlink"
import {
  AnyNode,
  catalogSym,
  HttpListenRequiresHttp,
  ListenNode,
  type ListenOptions,
  ListenTagNodeRequired,
  ListenUseProtocol,
  NPipeListenRequiresIpc,
  Service as Tag,
  UnixListenRequiresIpc,
  WsListenRequiresWs,
} from "./nodeCore"
import { retype } from "./nodeServerCommon"

/**
 * Non-empty serve-layer list for {@link listen} / {@link unix} / {@link http} / {@link ws} /
 * {@link nPipe}. Open in `E`/`R` — a HyperService may depend on other services (including other
 * HyperServices); callers `Layer.provide` outside. Uses {@link Layer.Any} (not closed `never`
 * channels) so deps remain expressible without expression-level `any`.
 *
 * @internal
 */
export type ServeLayerList = readonly [
  Layer.Any,
  ...ReadonlyArray<Layer.Any>,
];

/**
 * C3: every member of `ROut` must appear in the merged serve `Layer.Success`.
 *
 * @internal
 */
export type ServesForCatalog<ROut, Serves extends ServeLayerList> = [ROut] extends [
  never,
]
  ? Serves
  : [ROut] extends [Layer.Success<Serves[number]>]
    ? Serves
    : never;

/** `ROut` stamped on a catalog Node, or `never` when undeclared. @internal */
export type CatalogROut<Node> = Node extends { readonly [catalogSym]?: infer R }
  ? Exclude<R, undefined>
  : never;

/** True when the first arg is a {@link Hyperlink.Service} (has {@link Hyperlink.specSym}). @internal */
export const isHyperlinkTagArg = (u: unknown): u is Hyperlink.PipeableTag =>
  (typeof u === "object" || typeof u === "function") &&
  u !== null &&
  Hyperlink.specSym in u;

/**
 * True when `u` is a {@link AnyNode} (listen Node / `Node.Service`), not a Hyperlink tag, Layer, or
 * {@link ListenOptions}. Nodes always expose top-level `key` plus `url`/`path`/`kind` fields.
 * @internal
 */
export const isAnyNodeArg = (u: unknown): u is AnyNode => {
  if ((typeof u !== "object" && typeof u !== "function") || u === null) {
    return false;
  }
  if (Hyperlink.specSym in u) return false;
  if (Layer.isLayer(u)) return false;
  const key = (u as { readonly key?: unknown }).key;
  if (typeof key !== "string" || key.length === 0) return false;
  return "url" in u || "path" in u || "kind" in u;
};

/** True when the first arg is a serve layer or non-empty serve list. @internal */
export const isServeArg = (
  u: unknown,
): u is Layer.Any | ServeLayerList => {
  if (Layer.isLayer(u)) return true;
  return (
    Array.isArray(u) &&
    u.length > 0 &&
    Layer.isLayer(u[0])
  );
};

/** Tag key for listen errors / anonymous mint labels. @internal */
export const tagKeyOf = (tag: Hyperlink.PipeableTag): string => {
  const key = (tag as { readonly key?: unknown }).key;
  return typeof key === "string" ? key : "unknown";
};

/**
 * Resolve Tag+impl listen target (shared by http / ws / unix / nPipe):
 * - third arg is a Node → listen on that Node (no `andNode` required)
 * - else tag is sole-bound → that Node (+ third as address options)
 * - else multi-bound → ambiguous error
 * - else unbound → nameless mint (+ third as address options)
 * @internal
 */
export type ResolvedTagListenTarget =
  | {
      readonly _tag: "Node";
      readonly node: AnyNode;
      readonly addressArg: unknown;
    }
  | { readonly _tag: "Nameless"; readonly addressArg: unknown }
  | {
      readonly _tag: "TagNodeError";
      readonly tag: string;
      readonly reason: "Missing" | "Ambiguous";
      readonly count: number;
    };

export const resolveTagListenTarget = (
  tag: Hyperlink.PipeableTag,
  third: unknown,
): ResolvedTagListenTarget => {
  if (isAnyNodeArg(third)) {
    return { _tag: "Node", node: third, addressArg: undefined };
  }
  const bound = Hyperlink.nodeOf(tag);
  const fleet = Hyperlink.nodesOf(
    tag as Hyperlink.HyperlinkTag<unknown, Hyperlink.Spec>,
  );
  if (bound !== undefined) {
    return {
      _tag: "Node",
      node: bound as AnyNode,
      addressArg: third,
    };
  }
  if (fleet.length > 1) {
    return {
      _tag: "TagNodeError",
      tag: tagKeyOf(tag),
      reason: "Ambiguous",
      count: fleet.length,
    };
  }
  return { _tag: "Nameless", addressArg: third };
};

/** One-serve list from Tag+impl (erased serve for listen dispatch). @internal */
export const serveListFromTagImpl = (
  tag: Hyperlink.PipeableTag,
  impl: unknown,
): ServeLayerList => {
  const serveErased = retype<
    (tag: Hyperlink.PipeableTag, impl: unknown) => Layer.Layer<never, never, never>
  >(Hyperlink.serve as never);
  return [serveErased(tag, impl)] as ServeLayerList;
};

/**
 * Soft-bake {@link Lookup.layer} when {@link Identity.Service} is absent — nameless listens
 * (http / ws / unix / nPipe) need claim + advertise with no caller Lookup pipe.
 * `Layer.provide(Lookup.layerOptions(…))` still wins when Identity is already in env.
 * @internal
 */
export const softBakeLookupLayer = <A, E, R>(
  core: Layer.Layer<A, E, R>,
): Effect.Effect<Layer.Layer<A, E, R>> =>
  Effect.gen(function* () {
    const Lookup = yield* Effect.promise(() => import("../Lookup"));
    const Identity = yield* Effect.promise(() => import("../Identity"));
    const identity = yield* Effect.serviceOption(Identity.Service);
    if (Option.isSome(identity)) {
      return core;
    }
    return core.pipe(Layer.provide(Lookup.layer)) as Layer.Layer<A, E, R>;
  });

/** Http / WebSocket (or url-only) Nodes are not Unix-domain IPC. @internal */
export const isNonIpcNode = (node: AnyNode): boolean =>
  node.kind === "Http" ||
  node.kind === "WebSocket" ||
  (node.path === undefined && typeof node.url === "string");

/** Nodes that need {@link unix} (IpcSocket / address-less ipc). @internal */
export const isIpcListenNode = (node: AnyNode): boolean => {
  if (isNonIpcNode(node)) return false;
  if (typeof node.path === "string") return true;
  if (node.kind === "IpcSocket") return true;
  // Address-less → ipc mint (kind unset).
  return node.path === undefined && node.url === undefined;
};

/** A Layer that fails immediately with `error` (eager transport-wiring failure). @internal */
export const failLayer = <E>(error: E): Layer.Layer<never, E> =>
  Layer.unwrap(
    Effect.map(
      Effect.fail(error),
      (impossible: never): Layer.Layer<never> => impossible,
    ),
  );

/** A Layer that fails with {@link ListenUseProtocol} — listen used where connect was meant. @internal */
export const failUseProtocol = (
  protocol: "unix" | "http" | "ws",
  detail: string,
): Layer.Layer<never, ListenUseProtocol> =>
  failLayer(new ListenUseProtocol({ protocol, detail }));

/** A Layer that fails with a tag-node resolution error (missing / ambiguous bound node). @internal */
export const failListenTagNode = (fields: {
  readonly tag: string;
  readonly reason: "Missing" | "Ambiguous";
  readonly count: number;
}): Layer.Layer<never, ListenTagNodeRequired> =>
  failLayer(new ListenTagNodeRequired(fields));

/** Fail a Layer build with {@link UnixListenRequiresIpc}. @internal */
export const unixRequiresIpcLayer = (
  node: string,
  kind: string,
): Layer.Layer<never, UnixListenRequiresIpc> =>
  failLayer(new UnixListenRequiresIpc({ node, kind }));

/** Fail a Layer build with {@link NPipeListenRequiresIpc}. @internal */
export const nPipeRequiresIpcLayer = (
  node: string,
  kind: string,
): Layer.Layer<never, NPipeListenRequiresIpc> =>
  failLayer(new NPipeListenRequiresIpc({ node, kind }));

/** Fail a Layer build with {@link HttpListenRequiresHttp}. @internal */
export const httpRequiresHttpLayer = (
  node: string,
  kind: string,
): Layer.Layer<never, HttpListenRequiresHttp> =>
  failLayer(new HttpListenRequiresHttp({ node, kind }));

/**
 * Nodes that are not Http for {@link http} (IpcSocket / WebSocket / ws urls / unix paths).
 * @internal
 */
export const isNonHttpNode = (node: AnyNode): boolean =>
  node.kind === "IpcSocket" ||
  node.kind === "WebSocket" ||
  typeof node.path === "string" ||
  (typeof node.url === "string" &&
    (node.url.startsWith("ws://") || node.url.startsWith("wss://")));

/** Nodes that need {@link http} (Http kind / http(s) url). @internal */
export const isHttpListenNode = (node: AnyNode): boolean => {
  if (isNonHttpNode(node)) return false;
  if (node.kind === "Http") return true;
  if (typeof node.url === "string") {
    return (
      node.url.startsWith("http://") || node.url.startsWith("https://")
    );
  }
  return false;
};

/** Fail a Layer build with {@link WsListenRequiresWs}. @internal */
export const wsRequiresWsLayer = (
  node: string,
  kind: string,
): Layer.Layer<never, WsListenRequiresWs> =>
  failLayer(new WsListenRequiresWs({ node, kind }));

/**
 * Nodes that are not WebSocket for {@link ws} (IpcSocket / Http / http(s) urls / unix paths).
 * @internal
 */
export const isNonWsNode = (node: AnyNode): boolean =>
  node.kind === "IpcSocket" ||
  node.kind === "Http" ||
  typeof node.path === "string" ||
  (typeof node.url === "string" &&
    (node.url.startsWith("http://") || node.url.startsWith("https://")));

/** Nodes that need {@link ws} (WebSocket kind / ws(s) url). @internal */
export const isWsListenNode = (node: AnyNode): boolean => {
  if (isNonWsNode(node)) return false;
  if (node.kind === "WebSocket") return true;
  if (typeof node.url === "string") {
    return node.url.startsWith("ws://") || node.url.startsWith("wss://");
  }
  return false;
};

/** True when `node` was built with {@link Node}.Prototype. @internal */
export const isPrototypeNode = (node: unknown): boolean =>
  (typeof node === "object" || typeof node === "function") &&
  node !== null &&
  (node as { readonly isPrototype?: boolean }).isPrototype === true;

/** True when `node` came from {@link Node}.Prototype.instance. @internal */
export const isDynamicInstanceNode = (node: unknown): boolean =>
  (typeof node === "object" || typeof node === "function") &&
  node !== null &&
  (node as { readonly isDynamicInstance?: boolean }).isDynamicInstance === true;

/** Stamp {@link ListenNode} so identity `serve` claims use the listen endpoint. @internal */
export const withListenNode = <A, E, R>(
  node: AnyNode,
  server: Layer.Layer<A, E, R>,
): Layer.Layer<A | ListenNode, E, R> =>
  server.pipe(Layer.provideMerge(Layer.succeed(ListenNode, node)));

/**
 * Normalize a positional {@link HttpListenArg} to {@link ListenOptions}.
 * `3000` / `":3000"` → `{ port }`; `http(s)://…` → `{ url }`; object as-is. @internal
 */
export const coerceHttpListenOptions = (
  arg: number | string | ListenOptions | undefined,
): ListenOptions | undefined => {
  if (arg === undefined) return undefined;
  if (typeof arg === "number") return { port: arg };
  if (typeof arg === "string") {
    if (/^:\d+$/.test(arg)) return { port: Number(arg.slice(1)) };
    return { url: arg };
  }
  return arg;
};

/**
 * Normalize a positional {@link WsListenArg} to {@link ListenOptions}. @internal
 */
export const coerceWsListenOptions = (
  arg: number | string | ListenOptions | undefined,
): ListenOptions | undefined => coerceHttpListenOptions(arg);

/**
 * Normalize a positional {@link IpcListenArg}: path string → stamp target; object → options.
 * @internal
 */
export const coerceIpcListenArg = (
  arg: string | ListenOptions | undefined,
): {
  readonly options: ListenOptions | undefined;
  readonly path: string | undefined;
} => {
  if (arg === undefined) return { options: undefined, path: undefined };
  if (typeof arg === "string") return { options: undefined, path: arg };
  return { options: arg, path: undefined };
};

/**
 * Resolve a fixed Http listen url from {@link ListenOptions.port} / {@link ListenOptions.url}.
 * `url` wins when both are set. @internal
 */
export const httpListenUrlFromOptions = (
  options: ListenOptions | undefined,
): string | undefined => {
  if (options?.url !== undefined && options.url.length > 0) {
    return options.url;
  }
  if (options?.port !== undefined) {
    return `http://127.0.0.1:${String(options.port)}/rpc`;
  }
  return undefined;
};

/**
 * Resolve a fixed WebSocket listen url from options. Bare `http(s)://` urls are rewritten to
 * `ws(s)://` so `port` / `url` match the Http listen shape. @internal
 */
export const wsListenUrlFromOptions = (
  options: ListenOptions | undefined,
): string | undefined => {
  if (options?.url !== undefined && options.url.length > 0) {
    const raw = options.url;
    if (raw.startsWith("http://")) return `ws://${raw.slice("http://".length)}`;
    if (raw.startsWith("https://")) return `wss://${raw.slice("https://".length)}`;
    return raw;
  }
  if (options?.port !== undefined) {
    return `ws://127.0.0.1:${String(options.port)}/rpc`;
  }
  return undefined;
};

/**
 * When `node` has no address yet, stamp a fixed listen url from options (nameless / address-less
 * Http·Ws). Leaves already-addressed nodes alone. @internal
 */
export const stampListenUrl = (
  node: AnyNode,
  url: string | undefined,
  kind: "Http" | "WebSocket",
): AnyNode => {
  if (url === undefined || node.url !== undefined || node.path !== undefined) {
    return node;
  }
  return Object.assign(Tag()(node.key, { url, kind }), {
    [catalogSym]: (node as { readonly [catalogSym]?: unknown })[catalogSym],
  }) as AnyNode;
};

/**
 * When `node` has no address yet, stamp a fixed ipc path (nameless unix / nPipe shorthand).
 * Leaves already-addressed nodes alone. @internal
 */
export const stampListenPath = (
  node: AnyNode,
  path: string | undefined,
): AnyNode => {
  if (path === undefined || path.length === 0 || node.path !== undefined || node.url !== undefined) {
    return node;
  }
  return Object.assign(Tag()(node.key, { path }), {
    [catalogSym]: (node as { readonly [catalogSym]?: unknown })[catalogSym],
  }) as AnyNode;
};

/**
 * The key an anonymous `unix` / `http` / `ws` / `nPipe` listen mints for its address-less node: a
 * **legible name** from the first served HyperService's key (`@app/Emails` → `Emails` — last segment only)
 * plus a random tail, under the full package prefix — e.g.
 * `hyperlink-ts/anonymous-node/Emails#k3f9q`. `Random` (a default Reference, no service to
 * provide) gives the tail; the random keeps it unique per materialization (a generated key is a local,
 * ephemeral identity — a shared identity needs an explicit `Node.Service` key). @internal
 */
export const anonymousNodeKey = (
  list: ServeLayerList,
): Effect.Effect<string> =>
  Effect.map(Random.next, (n) => {
    const rand = n.toString(36).slice(2, 8)
    const firstKey = Hyperlink.servedKeyOf(list[0])
    const name = firstKey?.split("/").pop() ?? "node"
    return `hyperlink-ts/anonymous-node/${name}#${rand}`
  })
