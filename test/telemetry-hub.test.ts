import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  layer,
  layerWithSinks,
  sink,
  type TelemetryHub,
  type TelemetryHubEmitted,
} from "../src/TelemetryHub";
import {
  RunResourceHubTelemetry,
  STATE_CHANGED_WIRE,
  type RunResourceStateChangedInput,
} from "../src/store/RunResourceTelemetry";

const sampleState = {
  resourceId: "@app/Gate",
  observedAt: 1,
  configVersion: 1,
  concurrency: 1,
  waiting: 0,
  inFlight: 0,
  completed: 0,
  failed: 0,
  interrupted: 0,
  totalDurationMs: 0,
} as const;

const sampleChanged = (): RunResourceStateChangedInput => ({
  id: "@app/Gate",
  changedAt: 2,
  reason: "RunResource.State.Started",
  previous: null,
  current: { ...sampleState },
});

const hubLayer = (sinks: ReadonlyArray<ReturnType<typeof sink>> = []) =>
  sinks.length === 0
    ? layer
    : layerWithSinks(sinks);

describe("TelemetryHub", () => {
  it.effect("emit succeeds with hub layer only and zero sinks", () =>
    RunResourceHubTelemetry.State.changed(sampleChanged()).pipe(
      Effect.provide(layer),
    ),
  );

  it.effect("routes decoded payload to wire-matched sinks via layerWithSinks", () =>
    Effect.gen(function* () {
      const seen: TelemetryHubEmitted[] = [];
      const captureSink = sink({
        tag: "test-capture",
        wires: [STATE_CHANGED_WIRE],
        handle: (event) =>
          Effect.sync(() => {
            seen.push(event);
          }),
      });

      yield* RunResourceHubTelemetry.State.changed(sampleChanged()).pipe(
        Effect.provide(hubLayer([captureSink])),
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]?.wire).toBe(STATE_CHANGED_WIRE);
      expect(seen[0]?.payload).toEqual(sampleChanged());
    }),
  );

  it.effect("persist policy swallows sink failure", () =>
    RunResourceHubTelemetry.State.changed(sampleChanged()).pipe(
      Effect.provide(
        hubLayer([
          sink({
            tag: "failing-persist",
            wires: [STATE_CHANGED_WIRE],
            policy: "persist",
            handle: () => Effect.fail("storage-down"),
          }),
        ]),
      ),
    ),
  );
});

describe("TelemetryHub types", () => {
  it("emit requires only TelemetryHub", () => {
    type Requirements = Effect.Services<
      ReturnType<typeof RunResourceHubTelemetry.State.changed>
    >;
    type AssertHubOnly = Requirements extends TelemetryHub ? true : false;
    const _assert: AssertHubOnly = true;
    void _assert;
  });
});
