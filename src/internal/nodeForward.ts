/**
 * {@link forward} — expose a HyperService on this process by dialing the Active label.
 *
 * Dream β: primary Http (or other) listener + {@link NodePolicy.proxy}`("Prefer")` serves
 * by forwarding to the live labeled backend (Unix A/B). Flip with {@link activate}.
 *
 * The Active label is a closed-over {@link Ref} (Rpc handlers do not see Layer-provided
 * services). {@link ActiveLabel} is still published so {@link activate} works in-process.
 *
 * @module internal/nodeForward
 * @internal
 */
import { Context, Data, Effect, Layer, Ref, Stream } from "effect";
import * as Hyperlink from "../Hyperlink";
import * as LookupPolicy from "../LookupPolicy";
import type { AddressedNode, AnyNode } from "./nodeCore";
import {
  ActiveLabel,
  ActiveLabelMissing,
  registerActiveRef,
  seedActiveLabel,
} from "./nodeActive";
import {
  addressOfLabel,
  dialNodeFromAddress,
} from "./nodeAddressListen";
import { UnknownAddressLabel } from "./nodeAddressPolicy";

type AnyTag = Hyperlink.HyperlinkTag<any, Hyperlink.Spec>;

/**
 * Forward dial / invoke failed against the Active backend.
 *
 * @internal
 */
export class ForwardDialError extends Data.TaggedError("ForwardDialError")<{
  readonly nodeKey: string;
  readonly path: string;
  readonly label: string;
  readonly detail: string;
}> {}

/**
 * Call one method on the Active labeled backend (scoped dial per call so
 * {@link activate} retargets without restarting the primary listener).
 *
 * @internal
 */
const callActive = (
  node: AnyNode & { readonly key: string },
  tag: AnyTag,
  path: string,
  payload: unknown,
  labelRef: Ref.Ref<string>,
): Effect.Effect<unknown, ForwardDialError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const label = yield* Ref.get(labelRef);
      const fail = (detail: string) =>
        new ForwardDialError({
          nodeKey: node.key,
          path,
          label,
          detail,
        });
      const addr = addressOfLabel(node, label);
      const dial = dialNodeFromAddress(node.key, addr) as AddressedNode<unknown>;
      const clientLayer = Hyperlink.client(tag, dial).pipe(
        LookupPolicy.provide(LookupPolicy.verifyOff),
      );
      const built: Context.Context<never> = yield* (Layer.build(
        clientLayer,
      ) as Effect.Effect<Context.Context<never>, never>);
      const svc = Context.get(built, tag) as Record<string, unknown>;
      let target: unknown = svc;
      for (const part of path.split(".")) {
        target = (target as Record<string, unknown>)[part];
      }
      // Client surface: no-payload members are Effects; payload members are functions.
      if (Effect.isEffect(target)) {
        return yield* (target as Effect.Effect<unknown, ForwardDialError>);
      }
      if (typeof target === "function") {
        const call = target as (
          payload: unknown,
        ) => Effect.Effect<unknown, ForwardDialError>;
        return yield* call(payload);
      }
      return yield* fail(`method missing on Active backend for ${tag.key}`);
    }),
  ) as Effect.Effect<unknown, ForwardDialError>;

/**
 * Build a serve impl that forwards every wire member to the Active backend.
 *
 * @internal
 */
const setPath = (
  impl: Record<string, unknown>,
  path: string,
  value: unknown,
): void => {
  const parts = path.split(".");
  if (parts.length === 1) {
    impl[path] = value;
    return;
  }
  let cursor = impl;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    cursor[part] =
      (cursor[part] as Record<string, unknown> | undefined) ?? {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
};

const forwardImpl = (
  node: AnyNode & { readonly key: string },
  tag: AnyTag,
  labelRef: Ref.Ref<string>,
): Record<string, unknown> => {
  const flat = Hyperlink.flattenHyperlinkSpec(
    Hyperlink.specOf(tag) as Hyperlink.Spec,
  );
  const impl: Record<string, unknown> = {};
  for (const [path, method] of Object.entries(flat)) {
    // Stream / ref members need scoped stream forwarding. Stub a Subscribable
    // so Hyperlink.serve still wires the Rpc group; one-shot methods forward.
    // Full ref/stream proxy is follow-up (client verify + live watch).
    if (
      typeof method === "object" &&
      method !== null &&
      "stream" in method &&
      (method as { readonly stream?: unknown }).stream === true
    ) {
      setPath(impl, path, {
        get: Effect.die(
          `Node.forward: stream/ref "${path}" get is not Eng'd yet`,
        ),
        changes: Stream.never,
      });
      continue;
    }
    setPath(impl, path, (payload: unknown) =>
      callActive(node, tag, path, payload, labelRef),
    );
  }
  return impl;
};

const activeFromRef = (
  node: AnyNode & { readonly key: string },
  labelRef: Ref.Ref<string>,
): {
  readonly get: Effect.Effect<string>;
  readonly set: (label: string) => Effect.Effect<void, UnknownAddressLabel>;
} => ({
  get: Ref.get(labelRef),
  set: (label: string) =>
    Effect.suspend(() => {
      try {
        addressOfLabel(node, label);
        return Ref.set(labelRef, label);
      } catch (cause) {
        if (cause instanceof UnknownAddressLabel) {
          return Effect.fail(cause);
        }
        return Effect.die(cause);
      }
    }),
});

/**
 * Serve `tag` on this process by forwarding each call to the Active labeled
 * address on `node`. Publishes {@link ActiveLabel} for {@link activate}.
 *
 * @internal
 */
const seedLabel = (
  node: AnyNode & { readonly key: string },
): Effect.Effect<string, UnknownAddressLabel | ActiveLabelMissing> =>
  Effect.suspend(() => {
    try {
      const seed = seedActiveLabel(node);
      addressOfLabel(node, seed);
      return Effect.succeed(seed);
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

export const forward = <Self, S extends Hyperlink.Spec>(
  node: AnyNode & { readonly key: string },
  tag: Hyperlink.HyperlinkTag<Self, S>,
): Layer.Layer<Self | ActiveLabel, ActiveLabelMissing | UnknownAddressLabel> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const seed = yield* seedLabel(node);
      const labelRef = yield* Ref.make(seed);
      registerActiveRef(node.key, labelRef);
      const serve = Hyperlink.serve(
        tag,
        forwardImpl(node, tag as unknown as AnyTag, labelRef) as never,
      );
      return Layer.merge(
        serve as Layer.Layer<Self>,
        Layer.succeed(ActiveLabel, activeFromRef(node, labelRef)),
      );
    }),
  ) as Layer.Layer<
    Self | ActiveLabel,
    ActiveLabelMissing | UnknownAddressLabel
  >;

/**
 * {@link forward} for many tags — one shared Active label Ref.
 *
 * @internal
 */
export const forwardAll = <
  const Tags extends readonly [AnyTag, ...ReadonlyArray<AnyTag>],
>(
  node: AnyNode & { readonly key: string },
  tags: Tags,
): Layer.Layer<ActiveLabel, ActiveLabelMissing | UnknownAddressLabel> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const seed = yield* seedLabel(node);
      const labelRef = yield* Ref.make(seed);
      registerActiveRef(node.key, labelRef);
      const forwards = tags.map((tag) =>
        Hyperlink.serve(tag, forwardImpl(node, tag, labelRef) as never),
      );
      const merged =
        forwards.length === 1
          ? forwards[0]!
          : Layer.mergeAll(forwards[0]!, ...forwards.slice(1));
      return Layer.merge(
        merged as Layer.Layer<never>,
        Layer.succeed(ActiveLabel, activeFromRef(node, labelRef)),
      );
    }),
  ) as Layer.Layer<ActiveLabel, ActiveLabelMissing | UnknownAddressLabel>;
