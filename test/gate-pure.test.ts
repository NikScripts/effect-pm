import { describe, expect, it } from "vitest";
import {
  completeRun,
  enterWaiting,
  failRun,
  interruptRunBody,
  interruptWaitingAcquire,
  startRun,
} from "../src/internal/gateStatus";
import {
  makeGateCompletedFact,
  makeGateFailedFact,
  makeGateStartedFact,
  makeGateStateChange,
  toHyperlinkState,
} from "../src/internal/gateFacts";
import type { GateStatus } from "../src/internal/gate";

const baseStatus = (patch: Partial<GateStatus> = {}): GateStatus => ({
  resourceId: "@test/Gate",
  observedAt: 0,
  configVersion: 1,
  concurrency: 2,
  waiting: 0,
  inFlight: 0,
  completed: 0,
  failed: 0,
  interrupted: 0,
  totalDurationMs: 0,
  ...patch,
});

describe("gateStatus", () => {
  it("enterWaiting increments waiting and stamps observedAt", () => {
    const next = enterWaiting(baseStatus(), 100);
    expect(next).toMatchObject({ waiting: 1, observedAt: 100 });
  });

  it("interruptWaitingAcquire drops waiting and increments interrupted", () => {
    const next = interruptWaitingAcquire(baseStatus({ waiting: 2 }), 101);
    expect(next).toMatchObject({ waiting: 1, interrupted: 1, observedAt: 101 });
  });

  it("startRun moves a waiter into in-flight", () => {
    const next = startRun(baseStatus({ waiting: 1, inFlight: 0 }), 102);
    expect(next).toMatchObject({ waiting: 0, inFlight: 1, observedAt: 102 });
  });

  it("completeRun decrements in-flight and accumulates duration", () => {
    const next = completeRun(baseStatus({ inFlight: 2, completed: 3, totalDurationMs: 10 }), 103, 25);
    expect(next).toMatchObject({
      inFlight: 1,
      completed: 4,
      totalDurationMs: 35,
      observedAt: 103,
    });
  });

  it("failRun and interruptRunBody never go negative on in-flight", () => {
    expect(failRun(baseStatus({ inFlight: 0 }), 1, 5).inFlight).toBe(0);
    expect(interruptRunBody(baseStatus({ inFlight: 0 }), 1, 5).inFlight).toBe(0);
  });
});

describe("gateFacts", () => {
  it("builds typed fact rows", () => {
    expect(
      makeGateStartedFact({
        id: "r/run/1/started/1",
        resourceId: "@test/Gate",
        runId: "r/run/1",
        occurredAt: 1,
        concurrency: 2,
      })._tag,
    ).toBe("Started");

    const completed = makeGateCompletedFact({
      id: "r/run/1/completed/1",
      resourceId: "@test/Gate",
      runId: "r/run/1",
      occurredAt: 2,
      durationMs: 10,
    });
    expect(completed._tag).toBe("Completed");
    if (completed._tag === "Completed") {
      expect(completed.durationMs).toBe(10);
    }

    const failed = makeGateFailedFact({
      id: "r/run/1/failed/1",
      resourceId: "@test/Gate",
      runId: "r/run/1",
      occurredAt: 3,
      durationMs: 4,
      error: "boom",
    });
    expect(failed._tag).toBe("Failed");
    if (failed._tag === "Failed") {
      expect(failed.error).toBe("boom");
    }
  });

  it("maps state transitions with null previous", () => {
    const current = baseStatus({ inFlight: 1, observedAt: 50 });
    const change = makeGateStateChange({
      id: "state-1",
      resourceId: "@test/Gate",
      changedAt: 50,
      reason: "gate.run.started",
      previous: null,
      current,
    });
    expect(change.previous).toBeNull();
    expect(change.current).toEqual(toHyperlinkState(current));
  });
});
