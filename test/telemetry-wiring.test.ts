import { describe, expect, it } from "@effect/vitest";
import { Layer } from "effect";
import { Telemetry, Wiring } from "../src/Telemetry";
import { RunResourceScope } from "../src/RunResourceScope";
import { RunResourceTelemetry } from "../src/store/RunResourceTelemetry";

describe("Telemetry wiring (Step 3a value layer)", () => {
  const wiring = Wiring.sections(
    Telemetry.extend(RunResourceScope, {
      waiting: Telemetry.metric.gauge,
      inFlight: Telemetry.metric.gauge,
      completed: Telemetry.metric.counter,
      totalDurationMs: Telemetry.metric.counter,
    }),
    Telemetry.bind(RunResourceTelemetry.Run.run.Started, {
      payload: { concurrency: Telemetry.state.from((s) => s["gateConcurrency"]) },
    }).pipe(
      Telemetry.logWarning("RunResourceStore write failed for run start", ({ runId }) => ({
        runId: String(runId),
      })),
    ),
    Telemetry.bind(RunResourceTelemetry.Run.run.exit.onFailure, {
      payload: {
        durationMs: Telemetry.source.exit.durationMs,
        cause: Telemetry.source.exit.cause,
      },
    }),
    Telemetry.bind(RunResourceTelemetry.State.Changed, {
      id: Telemetry.state.from((s) => s["stateChangeSeq"]),
      reason: Telemetry.state.from((s) => s["pendingReasonWire"]),
      previous: Telemetry.state.from((s) => s["pendingPreviousSnapshot"]),
      current: Telemetry.state.from((s) => s["pendingCurrentSnapshot"]),
    }),
  );

  it("collects extend sections keyed nothing, binds keyed by node path", () => {
    expect(wiring.extend).toHaveLength(1);
    expect(wiring.extend[0]?.scopeId).toBe(RunResourceScope.id);
    expect(wiring.extend[0]?.metrics["waiting"]).toEqual({ kind: "gauge" });
    expect(wiring.extend[0]?.metrics["completed"]).toEqual({ kind: "counter" });

    expect(Object.keys(wiring.binds).sort()).toEqual([
      "Run.run.Started",
      "Run.run.exit.onFailure",
      "State.Changed",
    ]);
    expect(wiring.binds["Run.run.Started"]?.wire).toBe("RunResource.Run.Started");
    expect(wiring.binds["State.Changed"]?.wire).toBe("RunResource.State.Changed");
  });

  it("accumulates log legs from bind.pipe", () => {
    expect(wiring.binds["Run.run.Started"]?.logs).toHaveLength(1);
    expect(wiring.binds["Run.run.Started"]?.logs[0]?.kind).toBe("warning");
    expect(wiring.logs.find((l) => l.path === "Run.run.Started")?.legs).toHaveLength(1);
    // a bind without .pipe has no logs
    expect(wiring.binds["Run.run.exit.onFailure"]?.logs).toHaveLength(0);
  });

  it("Telemetry.layer builds a Layer requiring the router; withLayer attaches .layer", () => {
    const facetLayer = Telemetry.layer(RunResourceTelemetry, wiring);
    expect(Layer.isLayer(facetLayer)).toBe(true);

    const exported = Telemetry.withLayer(RunResourceTelemetry, facetLayer);
    expect(Layer.isLayer(exported.layer)).toBe(true);
    // calling surface (handles) still reachable on the exported tag
    expect(exported.State.Changed.wire).toBe("RunResource.State.Changed");
  });
});
