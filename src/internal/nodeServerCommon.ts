/**
 * Shared plumbing for {@link httpServer} / {@link wsServer} / {@link ipcServer}.
 *
 * Serve lists are **open in `R`**: a HyperService may depend on other services (including other
 * HyperServices). Callers `Layer.provide` those requirements outside the server — same composition
 * model as Effect `Layer.mergeAll`. Constraints use {@link Layer.Any} (not `Layer<never, any, any>`)
 * so `anyUnknownInErrorContext` stays quiet while public overloads reify `Success` / `Error` /
 * `Services`.
 *
 * @internal
 */
import { Effect, Layer } from "effect"
import * as Hyperlink from "../Hyperlink"
import {
  AnyNode,
  OnConflict,
  ProtocolKind,
  ProtocolKindMismatch,
} from "./nodeCore"

/**
 * One serve layer accepted by {@link httpServer} / {@link wsServer} / {@link ipcServer}.
 *
 * @internal
 */
export type ServerServeLayer = Layer.Any;

/**
 * Non-empty serve list — open `E`/`R` so heterogeneous HyperService deps remain expressible.
 *
 * @internal
 */
export type ServerServeList = readonly [
  ServerServeLayer,
  ...ReadonlyArray<ServerServeLayer>,
];

/** True when `u` is a non-empty serve list. @internal */
export const isServerServeList = (u: unknown): u is ServerServeList =>
  Array.isArray(u) && u.length > 0 && Layer.isLayer(u[0]);

/**
 * Normalize one serve layer or a list into {@link ServerServeList}.
 *
 * @internal
 */
export const toServeList = (
  serve: ServerServeLayer | ServerServeList,
): ServerServeList => (isServerServeList(serve) ? serve : [serve]);

/**
 * Erase a {@link Layer.Any} to closed channels for internal composition (overload-impl pattern).
 * Prefer {@link retype} on factories when the source expression itself carries `any`/`unknown`
 * channels — those still fire if passed through here.
 *
 * @internal
 */
export const closedLayer = (
  layer: Layer.Any,
): Layer.Layer<never, never, never> =>
  layer as Layer.Layer<never, never, never>;

/**
 * Overload-impl retype through `never` (not `any`/`unknown` channels). Use when a factory's
 * Effect-bounded signature will not assign to a closed target without a bridge.
 *
 * @internal
 */
export const retype = <T>(value: never): T => value;

/**
 * Merge a non-empty serve list — Effect {@link Layer.mergeAll}, preserving inferred channels at
 * call sites via the generic overload. Implementation retypes `mergeAll` to return
 * {@link Layer.Any} so Effect's `any`-bounded signature never appears at this call site.
 *
 * @internal
 */
export function mergeServeList<const Layers extends ServerServeList>(
  layers: Layers,
): Layer.Layer<
  Layer.Success<Layers[number]>,
  Layer.Error<Layers[number]>,
  Layer.Services<Layers[number]>
>;
export function mergeServeList(layers: ServerServeList): Layer.Any {
  const mergeAll = Layer.mergeAll as (...layers: ServerServeList) => Layer.Any;
  return mergeAll(...layers);
}

/** Refuse to boot if any node-bound served resource declares a transport mismatch. @internal */
export const assertProtocolKinds = (
  entries: ReadonlyArray<Hyperlink.ServedHyperlink>,
  serverKind: ProtocolKind,
): Effect.Effect<void> =>
  Effect.forEach(
    entries,
    (entry) =>
      entry.nodeKinds !== undefined && !entry.nodeKinds.includes(serverKind)
        ? Effect.die(
            new ProtocolKindMismatch({
              serviceKey: entry.wireKey,
              declared: entry.nodeKinds,
              servedOver: serverKind,
            }),
          )
        : Effect.void,
    { discard: true },
  );

/**
 * Soft Lookup directory advertise layer after serve registration (`listen` via `advertiseNode`).
 *
 * @internal
 */
export const directoryAdvertiseMerge = (
  advertiseNode: (AnyNode & { readonly key: string }) | undefined,
  entries: ReadonlyArray<Hyperlink.ServedHyperlink>,
  options?: { readonly onConflict?: OnConflict },
): Effect.Effect<Layer.Any> => {
  if (advertiseNode === undefined) {
    return Effect.succeed(Layer.empty);
  }
  const serves = entries.map((entry) => entry.wireKey);
  return Effect.map(
    Effect.promise(() => import("../Lookup")),
    (Lookup) => {
      const advertiseLayer = Lookup.directoryAdvertiseLayer as (
        node: AnyNode & { readonly key: string },
        serves: ReadonlyArray<string>,
        options?: { readonly onConflict?: OnConflict },
      ) => Layer.Any;
      return advertiseLayer(advertiseNode, serves, options);
    },
  );
};
