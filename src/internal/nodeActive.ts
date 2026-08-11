/**
 * Live Active label — which labeled backend {@link Node.forward} dials.
 *
 * Seeded from stamped {@link NodePolicy.Active} or the first labeled address.
 * Flip with {@link activate}`(node, label)` without restarting the primary listener.
 *
 * @module internal/nodeActive
 * @internal
 */
import { Context, Data, Effect, Layer, Ref } from "effect";
import type { AnyNode } from "./nodeCore";
import {
  addressOfLabel,
  firstLabeledAddress,
} from "./nodeAddressListen";
import { UnknownAddressLabel } from "./nodeAddressPolicy";
import { nodePolicyOf } from "./nodeMake";

/**
 * Runtime Active label for Proxy Prefer forwarding (when present in Layer Success).
 *
 * @internal
 */
export class ActiveLabel extends Context.Service<
  ActiveLabel,
  {
    readonly get: Effect.Effect<string>;
    readonly set: (
      label: string,
    ) => Effect.Effect<void, UnknownAddressLabel>;
  }
>()("hyperlink-ts/internal/nodeActive/ActiveLabel") {}

/**
 * No labeled address to seed Active (Proxy Prefer / forward needs one).
 *
 * @internal
 */
export class ActiveLabelMissing extends Data.TaggedError("ActiveLabelMissing")<{
  readonly nodeKey: string;
}> {
  override get message() {
    return (
      `Node "${this.nodeKey}" has Proxy Prefer / forward but no Active label ` +
      `and no labeled addresses to default to.`
    );
  }
}

/** Per-node Active refs — listen Success often erases services; activate uses this. */
const activeRefs = new Map<string, Ref.Ref<string>>();

/** Register the live Active Ref for a made node (called from {@link forward}). @internal */
export const registerActiveRef = (
  nodeKey: string,
  ref: Ref.Ref<string>,
): void => {
  activeRefs.set(nodeKey, ref);
};

/** Drop registry entry (tests / scope end — best-effort). @internal */
export const unregisterActiveRef = (nodeKey: string): void => {
  activeRefs.delete(nodeKey);
};

/** Resolve seed label from stamp or first labeled address. @internal */
export const seedActiveLabel = (
  node: AnyNode & { readonly key: string },
): string => {
  const stamped = nodePolicyOf(node)?.Active;
  if (typeof stamped === "string") return stamped;
  const first = firstLabeledAddress(node);
  if (first !== undefined && typeof first.label === "string") {
    return first.label;
  }
  throw new ActiveLabelMissing({ nodeKey: node.key });
};

const requireLabel = (
  node: AnyNode & { readonly key: string },
  label: string,
): Effect.Effect<void, UnknownAddressLabel> =>
  Effect.suspend(() => {
    try {
      addressOfLabel(node, label);
      return Effect.void;
    } catch (cause) {
      if (cause instanceof UnknownAddressLabel) {
        return Effect.fail(cause);
      }
      return Effect.die(cause);
    }
  });

/**
 * Provide {@link ActiveLabel} for a made node (seeded once at layer build).
 *
 * @internal
 */
export const activeLabelLayer = (
  node: AnyNode & { readonly key: string },
  initial?: string,
): Layer.Layer<ActiveLabel, UnknownAddressLabel | ActiveLabelMissing> =>
  Layer.effect(
    ActiveLabel,
    Effect.gen(function* () {
      const seed = yield* Effect.suspend(() => {
        try {
          const s = initial ?? seedActiveLabel(node);
          addressOfLabel(node, s);
          return Effect.succeed(s);
        } catch (cause) {
          if (
            cause instanceof UnknownAddressLabel ||
            cause instanceof ActiveLabelMissing
          ) {
            return Effect.fail(cause);
          }
          return Effect.die(cause);
        }
      });
      const ref = yield* Ref.make(seed);
      registerActiveRef(node.key, ref);
      return {
        get: Ref.get(ref),
        set: (label: string) =>
          requireLabel(node, label).pipe(
            Effect.andThen(Ref.set(ref, label)),
          ),
      };
    }),
  );

/**
 * Flip the live Active label for `node` (cutover retarget).
 *
 * @internal
 */
export const activate = (
  node: AnyNode & { readonly key: string },
  label: string,
): Effect.Effect<void, UnknownAddressLabel | ActiveLabelMissing> =>
  requireLabel(node, label).pipe(
    Effect.flatMap(() => {
      const ref = activeRefs.get(node.key);
      if (ref === undefined) {
        return Effect.fail(new ActiveLabelMissing({ nodeKey: node.key }));
      }
      return Ref.set(ref, label);
    }),
  );

/**
 * Read the live Active label for `node`.
 *
 * @internal
 */
export const active = (
  node: AnyNode & { readonly key: string },
): Effect.Effect<string, ActiveLabelMissing> =>
  Effect.suspend(() => {
    const ref = activeRefs.get(node.key);
    if (ref === undefined) {
      return Effect.fail(new ActiveLabelMissing({ nodeKey: node.key }));
    }
    return Ref.get(ref);
  });
