import { describe, expect, it } from "@effect/vitest";
import { DateTime, Duration, Schema } from "effect";
import {
  makeDaemonExecutionEvent,
  daemonExecutionEventVoid,
} from "../src/internal/daemonEvent";
import { makeGateFactEvent } from "../src/internal/gateEvent";
import { buildQueueEvent } from "../src/WorkPool";

const terminalTags = ["Started", "Completed", "Failed"] as const;

const processDecode = Schema.decodeUnknownSync(daemonExecutionEventVoid);
const runFactDecode = Schema.decodeUnknownSync(makeGateFactEvent());

const itemSchema = Schema.Struct({ id: Schema.String });
const queueDecode = Schema.decodeUnknownSync(
  buildQueueEvent(itemSchema, Schema.Void, Schema.Unknown),
);

const sampleEntry = {
  item: { id: "x" },
  entryId: "e1",
  priority: "normal" as const,
  attempts: 0,
  timestamps: { enqueuedAt: DateTime.makeUnsafe(0) },
};

describe("store event _tag alignment", () => {
  it("process execution events use shared terminal tags", () => {
    const started = processDecode({
      _tag: "Started",
      key: "p",
      scheduleKey: null,
      startedAt: 1,
      isStartupRun: true,
    });
    expect(started._tag).toBe("Started");

    const completed = processDecode({
      _tag: "Completed",
      key: "p",
      scheduleKey: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
      isStartupRun: true,
    });
    expect(completed._tag).toBe("Completed");

    const failed = processDecode({
      _tag: "Failed",
      key: "p",
      scheduleKey: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
      isStartupRun: true,
      error: "boom",
    });
    expect(failed._tag).toBe("Failed");

    expect(
      makeDaemonExecutionEvent().members.length,
    ).toBeGreaterThanOrEqual(terminalTags.length + 1);
  });

  it("gate facts use shared terminal tags", () => {
    const started = runFactDecode({
      _tag: "Started",
      id: "f1",
      resourceId: "r",
      runId: "r/run/1",
      occurredAt: 1,
      concurrency: 1,
    });
    expect(started._tag).toBe("Started");

    const completed = runFactDecode({
      _tag: "Completed",
      id: "f2",
      resourceId: "r",
      runId: "r/run/1",
      occurredAt: 2,
      durationMs: 1,
    });
    expect(completed._tag).toBe("Completed");

    const failed = runFactDecode({
      _tag: "Failed",
      id: "f3",
      resourceId: "r",
      runId: "r/run/1",
      occurredAt: 2,
      durationMs: 1,
      error: "boom",
    });
    expect(failed._tag).toBe("Failed");
  });

  it("queue worker events use shared terminal tags", () => {
    const started = queueDecode({
      _tag: "Started",
      entry: sampleEntry,
    });
    expect(started._tag).toBe("Started");

    const completed = queueDecode({
      _tag: "Completed",
      entry: sampleEntry,
      success: undefined,
      elapsed: Duration.zero,
    });
    expect(completed._tag).toBe("Completed");

    // Queue `Failed` uses `cause` (live exit channel), not `error` — tag name still aligns.
    expect(
      buildQueueEvent(itemSchema, Schema.Void, Schema.Unknown).members.length,
    ).toBeGreaterThanOrEqual(terminalTags.length);
  });
});
