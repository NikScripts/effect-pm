/**
 * Shared helpers for {@link listen} / {@link unix} (catalog serve lists, Tag args, fail layers).
 *
 * @internal
 */
import { Effect, Layer } from "effect"
import * as Resource from "../Resource"
import {
  AnyNode,
  catalogSym,
  ListenNode,
  ListenTagNodeRequired,
  ListenUseProtocol,
  UnixListenRequiresIpc,
} from "./nodeCore"

/**
 * Non-empty serve-layer list for {@link listen} / {@link unix} (deps already discharged).
 *
 * @internal
 */
export type ServeLayerList = readonly [
  Layer.Layer<never, any, never>,
  ...ReadonlyArray<Layer.Layer<never, any, never>>,
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

/** True when the first arg is a {@link Resource.Tag} (has {@link Resource.specSym}). @internal */
export const isResourceTagArg = (u: unknown): u is Resource.PipeableTag =>
  (typeof u === "object" || typeof u === "function") &&
  u !== null &&
  Resource.specSym in u;

/** True when the first arg is a serve layer or non-empty serve list. @internal */
export const isServeArg = (
  u: unknown,
): u is Layer.Layer<never, any, never> | ServeLayerList => {
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

export const failLayer = <E>(error: E): Layer.Layer<never, E> =>
  Layer.unwrap(
    Effect.map(
      Effect.fail(error),
      (impossible: never): Layer.Layer<never> => impossible,
    ),
  );

export const failUseProtocol = (
  protocol: "unix" | "http" | "ws",
  detail: string,
): Layer.Layer<never, ListenUseProtocol> =>
  failLayer(new ListenUseProtocol({ protocol, detail }));

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
