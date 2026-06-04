/**
 * **ArchiveSink** — optional {@link TelemetryHub} persist leg for archive facets.
 *
 * @remarks
 * Encoders bind to hub {@link TelemetryEventDefinition | event definitions} so
 * wire ids stay single-sourced from telemetry trees. Compose via
 * {@link layerForStore} beside {@link TelemetryHub.baseLayer}.
 *
 * @module ArchiveSink
 */

import { Clock, Effect, Layer, Ref } from "effect";
import { makeProcessStoreSpine } from "./internal/store/spine";
import { TelemetryHubState } from "./internal/telemetryHub/state";
import type { RuntimeRecord } from "./RuntimeStorage";
import { RuntimeStorage } from "./RuntimeStorage";
import {
  baseLayer,
  sink,
  type TelemetryEventDefinition,
  type TelemetryHubEmitted,
  type TelemetrySink,
} from "./TelemetryHub";

/** Archive row encoder for one hub event definition. @public */
export interface ArchiveSinkLeg {
  readonly event: TelemetryEventDefinition<any, any>;
  readonly encode: (payload: unknown) => Omit<RuntimeRecord, "runId" | "createdAt">;
}

/** Facet store class with a stable process tag for archive routing. @public */
export interface ArchiveSinkStoreClass {
  readonly _processTag: string;
}

/** @public */
export const leg = <A>(
  event: TelemetryEventDefinition<A, any>,
  encode: (payload: A) => Omit<RuntimeRecord, "runId" | "createdAt">,
): ArchiveSinkLeg => ({
  event,
  encode: (payload) => encode(payload as A),
});

const encodeFromLeg = (
  legDef: ArchiveSinkLeg,
  emitted: TelemetryHubEmitted,
): Effect.Effect<Omit<RuntimeRecord, "runId" | "createdAt">> =>
  Effect.sync(() => legDef.encode(emitted.payload));

/**
 * Build a persist {@link TelemetrySink} for one archive facet.
 *
 * @public
 */
export const forStore = (
  store: ArchiveSinkStoreClass,
  legs: ReadonlyArray<ArchiveSinkLeg>,
): Effect.Effect<TelemetrySink, never, RuntimeStorage> =>
  Effect.gen(function* () {
    const storage = yield* RuntimeStorage;
    const now = yield* Clock.currentTimeMillis;
    const spine = makeProcessStoreSpine(storage, `archive-sink-${store._processTag}-${String(now)}`);
    const byWire = new Map(legs.map((entry) => [entry.event.wire, entry] as const));

    return sink({
      tag: `ArchiveSink/${store._processTag}`,
      wires: legs.map((entry) => entry.event.wire),
      policy: "persist",
      handle: (emitted) =>
        Effect.gen(function* () {
          const entry = byWire.get(emitted.wire);
          if (entry === undefined) {
            return;
          }
          const record = yield* encodeFromLeg(entry, emitted);
          yield* spine.create(record);
        }),
    });
  });

/**
 * Hub layer with an archive persist sink for `store`.
 *
 * @public
 */
export const layerForStore = (
  store: ArchiveSinkStoreClass,
  legs: ReadonlyArray<ArchiveSinkLeg>,
): Layer.Layer<import("./TelemetryHub").TelemetryHub, never, RuntimeStorage> =>
  Layer.provideMerge(
    Layer.effectDiscard(
      Effect.gen(function* () {
        const registered = yield* forStore(store, legs);
        const { sinksRef } = yield* TelemetryHubState;
        yield* Ref.update(sinksRef, (sinks) => [...sinks, registered]);
      }),
    ),
    baseLayer,
  );

/** @public */
export namespace ArchiveSink {
  export type Leg = ArchiveSinkLeg;
  export type StoreClass = ArchiveSinkStoreClass;
}
