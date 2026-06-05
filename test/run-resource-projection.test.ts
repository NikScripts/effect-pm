import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Stream } from "effect";
import { BroadcastSink, TelemetryBroadcast } from "../src/sink/BroadcastSink";
import { TelemetryHub } from "../src/TelemetryHub";
import { RunResourceCompose } from "../src/store/RunResource";
import { RuntimeStorage } from "../src/RuntimeStorage";
import {
  RunResourceProjection,
  RunResourceStore,
  type RunResourceStateChangedInput,
} from "../src/store/RunResource";
import { RunResourceHubTelemetry, STATE_CHANGED_WIRE } from "../src/store/RunResourceTelemetry";
import type { TelemetryHubEmitted } from "../src/TelemetryHub";

const sampleStateChanged = (
  resourceId: string,
  inFlight: number,
  changedAt = 1_700_000_000_000,
): RunResourceStateChangedInput => ({
  id: `${resourceId}/state/${String(inFlight)}`,
  changedAt,
  reason: "RunResource.State.Started",
  previous: null,
  current: {
    resourceId,
    observedAt: changedAt,
    configVersion: 1,
    concurrency: 1,
    waiting: 0,
    inFlight,
    completed: 0,
    failed: 0,
    interrupted: 0,
    totalDurationMs: 0,
  },
});

const archiveOnlyLayer = Layer.provide(
  Layer.mergeAll(
    RunResourceStore.layerRuntimeStorage,
    RunResourceCompose.layerArchiveSink,
    TelemetryHub.layer,
  ),
  RuntimeStorage.layer,
);

const projectionLiveLayer = Layer.provideMerge(
  BroadcastSink.layer,
  RunResourceProjection.layerLive,
);

describe("RunResourceProjection", () => {
  it.effect("State.Changed emit updates latestState in-process", () =>
    Effect.gen(function* () {
      const resourceId = "@test/Projection";
      yield* RunResourceHubTelemetry.State.changed(
        sampleStateChanged(resourceId, 2),
      );
      const projection = yield* RunResourceProjection;
      const latest = yield* projection.latestState(resourceId);
      expect(Option.isSome(latest)).toBe(true);
      if (Option.isSome(latest)) {
        expect(latest.value.inFlight).toBe(2);
      }
    }).pipe(Effect.provide(projectionLiveLayer)),
  );

  it.live("telemetry stream receives emit without storeTransport", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const resourceId = "@test/TelemetryWire";
        const broadcast = yield* TelemetryBroadcast;
        const received = yield* Deferred.make<TelemetryHubEmitted>();
        const listener = yield* broadcast
          .stream([STATE_CHANGED_WIRE])
          .pipe(
            Stream.take(1),
            Stream.runForEach((event) => Deferred.succeed(received, event)),
            Effect.forkChild,
          );

        yield* Effect.yieldNow;
        yield* RunResourceHubTelemetry.State.changed(
          sampleStateChanged(resourceId, 1),
        );

        const item = yield* Deferred.await(received);
        yield* Fiber.interrupt(listener);
        expect(item.wire).toBe(STATE_CHANGED_WIRE);
        expect(item.payload).toMatchObject({
          current: { resourceId, inFlight: 1 },
        });
      }).pipe(Effect.provide(projectionLiveLayer)),
    ),
  );

  it.effect("layerHydrateFromArchive seeds projection from archive latestState", () => {
    const resourceId = "@test/Hydrate";
    const hydrateStack = Layer.provide(
      Layer.mergeAll(
        RunResourceStore.layerRuntimeStorage,
        RunResourceCompose.layerArchiveSink,
        TelemetryHub.layer,
        RunResourceProjection.layer,
      ),
      RuntimeStorage.layer,
    );

    return Effect.gen(function* () {
      yield* RunResourceHubTelemetry.State.changed(
        sampleStateChanged(resourceId, 3, 1_700_000_000_001),
      );
      yield* Layer.build(
        RunResourceProjection.layerHydrateFromArchive([resourceId]),
      );
      const projection = yield* RunResourceProjection;
      const seeded = yield* projection.latestState(resourceId);
      expect(Option.isSome(seeded)).toBe(true);
      if (Option.isSome(seeded)) {
        expect(seeded.value.inFlight).toBe(3);
      }
    }).pipe(Effect.provide(hydrateStack));
  });

  it.effect("after hydrate simulation live hub emit updates projection without store reads", () =>
    Effect.gen(function* () {
      const resourceId = "@test/LiveAfterHydrate";
      const store = yield* RunResourceStore;
      const projection = yield* RunResourceProjection;

      yield* RunResourceHubTelemetry.State.changed(
        sampleStateChanged(resourceId, 3, 1_700_000_000_001),
      );
      const archived = yield* store.latestState({ resourceId });
      expect(Option.isSome(archived)).toBe(true);
      if (Option.isSome(archived)) {
        yield* projection.seedState(resourceId, archived.value);
      }

      yield* RunResourceHubTelemetry.State.changed(
        sampleStateChanged(resourceId, 0, 1_700_000_000_002),
      );
      const live = yield* projection.latestState(resourceId);
      expect(Option.isSome(live)).toBe(true);
      if (Option.isSome(live)) {
        expect(live.value.inFlight).toBe(0);
      }
    }).pipe(
      Effect.provide(
        Layer.provide(
          Layer.mergeAll(
            RunResourceStore.layerRuntimeStorage,
            RunResourceCompose.layerArchiveSink,
            TelemetryHub.layer,
            RunResourceProjection.layerLive,
            BroadcastSink.layer,
          ),
          RuntimeStorage.layer,
        ),
      ),
    ),
  );

  it.effect("projection stays empty without hydrate when archive has rows", () =>
    Effect.gen(function* () {
      const resourceId = "@test/NoHydrate";
      yield* RunResourceHubTelemetry.State.changed(
        sampleStateChanged(resourceId, 1),
      );
      const store = yield* RunResourceStore;
      const archived = yield* store.latestState({ resourceId });
      expect(Option.isSome(archived)).toBe(true);

      const projection = yield* RunResourceProjection;
      expect(Option.isNone(yield* projection.latestState(resourceId))).toBe(true);
    }).pipe(
      Effect.provide(Layer.mergeAll(archiveOnlyLayer, RunResourceProjection.layer)),
    ),
  );
});

describe("RunResourceProjection hub-only baseline", () => {
  it.effect("emit succeeds with hub layer only and no projection sink", () =>
    Effect.gen(function* () {
      yield* RunResourceHubTelemetry.State.changed(
        sampleStateChanged("@test/HubOnly", 1),
      );
    }).pipe(Effect.provide(TelemetryHub.layer)),
  );
});
