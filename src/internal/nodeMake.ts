/**
 * Node.make — address-list constructable + pipe (Address.* / NodePolicy.*).
 *
 * @module internal/nodeMake
 * @internal
 */
import type { Layer } from "effect";
import type { OnConflict } from "../LookupPolicy";
import type * as NodePolicy from "../NodePolicy";
import * as address from "./address";
import {
  BrandKey as PolicyBrandKey,
  ConfigKey as PolicyConfigKey,
} from "./policyBuilder";
import {
  assembleNode,
  type Endpoints,
  type ProtocolKind,
} from "./nodeCore";

const NODE_POLICY_ID = "hyperlink-ts/NodePolicy";

/** Options bag on {@link make} (non-address). @internal */
export type NodeMakeOptions = {
  readonly onConflict?: OnConflict;
};

type AnyAddress = address.AnyAddress;

type NodePolicyConfig = NodePolicy.Config;
type NodePolicyValue = NodePolicy.Policy<NodePolicyConfig>;

/** Runtime stamp on a made node. @internal */
export const AddressesKey = "~hyperlink-ts/Node/addresses" as const;
export const NodePolicyConfigKey = "~hyperlink-ts/Node/nodePolicy" as const;

const isNodePolicyLayer = (u: unknown): u is NodePolicyValue =>
  typeof u === "object" &&
  u !== null &&
  PolicyBrandKey in u &&
  (u as { readonly [PolicyBrandKey]: unknown })[PolicyBrandKey] ===
    NODE_POLICY_ID;

const isAddressFragment = (
  u: unknown,
): u is AnyAddress | ReadonlyArray<AnyAddress> =>
  address.isAddressValue(u) ||
  address.isUnixFromKey(u) ||
  (Array.isArray(u) &&
    u.every(
      (item) => address.isAddressValue(item) || address.isUnixFromKey(item),
    ));

/** Dial fields for legacy connect/listen from an address list. @internal */
export const legacyFieldsFromAddresses = (
  addresses: ReadonlyArray<AnyAddress>,
): {
  readonly url: string | undefined;
  readonly path: string | undefined;
  readonly kind: ProtocolKind | undefined;
  readonly endpoints: Endpoints;
  readonly httpPort?: number;
} => {
  const endpoints: {
    Http?: { readonly url: string };
    WebSocket?: { readonly url: string };
    IpcSocket?: { readonly path: string };
  } = {};
  let httpPort: number | undefined;
  // Prefer first unlabeled for legacy primary fields; else first address.
  const preferred =
    addresses.find((a) => a.label === undefined) ?? addresses[0];

  for (const item of addresses) {
    if (item._tag === "UnixFromKey") {
      // Resolved at bind — no concrete endpoint yet.
      continue;
    }
    const { kind, dial } = item;
    if (kind === "Http") {
      if (dial._tag === "HttpPort") {
        const url = `http://localhost:${String(dial.port)}/rpc`;
        endpoints.Http = { url };
        if (httpPort === undefined) httpPort = dial.port;
      } else if (dial._tag === "HttpUrl") {
        endpoints.Http = { url: dial.url };
      }
    } else if (kind === "WebSocket") {
      if (dial._tag === "WsUrl") {
        endpoints.WebSocket = { url: dial.url };
      }
    } else if (kind === "IpcSocket") {
      if (dial._tag === "UnixPath") {
        endpoints.IpcSocket = { path: dial.path };
      }
    }
  }
  const frozenEndpoints: Endpoints = endpoints;

  let url: string | undefined;
  let path: string | undefined;
  let kind: ProtocolKind | undefined;
  if (preferred !== undefined && preferred._tag !== "UnixFromKey") {
    kind = preferred.kind;
    const dial = preferred.dial;
    if (dial._tag === "HttpPort") {
      url = `http://localhost:${String(dial.port)}/rpc`;
      httpPort = dial.port;
    } else if (dial._tag === "HttpUrl" || dial._tag === "WsUrl") {
      url = dial.url;
    } else if (dial._tag === "UnixPath") {
      path = dial.path;
    }
  } else if (preferred?._tag === "UnixFromKey") {
    kind = "IpcSocket";
  } else {
    kind =
      frozenEndpoints.Http !== undefined
        ? "Http"
        : frozenEndpoints.WebSocket !== undefined
          ? "WebSocket"
          : frozenEndpoints.IpcSocket !== undefined
            ? "IpcSocket"
            : undefined;
    url = frozenEndpoints.Http?.url ?? frozenEndpoints.WebSocket?.url;
    path = frozenEndpoints.IpcSocket?.path;
  }

  return { url, path, kind, endpoints: frozenEndpoints, httpPort };
};

type LabelsOf<As extends ReadonlyArray<AnyAddress>> = address.LabelsOf<As>;

/**
 * Made-node constructable — Tag + address list + NodePolicy product + pipe.
 *
 * @internal
 */
export type NodeMakeDef<
  Key extends string,
  As extends ReadonlyArray<AnyAddress>,
  Labels extends string,
  Policy extends NodePolicyConfig,
> = ReturnType<typeof assembleNode> & {
  readonly key: Key;
  readonly [AddressesKey]: As;
  readonly [NodePolicyConfigKey]: Policy;
  readonly labels: Labels;
  pipe: <const Fs extends ReadonlyArray<PipeArg>>(
    ...fs: Fs
  ) => NodeMakeDef<
    Key,
    PipeAddresses<As, Fs>,
    Labels | PipeLabels<Fs>,
    PipePolicy<Policy, Fs>
  >;
};

type PipeArg =
  | AnyAddress
  | ReadonlyArray<AnyAddress>
  | NodePolicyValue
  | Layer.Layer<never>;

type PipeAddresses<
  As extends ReadonlyArray<AnyAddress>,
  Fs extends ReadonlyArray<PipeArg>,
> = Fs extends readonly []
  ? As
  : Fs extends readonly [infer H, ...infer Rest]
    ? Rest extends ReadonlyArray<PipeArg>
      ? H extends ReadonlyArray<AnyAddress>
        ? PipeAddresses<readonly [...As, ...H], Rest>
        : H extends AnyAddress
          ? PipeAddresses<readonly [...As, H], Rest>
          : PipeAddresses<As, Rest>
      : As
    : As;

type PipeLabels<Fs extends ReadonlyArray<PipeArg>> = {
  [I in keyof Fs]: Fs[I] extends AnyAddress
    ? Extract<Fs[I]["label"], string>
    : Fs[I] extends ReadonlyArray<AnyAddress>
      ? LabelsOf<Fs[I]>
      : never;
}[number];

type PipePolicy<
  Prev extends NodePolicyConfig,
  Fs extends ReadonlyArray<PipeArg>,
> = Fs extends readonly []
  ? Prev
  : Fs extends readonly [infer H, ...infer Rest]
    ? Rest extends ReadonlyArray<PipeArg>
      ? H extends NodePolicyValue
        ? PipePolicy<
            Prev & NodePolicy.ConfigOf<H>,
            Rest
          >
        : PipePolicy<Prev, Rest>
      : Prev
    : Prev;

const mergePolicyConfig = (
  prev: NodePolicyConfig,
  layer: NodePolicyValue,
): NodePolicyConfig => ({
  ...prev,
  ...(layer[PolicyConfigKey] as NodePolicyConfig),
});

const buildDef = <
  Key extends string,
  As extends ReadonlyArray<AnyAddress>,
  Labels extends string,
  Policy extends NodePolicyConfig,
>(state: {
  readonly key: Key;
  readonly addresses: As;
  readonly labels: Labels;
  readonly policy: Policy;
  readonly onConflict: OnConflict;
}): NodeMakeDef<Key, As, Labels, Policy> => {
  address.assertNoDialOverlap(state.addresses);
  const legacy = legacyFieldsFromAddresses(state.addresses);
  const base = assembleNode(state.key, {
    url: legacy.url,
    path: legacy.path,
    kind: legacy.kind,
    endpoints: legacy.endpoints,
    onConflict: state.onConflict,
    httpPort: legacy.httpPort,
  });

  const def = Object.assign(base, {
    [AddressesKey]: state.addresses,
    [NodePolicyConfigKey]: Object.freeze({ ...state.policy }),
    labels: state.labels,
    pipe(...fs: ReadonlyArray<PipeArg>) {
      let addresses: AnyAddress[] = [...state.addresses];
      let policy: NodePolicyConfig = { ...state.policy };
      for (const fragment of fs) {
        if (isAddressFragment(fragment)) {
          addresses = [...addresses, ...address.toAddressList(fragment)];
        } else if (isNodePolicyLayer(fragment)) {
          policy = mergePolicyConfig(policy, fragment);
        }
      }
      return buildDef({
        key: state.key,
        addresses: addresses as unknown as As,
        labels: undefined as unknown as Labels,
        policy: policy as Policy,
        onConflict: state.onConflict,
      });
    },
  });
  return def as NodeMakeDef<Key, As, Labels, Policy>;
};

/**
 * `Node.make(key, Address | Address[], options?)` — class-extends constructable.
 *
 * @internal
 */
export const make = <
  const Key extends string,
  const Input extends AnyAddress | ReadonlyArray<AnyAddress>,
>(
  key: Key,
  input: Input,
  options?: NodeMakeOptions,
): NodeMakeDef<
  Key,
  address.NormalizeAddresses<Input>,
  LabelsOf<address.NormalizeAddresses<Input>>,
  {}
> => {
  const addresses = address.toAddressList(
    input,
  ) as address.NormalizeAddresses<Input>;
  return buildDef({
    key,
    addresses,
    labels: undefined as unknown as LabelsOf<
      address.NormalizeAddresses<Input>
    >,
    policy: {},
    onConflict: options?.onConflict ?? "inherit",
  });
};

/** Read stamped address list. @internal */
export const addressesOf = (
  node: unknown,
): ReadonlyArray<AnyAddress> | undefined => {
  if (
    (typeof node === "object" || typeof node === "function") &&
    node !== null &&
    AddressesKey in node
  ) {
    return (node as { readonly [AddressesKey]: ReadonlyArray<AnyAddress> })[
      AddressesKey
    ];
  }
  return undefined;
};

/** Read stamped NodePolicy product config. @internal */
export const nodePolicyOf = (
  node: unknown,
): NodePolicyConfig | undefined => {
  if (
    (typeof node === "object" || typeof node === "function") &&
    node !== null &&
    NodePolicyConfigKey in node
  ) {
    return (node as { readonly [NodePolicyConfigKey]: NodePolicyConfig })[
      NodePolicyConfigKey
    ];
  }
  return undefined;
};
