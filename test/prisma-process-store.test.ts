import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import {
  ProcessStore,
  type ProcessExecutionCompletedEvent,
  type QueueItemCompletedEvent,
  type QueueLifecycleChangedEvent,
  type RunResourceFactRecordedEvent,
  type RunResourceStateChangedEvent,
} from "../src";
import {
  decodeEventRow,
  encodeEvent,
  PrismaProcessStore,
  PrismaProcessStoreDecodeError,
  PrismaProcessStoreUnavailableError,
  type EffectPmEventCreateInput,
  type EffectPmEventRow,
  type PrismaProcessStoreClient,
} from "../src/prisma";
import { utcDateFromIso, utcDateFromMillis } from "../src/internal/utcDate";

const utcMillisFromIso = (iso: string): number => utcDateFromIso(iso).getTime();

const rowFromInput = (input: EffectPmEventCreateInput): EffectPmEventRow => ({
  id: input.id,
  type: input.type,
  occurredAt: input.occurredAt,
  entityType: input.entityType,
  entityId: input.entityId,
  attributes: input.attributes ?? null,
  payload: input.payload,
  createdAt: utcDateFromMillis(0),
});

const makeFakeClient = (): PrismaProcessStoreClient => ({
  effectPmEvent: {
    create: ({ data }) => Promise.resolve(rowFromInput(data)),
    createMany: ({ data }) => Promise.resolve({ count: data.length }),
    findMany: () => Promise.resolve([]),
  },
});

describe("PrismaProcessStore — codec", () => {
  it("round-trips a process.execution.completed event", () => {
    const event: ProcessExecutionCompletedEvent = {
      id: "exec-1",
      type: "process.execution.completed",
      occurredAt: utcMillisFromIso("2026-01-01T00:00:00.000Z"),
      entityType: "process",
      entityId: "p",
      execution: {
        scheduleKey: "live",
        startedAt: utcMillisFromIso("2026-01-01T00:00:00.000Z"),
        completedAt: utcMillisFromIso("2026-01-01T00:00:01.000Z"),
        durationMs: 1000,
        status: "completed",
        isStartupRun: true,
      },
    };

    expect(decodeEventRow(rowFromInput(encodeEvent(event)))).toEqual(event);
  });

  it("returns a tagged decode error for malformed payloads", () => {
    const row: EffectPmEventRow = {
      id: "bad-1",
      type: "process.execution.completed",
      occurredAt: utcDateFromMillis(0),
      entityType: "process",
      entityId: "p",
      attributes: null,
      payload: { not: "an execution payload" },
      createdAt: utcDateFromMillis(0),
    };

    expect(decodeEventRow(row)).toBeInstanceOf(PrismaProcessStoreDecodeError);
  });

  it("round-trips runtime and queue event codecs", () => {
    const fact: RunResourceFactRecordedEvent = {
      id: "runtime-fact-1",
      type: "run-resource.fact.recorded",
      occurredAt: utcMillisFromIso("2026-01-01T02:00:00.000Z"),
      entityType: "run-resource",
      entityId: "@test/RunGate",
      attributes: { source: "test" },
      fact: {
        id: "@test/RunGate/run/1/run-resource.run.completed",
        resourceId: "@test/RunGate",
        runId: "@test/RunGate/run/1",
        type: "run-resource.run.completed",
        occurredAt: utcMillisFromIso("2026-01-01T02:00:00.000Z"),
        payload: { durationMs: 5 },
      },
    };
    const state: RunResourceStateChangedEvent = {
      id: "runtime-state-1",
      type: "run-resource.state.changed",
      occurredAt: utcMillisFromIso("2026-01-01T02:10:00.000Z"),
      entityType: "run-resource",
      entityId: "@test/RunGate",
      change: {
        id: "@test/RunGate/state/1",
        resourceId: "@test/RunGate",
        changedAt: utcMillisFromIso("2026-01-01T02:10:00.000Z"),
        reason: "run-resource.run.completed",
        previous: null,
        current: {
          resourceId: "@test/RunGate",
          observedAt: utcMillisFromIso("2026-01-01T02:10:00.000Z"),
          configVersion: 1,
          concurrency: 1,
          waiting: 0,
          inFlight: 0,
          completed: 1,
          failed: 0,
          interrupted: 0,
          totalDurationMs: 5,
        },
      },
    };
    const completed: QueueItemCompletedEvent = {
      id: "queue-item-1",
      type: "queue.item.completed",
      occurredAt: utcMillisFromIso("2026-01-01T03:00:00.000Z"),
      entityType: "queue",
      entityId: "email-queue",
      item: {
        status: "completed",
        priority: "normal",
        durationMs: 12,
        attempts: 1,
      },
    };
    const lifecycle: QueueLifecycleChangedEvent = {
      id: "queue-life-1",
      type: "queue.lifecycle.changed",
      occurredAt: utcMillisFromIso("2026-01-01T03:01:00.000Z"),
      entityType: "queue",
      entityId: "email-queue",
      lifecycle: { tag: "Cleared", itemsCleared: 3 },
    };

    for (const event of [fact, state, completed, lifecycle]) {
      expect(decodeEventRow(rowFromInput(encodeEvent(event)))).toEqual(event);
    }
  });
});

describe("PrismaProcessStore — placeholder", () => {
  it("throws a clear unavailable error for direct construction", () => {
    expect(() => PrismaProcessStore.make(makeFakeClient())).toThrow(
      PrismaProcessStoreUnavailableError,
    );
  });

  it.live("fails layer acquisition until the RuntimeStorage rewrite lands", () =>
    Effect.gen(function* () {
      const layer = Layer.provide(
        PrismaProcessStore.layerFromContext,
        PrismaProcessStore.prismaClientLayer({ client: makeFakeClient() }),
      );
      const exit = yield* Effect.exit(
        ProcessStore.pipe(Effect.provide(layer), Effect.scoped),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
