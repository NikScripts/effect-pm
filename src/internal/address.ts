/**
 * Address engine — dial values with optional labels (unlabeled ≠ primary).
 *
 * @module internal/address
 * @internal
 */
import { Data } from "effect";
import type { ProtocolKind } from "./nodeCore";

/**
 * Two addresses resolve to the same concrete dial.
 *
 * @internal
 */
export class AddressDialOverlap extends Data.TaggedError("AddressDialOverlap")<{
  readonly dial: string;
}> {
  override get message() {
    return `Address dial overlap: ${this.dial}`;
  }
}

/** Sentinel brand for {@link unixFromKey}. @internal */
export const UnixFromKeyBrand = "~hyperlink-ts/Address/unixFromKey" as const;

/**
 * Key-derived Unix primary dial — sentinel value, not a call (`Address.unixFromKey`).
 *
 * @internal
 */
export interface UnixFromKeySentinel {
  readonly [UnixFromKeyBrand]: typeof UnixFromKeyBrand;
  readonly _tag: "UnixFromKey";
  readonly label: undefined;
  readonly kind: "IpcSocket";
}

/** Concrete dial payload (resolved at bind for {@link UnixFromKeySentinel}). @internal */
export type AddressDial =
  | { readonly _tag: "HttpPort"; readonly port: number }
  | { readonly _tag: "HttpUrl"; readonly url: string }
  | { readonly _tag: "WsUrl"; readonly url: string }
  | { readonly _tag: "UnixPath"; readonly path: string }
  | { readonly _tag: "UnixFromKey" };

/**
 * One address — optional label (unlabeled when `undefined`).
 *
 * @internal
 */
export interface AddressValue<
  Label extends string | undefined = undefined,
  Kind extends ProtocolKind = ProtocolKind,
> {
  readonly _tag: "Address";
  readonly label: Label;
  readonly kind: Kind;
  readonly dial: AddressDial;
}

/** Any address value (incl. unixFromKey sentinel). @internal */
export type AnyAddress =
  | AddressValue<string | undefined, ProtocolKind>
  | UnixFromKeySentinel;

/** Normalize make/pipe input to a readonly address list. @internal */
export type NormalizeAddresses<A> = A extends readonly AnyAddress[]
  ? A
  : A extends AnyAddress
    ? readonly [A]
    : readonly [];

/** Labeled sides only — unlabeled (`undefined`) dropped. @internal */
export type LabelsOf<As extends ReadonlyArray<AnyAddress>> = Extract<
  As[number]["label"],
  string
>;

/** Append one address onto a list (type-level). @internal */
export type AppendAddress<
  As extends ReadonlyArray<AnyAddress>,
  A extends AnyAddress,
> = readonly [...As, A];

/** Merge label unions. @internal */
export type MergeLabels<L extends string, A extends AnyAddress> = L | Extract<
  A["label"],
  string
>;

const isPortString = (s: string): s is `:${number}` => /^:\d+$/.test(s);

const httpDial = (
  input: number | `:${number}` | string,
): AddressDial => {
  if (typeof input === "number") {
    return { _tag: "HttpPort", port: input };
  }
  if (isPortString(input)) {
    return { _tag: "HttpPort", port: Number(input.slice(1)) };
  }
  return { _tag: "HttpUrl", url: input };
};

const wsDial = (input: number | `:${number}` | string): AddressDial => {
  if (typeof input === "number") {
    return { _tag: "WsUrl", url: `ws://localhost:${String(input)}/rpc` };
  }
  if (isPortString(input)) {
    return {
      _tag: "WsUrl",
      url: `ws://localhost:${input.slice(1)}/rpc`,
    };
  }
  return { _tag: "WsUrl", url: input };
};

/** Host forms that all name the same loopback interface. @internal */
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

/** Host forms that bind every interface, so they cover any host on the same port. @internal */
const anyHosts = new Set(["0.0.0.0", "::"]);

/** Default port per URL scheme — a url without one still names a concrete socket. @internal */
const defaultPorts: Readonly<Record<string, number>> = {
  "http:": 80,
  "https:": 443,
  "ws:": 80,
  "wss:": 443,
};

/**
 * The socket a dial resolves to — what overlap is actually about.
 *
 * `kind` is kept: http and ws on one port is a legitimate upgrade-on-the-same-server config, so
 * they are not treated as the same socket. Within a kind, every spelling of one socket normalises
 * to one value — a bare port, `localhost`, `127.0.0.1`, and `::1` are all the same listener.
 *
 * @internal
 */
type DialSocket =
  | {
      readonly _tag: "Inet";
      readonly kind: ProtocolKind;
      readonly host: string;
      readonly port: number;
    }
  | { readonly _tag: "Path"; readonly path: string }
  | { readonly _tag: "FromKey" }
  | { readonly _tag: "Opaque"; readonly value: string };

/** Normalise a url's authority; `Opaque` when it will not parse (never throws). @internal */
const inetFromUrl = (kind: ProtocolKind, url: string): DialSocket => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { _tag: "Opaque", value: `${kind}:url:${url}` };
  }
  const raw = parsed.hostname.toLowerCase();
  const host = loopbackHosts.has(raw) ? "127.0.0.1" : anyHosts.has(raw) ? "*" : raw;
  const port =
    parsed.port === ""
      ? (defaultPorts[parsed.protocol] ?? 0)
      : Number(parsed.port);
  return { _tag: "Inet", kind, host, port };
};

/** The socket an address resolves to. @internal */
const dialSocket = (address: AnyAddress): DialSocket => {
  if (address._tag === "UnixFromKey") return { _tag: "FromKey" };
  const { kind, dial } = address;
  switch (dial._tag) {
    case "HttpPort":
      // `nodeMake` derives `http://localhost:<port>/rpc` from a bare port, so a bare port and that
      // url are the same listener.
      return { _tag: "Inet", kind, host: "127.0.0.1", port: dial.port };
    case "HttpUrl":
      return inetFromUrl(kind, dial.url);
    case "WsUrl":
      return inetFromUrl(kind, dial.url);
    case "UnixPath":
      return { _tag: "Path", path: dial.path };
    case "UnixFromKey":
      return { _tag: "FromKey" };
  }
};

/** Render a {@link DialSocket} for identity and error text. @internal */
const socketLabel = (socket: DialSocket): string => {
  switch (socket._tag) {
    case "Inet":
      return `${socket.kind}:${socket.host}:${String(socket.port)}`;
    case "Path":
      return `IpcSocket:${socket.path}`;
    case "FromKey":
      return "IpcSocket:unixFromKey";
    case "Opaque":
      return socket.value;
  }
};

/**
 * Stable dial identity for overlap checks — the socket a dial resolves to, not the shape it was
 * written in. `Address.http(8080)` and `Address.http("http://localhost:8080/rpc")` share one.
 *
 * @internal
 */
export const dialIdentity = (address: AnyAddress): string =>
  socketLabel(dialSocket(address));

/** Do two sockets contend for the same listener? Bind-any covers every host on its port. @internal */
const overlaps = (a: DialSocket, b: DialSocket): boolean => {
  if (a._tag === "Inet" && b._tag === "Inet") {
    if (a.kind !== b.kind || a.port !== b.port) return false;
    return a.host === b.host || a.host === "*" || b.host === "*";
  }
  if (a._tag === "Path" && b._tag === "Path") return a.path === b.path;
  if (a._tag === "FromKey" && b._tag === "FromKey") return true;
  if (a._tag === "Opaque" && b._tag === "Opaque") return a.value === b.value;
  return false;
};

/**
 * Reject dials that contend for the same listener. Pairwise rather than a `Set` because bind-any
 * *covers* loopback rather than equalling it; the input is one node's address list, so the
 * quadratic cost is irrelevant.
 *
 * @internal
 */
export const assertNoDialOverlap = (
  addresses: ReadonlyArray<AnyAddress>,
): void => {
  const sockets = addresses.map(dialSocket);
  for (let i = 1; i < sockets.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const a = sockets[i]!;
      const b = sockets[j]!;
      if (overlaps(a, b)) {
        throw new AddressDialOverlap({ dial: socketLabel(a) });
      }
    }
  }
};

export const unixFromKey: UnixFromKeySentinel = {
  [UnixFromKeyBrand]: UnixFromKeyBrand,
  _tag: "UnixFromKey",
  label: undefined,
  kind: "IpcSocket",
};

export const isUnixFromKey = (u: unknown): u is UnixFromKeySentinel =>
  typeof u === "object" &&
  u !== null &&
  (u as { readonly _tag?: unknown })._tag === "UnixFromKey";

export const isAddressValue = (u: unknown): u is AddressValue =>
  typeof u === "object" &&
  u !== null &&
  (u as { readonly _tag?: unknown })._tag === "Address";

/** Http factory overloads. @internal */
export function http(port: number): AddressValue<undefined, "Http">;
export function http(port: `:${number}`): AddressValue<undefined, "Http">;
export function http(url: string): AddressValue<undefined, "Http">;
export function http(
  ports: ReadonlyArray<number | `:${number}` | string>,
): ReadonlyArray<AddressValue<undefined, "Http">>;
export function http<const L extends string>(
  labeled: { readonly [K in L]: number | `:${number}` | string },
): { readonly [K in L]: AddressValue<K, "Http"> }[L][];
export function http(
  input:
    | number
    | string
    | ReadonlyArray<number | string>
    | Record<string, number | string>,
):
  | AddressValue<undefined, "Http">
  | ReadonlyArray<AddressValue<string | undefined, "Http">> {
  if (Array.isArray(input)) {
    return input.map((item) => ({
      _tag: "Address" as const,
      label: undefined,
      kind: "Http" as const,
      dial: httpDial(item),
    }));
  }
  if (typeof input === "object" && input !== null) {
    return Object.entries(input).map(([label, dial]) => ({
      _tag: "Address" as const,
      label,
      kind: "Http" as const,
      dial: httpDial(dial),
    }));
  }
  return {
    _tag: "Address",
    label: undefined,
    kind: "Http",
    dial: httpDial(input),
  };
}

/** WebSocket factory overloads. @internal */
export function ws(port: number): AddressValue<undefined, "WebSocket">;
export function ws(port: `:${number}`): AddressValue<undefined, "WebSocket">;
export function ws(url: string): AddressValue<undefined, "WebSocket">;
export function ws(
  ports: ReadonlyArray<number | `:${number}` | string>,
): ReadonlyArray<AddressValue<undefined, "WebSocket">>;
export function ws<const L extends string>(
  labeled: { readonly [K in L]: number | `:${number}` | string },
): { readonly [K in L]: AddressValue<K, "WebSocket"> }[L][];
export function ws(
  input:
    | number
    | string
    | ReadonlyArray<number | string>
    | Record<string, number | string>,
):
  | AddressValue<undefined, "WebSocket">
  | ReadonlyArray<AddressValue<string | undefined, "WebSocket">> {
  if (Array.isArray(input)) {
    return input.map((item) => ({
      _tag: "Address" as const,
      label: undefined,
      kind: "WebSocket" as const,
      dial: wsDial(item),
    }));
  }
  if (typeof input === "object" && input !== null) {
    return Object.entries(input).map(([label, dial]) => ({
      _tag: "Address" as const,
      label,
      kind: "WebSocket" as const,
      dial: wsDial(dial),
    }));
  }
  return {
    _tag: "Address",
    label: undefined,
    kind: "WebSocket",
    dial: wsDial(input),
  };
}

/** Unix factory — labeled or unlabeled path. @internal */
export function unix(path: string): AddressValue<undefined, "IpcSocket">;
export function unix<const L extends string>(
  label: L,
  path: string,
): AddressValue<L, "IpcSocket">;
export function unix(
  labelOrPath: string,
  path?: string,
): AddressValue<string | undefined, "IpcSocket"> {
  if (path === undefined) {
    return {
      _tag: "Address",
      label: undefined,
      kind: "IpcSocket",
      dial: { _tag: "UnixPath", path: labelOrPath },
    };
  }
  return {
    _tag: "Address",
    label: labelOrPath,
    kind: "IpcSocket",
    dial: { _tag: "UnixPath", path },
  };
}

/** Flatten factory output / arrays into a list. @internal */
export const toAddressList = (
  input: AnyAddress | ReadonlyArray<AnyAddress>,
): ReadonlyArray<AnyAddress> =>
  Array.isArray(input)
    ? (input as ReadonlyArray<AnyAddress>)
    : [input as AnyAddress];
