import { describe, expect, it } from "vitest";
import {
  completeRun,
  enterWaiting,
  failRun,
  interruptRunBody,
  interruptWaitingAcquire,
  startRun,
} from "../src/internal/runResourceStatus";
import {
  makeRunCompletedFact,
  makeRunFailedFact,
  makeRunStartedFact,
  makeRunStateChange,
  toResourceState,
} from "../src/internal/runResourceFacts";
import type { RunGateStatus } from "../src/internal/runResource";

const baseStatus = (patch: Partial<RunGateStatus> = {}): RunGateStatus => ({
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

describe("runResourceStatus", () => {
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

describe("runResourceFacts", () => {
  it("builds typed fact rows", () => {
    expect(
      makeRunStartedFact({
        id: "r/run/1/started/1",
        resourceId: "@test/Gate",
        runId: "r/run/1",
        occurredAt: 1,
        concurrency: 2,
      }).type,
    ).toBe("run-resource.run.started");

    const completed = makeRunCompletedFact({
      id: "r/run/1/completed/1",
      resourceId: "@test/Gate",
      runId: "r/run/1",
      occurredAt: 2,
      durationMs: 10,
    });
    expect(completed.type).toBe("run-resource.run.completed");
    if (completed.type === "run-resource.run.completed") {
      expect(completed.durationMs).toBe(10);
    }

    const failed = makeRunFailedFact({
      id: "r/run/1/failed/1",
      resourceId: "@test/Gate",
      runId: "r/run/1",
      occurredAt: 3,
      durationMs: 4,
      cause: "boom",
    });
    expect(failed.type).toBe("run-resource.run.failed");
    if (failed.type === "run-resource.run.failed") {
      expect(failed.cause).toBe("boom");
    }
  });

  it("maps state transitions with null previous", () => {
    const current = baseStatus({ inFlight: 1, observedAt: 50 });
    const change = makeRunStateChange({
      id: "state-1",
      resourceId: "@test/Gate",
      changedAt: 50,
      reason: "run-resource.run.started",
      previous: null,
      current,
    });
    expect(change.previous).toBeNull();
    expect(change.current).toEqual(toResourceState(current));
  });
});
