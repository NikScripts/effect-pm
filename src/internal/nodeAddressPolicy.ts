/**
 * Resolve NodePolicy PrimaryAddress / Listen / Advertise against an address list.
 *
 * @module internal/nodeAddressPolicy
 * @internal
 */
import { Data } from "effect";
import type {
  AddressSelection,
  Config as NodePolicyConfig,
  PrimaryAddress,
} from "../NodePolicy";
import type { AnyAddress } from "./address";
import { isUnixFromKey } from "./address";

/** Defaults when a made node has no stamped NodePolicy overlay. @internal */
export const defaultNodePolicyConfig = {
  PrimaryAddress: "AllUnlabeled",
  Listen: "All",
  Advertise: "Primary",
} as const satisfies NodePolicyConfig;

/**
 * Advertise/Listen asked for `"Primary"` but the primary set is empty.
 *
 * @internal
 */
export class EmptyPrimarySet extends Data.TaggedError("EmptyPrimarySet")<{
  readonly nodeKey: string;
  readonly primaryAddress: PrimaryAddress;
  readonly selection: "Listen" | "Advertise";
}> {
  override get message() {
    return (
      `Node "${this.nodeKey}" ${this.selection} is "Primary" but PrimaryAddress ` +
      `${JSON.stringify(this.primaryAddress)} resolves to no addresses.`
    );
  }
}

/**
 * Label selection names an address label that is not on the node.
 *
 * @internal
 */
export class UnknownAddressLabel extends Data.TaggedError(
  "UnknownAddressLabel",
)<{
  readonly nodeKey: string;
  readonly label: string;
  readonly known: ReadonlyArray<string>;
}> {
  override get message() {
    return (
      `Node "${this.nodeKey}" references label "${this.label}" which is not ` +
      `declared (known: ${this.known.length === 0 ? "(none)" : this.known.join(", ")}).`
    );
  }
}

/** Merge stamped policy with defaults. @internal */
export const effectiveNodePolicy = (
  stamped: NodePolicyConfig | undefined,
): {
  readonly PrimaryAddress: PrimaryAddress;
  readonly Listen: AddressSelection;
  readonly Advertise: AddressSelection;
  readonly Proxy: NodePolicyConfig["Proxy"];
  readonly As: NodePolicyConfig["As"];
} => ({
  PrimaryAddress:
    stamped?.PrimaryAddress ?? defaultNodePolicyConfig.PrimaryAddress,
  Listen: stamped?.Listen ?? defaultNodePolicyConfig.Listen,
  Advertise: stamped?.Advertise ?? defaultNodePolicyConfig.Advertise,
  Proxy: stamped?.Proxy,
  As: stamped?.As,
});

/** Declared string labels on the list. @internal */
export const labelsOfAddresses = (
  addresses: ReadonlyArray<AnyAddress>,
): ReadonlyArray<string> => {
  const out: Array<string> = [];
  for (const a of addresses) {
    if (typeof a.label === "string" && !out.includes(a.label)) {
      out.push(a.label);
    }
  }
  return out;
};

const byLabels = (
  addresses: ReadonlyArray<AnyAddress>,
  labels: ReadonlyArray<string>,
  nodeKey: string,
): ReadonlyArray<AnyAddress> => {
  const known = labelsOfAddresses(addresses);
  for (const label of labels) {
    if (!known.includes(label)) {
      throw new UnknownAddressLabel({ nodeKey, label, known });
    }
  }
  const want = new Set(labels);
  return addresses.filter(
    (a) => typeof a.label === "string" && want.has(a.label),
  );
};

/**
 * Resolve the primary address set.
 *
 * - `"AllUnlabeled"` — every unlabeled address (incl. unixFromKey)
 * - `"All"` — every declared address
 * - label list — those labels only
 *
 * @internal
 */
export const resolvePrimarySet = (
  addresses: ReadonlyArray<AnyAddress>,
  primaryAddress: PrimaryAddress,
  nodeKey: string,
): ReadonlyArray<AnyAddress> => {
  if (primaryAddress === "All") return addresses;
  if (primaryAddress === "AllUnlabeled") {
    return addresses.filter(
      (a) => a.label === undefined || isUnixFromKey(a),
    );
  }
  return byLabels(addresses, primaryAddress, nodeKey);
};

/**
 * Resolve Listen or Advertise selection against the full list + primary set.
 *
 * @internal
 */
export const resolveAddressSelection = (
  addresses: ReadonlyArray<AnyAddress>,
  primarySet: ReadonlyArray<AnyAddress>,
  selection: AddressSelection,
  nodeKey: string,
  which: "Listen" | "Advertise",
  primaryAddress: PrimaryAddress,
): ReadonlyArray<AnyAddress> => {
  if (selection === "All") return addresses;
  if (selection === "Primary") {
    if (primarySet.length === 0) {
      throw new EmptyPrimarySet({ nodeKey, primaryAddress, selection: which });
    }
    return primarySet;
  }
  return byLabels(addresses, selection, nodeKey);
};

/**
 * Full resolve: policy → primary set → listen set → advertise set.
 *
 * @internal
 */
export const resolveNodeAddresses = (
  nodeKey: string,
  addresses: ReadonlyArray<AnyAddress>,
  stamped: NodePolicyConfig | undefined,
): {
  readonly policy: ReturnType<typeof effectiveNodePolicy>;
  readonly primary: ReadonlyArray<AnyAddress>;
  readonly listen: ReadonlyArray<AnyAddress>;
  readonly advertise: ReadonlyArray<AnyAddress>;
} => {
  const policy = effectiveNodePolicy(stamped);
  const known = labelsOfAddresses(addresses);
  if (typeof policy.As === "string" && !known.includes(policy.As)) {
    throw new UnknownAddressLabel({
      nodeKey,
      label: policy.As,
      known,
    });
  }
  // Stamped label lists (before defaults) — catch unknown labels even when
  // effective Listen/Advertise is a mode string.
  for (const sel of [
    stamped?.PrimaryAddress,
    stamped?.Listen,
    stamped?.Advertise,
  ]) {
    if (Array.isArray(sel)) {
      for (const label of sel) {
        if (typeof label === "string" && !known.includes(label)) {
          throw new UnknownAddressLabel({ nodeKey, label, known });
        }
      }
    }
  }
  const primary = resolvePrimarySet(
    addresses,
    policy.PrimaryAddress,
    nodeKey,
  );
  const listen = resolveAddressSelection(
    addresses,
    primary,
    policy.Listen,
    nodeKey,
    "Listen",
    policy.PrimaryAddress,
  );
  const advertise = resolveAddressSelection(
    addresses,
    primary,
    policy.Advertise,
    nodeKey,
    "Advertise",
    policy.PrimaryAddress,
  );
  return { policy, primary, listen, advertise };
};
