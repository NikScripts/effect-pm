import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { RuntimeStorage } from "../src/RuntimeStorage";
import { layer } from "../src/TelemetryHub";
import { archiveLegs } from "../src/store/RunResourceStore";
import {
  runResourcePersistLayer,
  RunResourceStore,
  type RunResourceStateChangedInput,
} from "../src/store/RunResource";
import { processStorageWithRunResourceArchiveLayer } from "../src/ProcessStorage";
import {
  RunResourceHubTelemetry,
  STATE_CHANGED_WIRE,
} from "../src/store/RunResourceTelemetry";

const sampleStateChanged = (
  resourceId: string,
): RunResourceStateChangedInput => ({
  id: `${resourceId}/state/1`,
  changedAt: 1_700_000_000_000,
  reason: "RunResource.State.Started",
  previous: null,
  current: {
    resourceId,
    observedAt: 1_700_000_000_000,
    configVersion: 1,
    concurrency: 1,
    waiting: 0,
    inFlight: 1,
    completed: 0,
    failed: 0,
    interrupted: 0,
    totalDurationMs: 0,
  },
});

const hubOnlyLayer = Layer.provide(
  Layer.mergeAll(RunResourceStore.layerRuntimeStorage, layer),
  RuntimeStorage.layer,
);

const persistLayer = runResourcePersistLayer;

describe("RunResource ArchiveSink", () => {
  it.effect("emit without archive sink succeeds and leaves storage empty", () =>
    Effect.gen(function* () {
      const resourceId = "@test/HubOnly";
      yield* RunResourceHubTelemetry.State.changed(sampleStateChanged(resourceId));
      const store = yield* RunResourceStore;
      const latest = yield* store.latestState({ resourceId });
      expect(Option.isNone(latest)).toBe(true);
    }).pipe(Effect.provide(Layer.provide(hubOnlyLayer, RuntimeStorage.layer))),
  );

  it.effect("emit with ArchiveSink persists State.Changed row", () =>
    Effect.gen(function* () {
      const resourceId = "@test/ArchiveSink";
      yield* RunResourceHubTelemetry.State.changed(sampleStateChanged(resourceId));
      const store = yield* RunResourceStore;
      const history = yield* store.stateHistory({ resourceId });
      expect(history).toHaveLength(1);
      expect(history[0]?.reason).toBe("RunResource.State.Started");
      expect(history[0]?.current.inFlight).toBe(1);
    }).pipe(Effect.provide(persistLayer)),
  );

  it.effect("archive encoder uses hub event wire id", () =>
    Effect.sync(() => {
      expect(archiveLegs.some((entry) => entry.event.wire === STATE_CHANGED_WIRE)).toBe(
        true,
      );
    }),
  );
});

describe("RunResource ArchiveSink + ProcessStorage", () => {
  it.effect("compose with combined storage layer", () =>
    Effect.gen(function* () {
      const resourceId = "@test/Combined";
      yield* RunResourceHubTelemetry.State.changed(sampleStateChanged(resourceId));
      const store = yield* RunResourceStore;
      const latest = yield* store.latestState({ resourceId });
      expect(Option.isSome(latest)).toBe(true);
    }).pipe(
      Effect.provide(processStorageWithRunResourceArchiveLayer),
    ),
  );
});
