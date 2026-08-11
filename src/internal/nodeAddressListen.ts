/**
 * Listen-set resolution for made nodes — bind what NodePolicy.listen selects.
 *
 * @module internal/nodeAddressListen
 * @internal
 */
import { Data } from "effect";
import type { ProtocolKind } from "./nodeCore";
import { assembleNode, type AnyNode } from "./nodeCore";
import type { AnyAddress } from "./address";
import { dialIdentity, isUnixFromKey } from "./address";
import {
  EmptyPrimarySet,
  UnknownAddressLabel,
  resolveNodeAddresses,
} from "./nodeAddressPolicy";
import {
  addressesOf,
  legacyFieldsFromAddresses,
  nodePolicyOf,
} from "./nodeMake";

/**
 * {@link Address.unixFromKey} is declared but bind Config is not Eng’d yet.
 *
 * @internal
 */
export class UnixFromKeyBindPending extends Data.TaggedError(
  "UnixFromKeyBindPending",
)<{
  readonly nodeKey: string;
}> {
  override get message() {
    return (
      `Node "${this.nodeKey}" listen set includes Address.unixFromKey; ` +
      `key-derived bind Config is not Eng’d yet.`
    );
  }
}

/** Kind of a concrete address (unixFromKey → IpcSocket). @internal */
export const kindOfAddress = (address: AnyAddress): ProtocolKind => {
  if (isUnixFromKey(address)) return "IpcSocket";
  return address.kind;
};

/**
 * Resolved listen addresses for a made node, or `undefined` when the node has
 * no address stamp (legacy `Node.Service` / nameless).
 *
 * Throws {@link EmptyPrimarySet} / {@link UnknownAddressLabel} / {@link UnixFromKeyBindPending}.
 *
 * @internal
 */
export const listenAddressesOf = (
  node: AnyNode & { readonly key: string },
): ReadonlyArray<AnyAddress> | undefined => {
  const addresses = addressesOf(node);
  if (addresses === undefined) return undefined;
  const resolved = resolveNodeAddresses(
    node.key,
    addresses,
    nodePolicyOf(node),
  );
  for (const a of resolved.listen) {
    if (isUnixFromKey(a)) {
      throw new UnixFromKeyBindPending({ nodeKey: node.key });
    }
  }
  return resolved.listen;
};

/**
 * Listen addresses of one protocol kind. `undefined` = not a made node.
 *
 * @internal
 */
export const listenAddressesOfKind = (
  node: AnyNode & { readonly key: string },
  kind: ProtocolKind,
): ReadonlyArray<AnyAddress> | undefined => {
  const listen = listenAddressesOf(node);
  if (listen === undefined) return undefined;
  return listen.filter((a) => kindOfAddress(a) === kind);
};

/**
 * Materialize a dialable Tag node for one concrete address (same `nodeKey`).
 *
 * @internal
 */
export const dialNodeFromAddress = (
  nodeKey: string,
  address: AnyAddress,
): AnyNode & { readonly key: string } => {
  if (isUnixFromKey(address)) {
    throw new UnixFromKeyBindPending({ nodeKey });
  }
  const fields = legacyFieldsFromAddresses([address], {
    preferred: [address],
    endpointSource: [address],
  });
  return assembleNode(nodeKey, {
    url: fields.url,
    path: fields.path,
    kind: fields.kind,
    endpoints: fields.endpoints,
    onConflict: "inherit",
    httpPort: fields.httpPort,
  }) as AnyNode & { readonly key: string };
};

/**
 * Labeled address on the made node, or throw {@link UnknownAddressLabel}.
 *
 * @internal
 */
export const addressOfLabel = (
  node: AnyNode & { readonly key: string },
  label: string,
): AnyAddress => {
  const addresses = addressesOf(node);
  if (addresses === undefined) {
    throw new UnknownAddressLabel({
      nodeKey: node.key,
      label,
      known: [],
    });
  }
  const found = addresses.find(
    (a) => !isUnixFromKey(a) && a.label === label,
  );
  if (found === undefined) {
    const known = addresses
      .map((a) => a.label)
      .filter((l): l is string => typeof l === "string");
    throw new UnknownAddressLabel({
      nodeKey: node.key,
      label,
      known,
    });
  }
  return found;
};

/**
 * First labeled address in declaration order (proxy Active default).
 *
 * @internal
 */
export const firstLabeledAddress = (
  node: unknown,
): AnyAddress | undefined => {
  const addresses = addressesOf(node);
  if (addresses === undefined) return undefined;
  return addresses.find(
    (a) => !isUnixFromKey(a) && typeof a.label === "string",
  );
};

/**
 * Whether this listen dial should Directory-advertise (in the advertise set).
 * Legacy nodes (no address stamp) always advertise.
 *
 * @internal
 */
export const isAdvertiseDial = (
  node: AnyNode & { readonly key: string },
  address: AnyAddress,
): boolean => {
  const addresses = addressesOf(node);
  if (addresses === undefined) return true;
  const resolved = resolveNodeAddresses(
    node.key,
    addresses,
    nodePolicyOf(node),
  );
  const id = dialIdentity(address);
  return resolved.advertise.some((a) => dialIdentity(a) === id);
};

/**
 * Full resolve for a made node, or undefined when unstamped.
 *
 * @internal
 */
export const resolvedOf = (
  node: AnyNode & { readonly key: string },
): ReturnType<typeof resolveNodeAddresses> | undefined => {
  const addresses = addressesOf(node);
  if (addresses === undefined) return undefined;
  return resolveNodeAddresses(node.key, addresses, nodePolicyOf(node));
};

/** Re-export resolve errors for listen call sites. @internal */
export { EmptyPrimarySet, UnknownAddressLabel };
