import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { RunResource } from "../src/RunResource";
import {
  RunResourceRunStarted,
  RunResourceStateChanged,
  RunResourceTelemetry,
} from "../src/store/RunResourceTelemetry";

describe("RunResourceTelemetry Tag (Step 2 port)", () => {
  it("derives golden wire ids (operation segment excluded)", () => {
    expect(RunResourceTelemetry.Run.run.Started.wire).toBe("RunResource.Run.Started");
    expect(RunResourceTelemetry.Run.run.exit.onSuccess.wire).toBe(
      "RunResource.Run.Completed",
    );
    expect(RunResourceTelemetry.Run.run.exit.onFailure.wire).toBe(
      "RunResource.Run.Failed",
    );
    expect(RunResourceTelemetry.State.Changed.wire).toBe("RunResource.State.Changed");
  });

  it("targets the RunResource domain service with the facet id", () => {
    expect(RunResourceTelemetry.namespace).toBe("RunResource");
    expect(RunResourceTelemetry.target).toBe(RunResource);
    expect(RunResourceTelemetry.facetId).toBe(
      "@nikscripts/effect-pm/store/RunResource/RunResourceTelemetry",
    );
  });

  it("Run.Started.Struct decodes the full wire payload", () => {
    const decoded = Schema.decodeUnknownSync(RunResourceRunStarted.Struct as never)({
      runId: "@app/Gate/run/1",
      occurredAt: 1_700_000_000_000,
      payload: { concurrency: 3 },
    });
    expect(decoded).toEqual({
      runId: "@app/Gate/run/1",
      occurredAt: 1_700_000_000_000,
      payload: { concurrency: 3 },
    });
  });

  it("State.Changed.Struct carries the previous/current snapshot struct", () => {
    const snapshot = {
      resourceId: "@app/Gate",
      observedAt: 1_700_000_000_000,
      configVersion: 1,
      concurrency: 3,
      waiting: 0,
      inFlight: 1,
      completed: 0,
      failed: 0,
      interrupted: 0,
      totalDurationMs: 0,
    };
    const decoded = Schema.decodeUnknownSync(RunResourceStateChanged.Struct as never)({
      id: "@app/Gate/state/1",
      changedAt: 1_700_000_000_000,
      reason: "RunResource.State.Started",
      previous: null,
      current: snapshot,
    });
    expect(decoded).toEqual({
      id: "@app/Gate/state/1",
      changedAt: 1_700_000_000_000,
      reason: "RunResource.State.Started",
      previous: null,
      current: snapshot,
    });
  });
});
