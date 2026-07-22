/**
 * Shared helpers for {@link listen} / {@link unix} (catalog serve lists, Tag args, fail layers).
 *
 * @internal
 */
import { Effect, Layer, Random } from "effect"
import * as Hyperlink from "../Hyperlink"
import {
  AnyNode,
  catalogSym,
  HttpListenRequiresHttp,
  ListenNode,
  ListenTagNodeRequired,
  ListenUseProtocol,
  NPipeListenRequiresIpc,
  UnixListenRequiresIpc,
  WsListenRequiresWs,
} from "./nodeCore"

/**
 * Non-empty serve-layer list for {@link listen} / {@link unix} (deps already discharged).
 *
 * @internal
 */
export type ServeLayerList = readonly [
  Layer.Layer<never, never, never>,
  ...ReadonlyArray<Layer.Layer<never, never, never>>,
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

/** True when the first arg is a {@link Hyperlink.Tag} (has {@link Hyperlink.specSym}). @internal */
export const isHyperlinkTagArg = (u: unknown): u is Hyperlink.PipeableTag =>
  (typeof u === "object" || typeof u === "function") &&
  u !== null &&
  Hyperlink.specSym in u;

/** True when the first arg is a serve layer or non-empty serve list. @internal */
export const isServeArg = (
  u: unknown,
): u is Layer.Layer<never, never, never> | ServeLayerList => {
  if (Layer.isLayer(u)) return true;
  return (
    Array.isArray(u) &&
    u.length > 0 &&
    Layer.isLayer(u[0])
  );
};

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
  readonly reason: "missing" | "ambiguous";
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
 * The key an anonymous `unix` / `http` / `ws` / `nPipe` listen mints for its address-less node: a
 * **legible name** from the first served resource's key (`@app/Emails` → `Emails` — last segment only)
 * plus a random tail, under the full package prefix — e.g.
 * `hyperlink-ts/anonymous-node/Emails#k3f9q`. `Random` (a default Reference, no service to
 * provide) gives the tail; the random keeps it unique per materialization (a generated key is a local,
 * ephemeral identity — a shared identity needs an explicit `Node.Tag` key). @internal
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
