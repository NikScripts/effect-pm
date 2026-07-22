/**
 * Shared plumbing for {@link httpServer} / {@link wsServer} / {@link ipcServer}.
 *
 * @internal
 */
import { Effect, Layer } from "effect"
import * as Resource from "../Resource"
import {
  AnyNode,
  OnConflict,
  ProtocolKind,
  ProtocolKindMismatch,
} from "./nodeCore"

/**
 * Non-empty serve list for {@link httpServer} / {@link wsServer} / {@link ipcServer}.
 * Element bounds stay `never`/`never`/`never` so `anyUnknownInErrorContext` stays quiet;
 * concrete call sites still infer Success/Error/Services through the generic overloads.
 *
 * @internal
 */
export type ServerServeList = readonly [
  Layer.Layer<never, any, any>,
  ...ReadonlyArray<Layer.Layer<never, any, any>>,
];

/** Merge a non-empty serve list — Effect's {@link Layer.mergeAll}, generic over the tuple. */
export const mergeServeList = <Layers extends ServerServeList>(
  layers: Layers,
): Layer.Layer<
  Layer.Success<Layers[number]>,
  Layer.Error<Layers[number]>,
  Layer.Services<Layers[number]>
  // `as any`: Effect's mergeAll bounds use `any`; keep the diagnostic off this shared helper.
> => Layer.mergeAll(...layers) as any;

/** Refuse to boot if any node-bound served resource declares a transport mismatch. @internal */
export const assertProtocolKinds = (
  entries: ReadonlyArray<Resource.ServedResource>,
  serverKind: ProtocolKind,
): Effect.Effect<void> =>
  Effect.forEach(
    entries,
    (entry) =>
      entry.nodeKinds !== undefined && !entry.nodeKinds.includes(serverKind)
        ? Effect.die(
            new ProtocolKindMismatch({
              resource: entry.groupId,
              declared: entry.nodeKinds,
              servedOver: serverKind,
            }),
          )
        : Effect.void,
    { discard: true },
  )

/**
 * Soft Lookup directory advertise layer after serve registration (`listen` via `advertiseNode`).
 * @internal
 */
export const directoryAdvertiseMerge = (
  advertiseNode: (AnyNode & { readonly key: string }) | undefined,
  entries: ReadonlyArray<Resource.ServedResource>,
  options?: { readonly onConflict?: OnConflict },
): Effect.Effect<Layer.Layer<never>> => {
  if (advertiseNode === undefined) {
    return Effect.succeed(Layer.empty);
  }
  const serves = entries.map((entry) => entry.groupId);
  return Effect.map(
    Effect.promise(() => import("../Lookup")),
    (Lookup) =>
      Lookup.directoryAdvertiseLayer(advertiseNode, serves, options) as Layer.Layer<never>,
  );
};
