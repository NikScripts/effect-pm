/**
 * Node.make — address-list constructable + pipe (Address.* / NodePolicy.*).
 *
 * @module internal/nodeMake
 * @internal
 */
import { Data, type Layer } from "effect";
import type { OnConflict } from "../LookupPolicy";
import { onConflictOf } from "../LookupPolicy";
import type * as NodePolicy from "../NodePolicy";
import * as address from "./address";
import {
  BrandKey as PolicyBrandKey,
  ConfigKey as PolicyConfigKey,
} from "./policyBuilder";
import {
  EmptyPrimarySet,
  UnknownAddressLabel,
  labelsOfAddresses,
  resolveNodeAddresses,
} from "./nodeAddressPolicy";
import {
  assembleNode,
  type AnyNode,
  type Endpoints,
  type ProtocolKind,
} from "./nodeCore";

export {
  EmptyPrimarySet,
  UnknownAddressLabel,
  resolveNodeAddresses,
  resolvePrimarySet,
  resolveAddressSelection,
  effectiveNodePolicy,
  defaultNodePolicyConfig,
  labelsOfAddresses,
} from "./nodeAddressPolicy";

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

/** Fill one endpoints slot from an address (last write per kind). @internal */
const applyAddressToEndpoints = (
  endpoints: {
    Http?: { readonly url: string };
    WebSocket?: { readonly url: string };
    IpcSocket?: { readonly path: string };
  },
  item: AnyAddress,
): number | undefined => {
  if (item._tag === "UnixFromKey") return undefined;
  const { kind, dial } = item;
  if (kind === "Http") {
    if (dial._tag === "HttpPort") {
      endpoints.Http = {
        url: `http://localhost:${String(dial.port)}/rpc`,
      };
      return dial.port;
    }
    if (dial._tag === "HttpUrl") {
      endpoints.Http = { url: dial.url };
    }
  } else if (kind === "WebSocket" && dial._tag === "WsUrl") {
    endpoints.WebSocket = { url: dial.url };
  } else if (kind === "IpcSocket" && dial._tag === "UnixPath") {
    endpoints.IpcSocket = { path: dial.path };
  }
  return undefined;
};

/** Scalar dial fields from one preferred address. @internal */
const scalarFromAddress = (
  preferred: AnyAddress | undefined,
): {
  readonly url: string | undefined;
  readonly path: string | undefined;
  readonly kind: ProtocolKind | undefined;
  readonly httpPort?: number;
} => {
  if (preferred === undefined) {
    return { url: undefined, path: undefined, kind: undefined };
  }
  if (preferred._tag === "UnixFromKey") {
    return { url: undefined, path: undefined, kind: "IpcSocket" };
  }
  const kind = preferred.kind;
  const dial = preferred.dial;
  if (dial._tag === "HttpPort") {
    return {
      kind,
      url: `http://localhost:${String(dial.port)}/rpc`,
      path: undefined,
      httpPort: dial.port,
    };
  }
  if (dial._tag === "HttpUrl" || dial._tag === "WsUrl") {
    return { kind, url: dial.url, path: undefined };
  }
  if (dial._tag === "UnixPath") {
    return { kind, url: undefined, path: dial.path };
  }
  return { kind, url: undefined, path: undefined };
};

/**
 * Dial fields for legacy connect/listen from an address list.
 *
 * `preferred` — first advertise (or listen) address for scalar url/path/kind.
 * `endpointSource` — addresses that fill the per-protocol endpoints map (listen set).
 *
 * @internal
 */
export const legacyFieldsFromAddresses = (
  addresses: ReadonlyArray<AnyAddress>,
  options?: {
    readonly preferred?: ReadonlyArray<AnyAddress>;
    readonly endpointSource?: ReadonlyArray<AnyAddress>;
  },
): {
  readonly url: string | undefined;
  readonly path: string | undefined;
  readonly kind: ProtocolKind | undefined;
  readonly endpoints: Endpoints;
  readonly httpPort?: number;
} => {
  const endpointSource = options?.endpointSource ?? addresses;
  const preferredList = options?.preferred ?? addresses;
  const preferred =
    preferredList[0] ??
    addresses.find((a) => a.label === undefined) ??
    addresses[0];

  const endpoints: {
    Http?: { readonly url: string };
    WebSocket?: { readonly url: string };
    IpcSocket?: { readonly path: string };
  } = {};
  let httpPort: number | undefined;
  for (const item of endpointSource) {
    const port = applyAddressToEndpoints(endpoints, item);
    if (httpPort === undefined && port !== undefined) httpPort = port;
  }
  const frozenEndpoints: Endpoints = endpoints;
  const scalar = scalarFromAddress(preferred);
  if (scalar.httpPort !== undefined) httpPort = scalar.httpPort;

  if (scalar.kind !== undefined) {
    return {
      url: scalar.url,
      path: scalar.path,
      kind: scalar.kind,
      endpoints: frozenEndpoints,
      httpPort,
    };
  }

  const kind: ProtocolKind | undefined =
    frozenEndpoints.Http !== undefined
      ? "Http"
      : frozenEndpoints.WebSocket !== undefined
        ? "WebSocket"
        : frozenEndpoints.IpcSocket !== undefined
          ? "IpcSocket"
          : undefined;
  return {
    url: frozenEndpoints.Http?.url ?? frozenEndpoints.WebSocket?.url,
    path: frozenEndpoints.IpcSocket?.path,
    kind,
    endpoints: frozenEndpoints,
    httpPort,
  };
};

/**
 * Runtime-check As / label lists against declared labels.
 * Does not apply Primary/Listen/Advertise defaults (those run in resolve).
 *
 * @internal
 */
export const assertKnownPolicyLabels = (
  nodeKey: string,
  addresses: ReadonlyArray<AnyAddress>,
  policy: NodePolicyConfig,
): void => {
  const known = labelsOfAddresses(addresses);
  const checkSel = (sel: unknown): void => {
    if (Array.isArray(sel)) {
      for (const label of sel) {
        if (typeof label === "string" && !known.includes(label)) {
          throw new UnknownAddressLabel({ nodeKey, label, known });
        }
      }
    }
  };
  checkSel(policy.PrimaryAddress);
  checkSel(policy.Listen);
  checkSel(policy.Advertise);
  if (typeof policy.As === "string" && !known.includes(policy.As)) {
    throw new UnknownAddressLabel({
      nodeKey,
      label: policy.As,
      known,
    });
  }
  if (typeof policy.Active === "string" && !known.includes(policy.Active)) {
    throw new UnknownAddressLabel({
      nodeKey,
      label: policy.Active,
      known,
    });
  }
};

/**
 * Resolve listen/advertise sets into legacy dial fields.
 *
 * {@link EmptyPrimarySet} is deferred (pipe intermediates may still add
 * unlabeled addresses or change PrimaryAddress / Advertise). Call
 * {@link resolveNodeAddresses} at listen / directory advertise for the loud fail.
 *
 * @internal
 */
export const stampLegacyFromPolicy = (
  nodeKey: string,
  addresses: ReadonlyArray<AnyAddress>,
  policy: NodePolicyConfig,
): {
  readonly url: string | undefined;
  readonly path: string | undefined;
  readonly kind: ProtocolKind | undefined;
  readonly endpoints: Endpoints;
  readonly httpPort?: number;
} => {
  assertKnownPolicyLabels(nodeKey, addresses, policy);
  try {
    const resolved = resolveNodeAddresses(nodeKey, addresses, policy);
    // Bind surface = listen set. Directory advertise re-resolves separately.
    return legacyFieldsFromAddresses(addresses, {
      preferred: resolved.listen,
      endpointSource: resolved.listen,
    });
  } catch (e) {
    if (e instanceof EmptyPrimarySet) {
      return legacyFieldsFromAddresses(addresses);
    }
    throw e;
  }
};

type LabelsOf<As extends ReadonlyArray<AnyAddress>> = address.LabelsOf<As>;

/** Owned selection mode strings — not app labels. */
type OwnedSelectionMode = "All" | "Primary" | "AllUnlabeled";

/**
 * Label-list selection: every element must be in `Labels`.
 * Mode strings (`"All"` / `"Primary"` / …) always ok.
 *
 * @internal
 */
export type SelectionLabelsOk<
  Labels extends string,
  Sel,
> = [Sel] extends [never]
  ? true
  : Sel extends OwnedSelectionMode
    ? true
    : Sel extends readonly string[]
      ? [Exclude<Sel[number], Labels>] extends [never]
        ? true
        : false
      : true;

type LabelFieldOk<
  Labels extends string,
  C,
  Field extends string,
> = Field extends keyof C
  ? C[Field] extends string
    ? C[Field] extends Labels
      ? true
      : false
    : true
  : true;

/**
 * True when every As / Active / label-list reference in `C` is declared on `Labels`.
 *
 * @internal
 */
export type PolicyLabelsOk<
  Labels extends string,
  C,
> = LabelFieldOk<Labels, C, "As"> extends true
  ? LabelFieldOk<Labels, C, "Active"> extends true
    ? SelectionLabelsOk<
        Labels,
        "PrimaryAddress" extends keyof C ? C["PrimaryAddress"] : never
      > extends true
      ? SelectionLabelsOk<
          Labels,
          "Listen" extends keyof C ? C["Listen"] : never
        > extends true
        ? SelectionLabelsOk<
            Labels,
            "Advertise" extends keyof C ? C["Advertise"] : never
          >
        : false
      : false
    : false
  : false;

/**
 * Pipe result when NodePolicy names a label absent from the address list.
 *
 * @internal
 */
export type NodePolicyLabelError = {
  readonly ["~NodePolicyLabelError"]: "references a label not declared on this node's addresses";
};

/**
 * Made-node constructable — Tag + address list + NodePolicy product + pipe.
 *
 * Label mistakes surface on the **return** of `pipe` (not the arg list) so
 * Effect's Pipeable `pipe` overloads on the Tag do not steal the call.
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
  ) => [PolicyLabelsOk<
    Labels | PipeLabels<Fs>,
    PipePolicy<Policy, Fs>
  >] extends [true]
    ? NodeMakeDef<
        Key,
        PipeAddresses<As, Fs>,
        Labels | PipeLabels<Fs>,
        PipePolicy<Policy, Fs>
      >
    : NodePolicyLabelError;
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
        ? PipePolicy<Prev & NodePolicy.ConfigOf<H>, Rest>
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
  const legacy = stampLegacyFromPolicy(
    state.key,
    state.addresses,
    state.policy,
  );
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
  return def as unknown as NodeMakeDef<Key, As, Labels, Policy>;
};

/**
 * `Node.make(key, Address | Address[], options?)` — HttpApi-shaped constructable.
 *
 * Address list may be empty (`Node.make(key)`) and accumulated with `.pipe(Address.*)`.
 * Prefer a **public** make for client-facing dials, then
 * `class Private extends Public.pipe(Address.unix({ … }))` for private dials —
 * never a second `make` with the same key.
 *
 * @internal
 */
export function make<const Key extends string>(
  key: Key,
  options?: NodeMakeOptions,
): NodeMakeDef<Key, readonly [], never, {}>;
export function make<
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
>;
export function make<
  const Key extends string,
  const Input extends AnyAddress | ReadonlyArray<AnyAddress>,
>(
  key: Key,
  inputOrOptions?: Input | NodeMakeOptions,
  options?: NodeMakeOptions,
): NodeMakeDef<Key, ReadonlyArray<AnyAddress>, string, {}> {
  // options-only: Node.make(key) | Node.make(key, { onConflict })
  const looksLikeOptions =
    inputOrOptions !== undefined &&
    typeof inputOrOptions === "object" &&
    inputOrOptions !== null &&
    !address.isAddressValue(inputOrOptions) &&
    !address.isUnixFromKey(inputOrOptions) &&
    !Array.isArray(inputOrOptions) &&
    ("onConflict" in inputOrOptions ||
      Object.keys(inputOrOptions).length === 0);

  if (inputOrOptions === undefined || looksLikeOptions) {
    const opts = (inputOrOptions ?? options) as NodeMakeOptions | undefined;
    return buildDef({
      key,
      addresses: [] as unknown as ReadonlyArray<AnyAddress>,
      labels: undefined as unknown as string,
      policy: {},
      onConflict: opts?.onConflict ?? "inherit",
    });
  }

  const addresses = address.toAddressList(
    inputOrOptions as Input,
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
}

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

/**
 * {@link withPolicy} was called on a node that was not built with {@link make}.
 *
 * @internal
 */
export class WithPolicyRequiresMake extends Data.TaggedError(
  "WithPolicyRequiresMake",
)<{
  readonly nodeKey: string;
}> {
  override get message() {
    return (
      `Node.withPolicy requires a Node.make address-list node ` +
      `(got "${this.nodeKey}").`
    );
  }
}

/**
 * Process-local NodePolicy overlay on **one** made node — same `nodeKey` and
 * address list, no second {@link make}.
 *
 * Use this for edge vs backend roles (`listen` / `as` / `active`). Never
 * `Node.make` the same key twice.
 *
 * @internal
 */
export const withPolicy = (
  node: AnyNode & { readonly key: string },
  ...policies: ReadonlyArray<NodePolicyValue>
): AnyNode & { readonly key: string } => {
  const addresses = addressesOf(node);
  if (addresses === undefined) {
    throw new WithPolicyRequiresMake({ nodeKey: node.key });
  }
  let policy: NodePolicyConfig = { ...(nodePolicyOf(node) ?? {}) };
  for (const fragment of policies) {
    if (isNodePolicyLayer(fragment)) {
      policy = mergePolicyConfig(policy, fragment);
    }
  }
  assertKnownPolicyLabels(node.key, addresses, policy);
  const legacy = stampLegacyFromPolicy(node.key, addresses, policy);
  // Plain listen view — not a new Tag / not a second make.
  return {
    key: node.key,
    url: legacy.url,
    path: legacy.path,
    kind: legacy.kind,
    endpoints: legacy.endpoints,
    onConflict: onConflictOf(node) ?? "inherit",
    [AddressesKey]: addresses,
    [NodePolicyConfigKey]: Object.freeze({ ...policy }),
  } as AnyNode & { readonly key: string };
};

/**
 * Resolve stamped addresses + NodePolicy (throws {@link EmptyPrimarySet} /
 * {@link UnknownAddressLabel}). Undefined when the node has no address stamp.
 *
 * @internal
 */
export const resolvedAddressesOf = (
  node: unknown,
):
  | ReturnType<typeof resolveNodeAddresses>
  | undefined => {
  const addresses = addressesOf(node);
  if (addresses === undefined) return undefined;
  const key =
    (typeof node === "object" || typeof node === "function") &&
    node !== null &&
    "key" in node &&
    typeof (node as { readonly key: unknown }).key === "string"
      ? (node as { readonly key: string }).key
      : "(unknown)";
  return resolveNodeAddresses(key, addresses, nodePolicyOf(node));
};
