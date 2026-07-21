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
 * Bounds match Effect's {@link Layer.mergeAll}: `ROut` is contravariant so `Layer<never, …>`
 * accepts any success; `R` stays open so callers can still provide deps outside the server.
 *
 * @internal
 */
export type ServerServeList = readonly [
  Layer.Layer<never, any, any>,
  ...ReadonlyArray<Layer.Layer<never, any, any>>,
]

/** Merge a non-empty serve list — Effect's {@link Layer.mergeAll}, not a hand-rolled `any` fold. */
export const mergeServeList = (
  layers: ServerServeList,
): Layer.Layer<
  Layer.Success<ServerServeList[number]>,
  Layer.Error<ServerServeList[number]>,
  Layer.Services<ServerServeList[number]>
> => Layer.mergeAll(...layers)

/** Refuse to boot if any node-bound served resource declares a transport mismatch. @internal */
export const assertProtocolKinds = (
  entries: ReadonlyArray<Resource.ServedResource>,
  serverKind: ProtocolKind,
): Effect.Effect<void> =>
  Effect.forEach(
    entries,
    (entry) =>
      entry.nodeKind !== undefined && entry.nodeKind !== serverKind
        ? Effect.die(
            new ProtocolKindMismatch({
              resource: entry.groupId,
              declared: entry.nodeKind,
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
