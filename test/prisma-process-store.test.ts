import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import {
  ProcessStore,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleChangedEvent,
  type QueueItemCompletedEvent,
  type QueueLifecycleChangedEvent,
  type RuntimeFactRecordedEvent,
  type RuntimeStateChangedEvent,
} from "../src";
import { provideLayer } from "../src/provideLayer.js";
import {
  PrismaProcessStore,
  decodeEventRow,
  encodeEvent,
  PrismaProcessStoreDecodeError,
  type EffectPmEventCreateInput,
  type EffectPmEventRow,
  type PrismaProcessStoreClient,
} from "../src/prisma";
import { utcDateFromIso, utcDateFromMillis } from "../src/utcDate.js";

const utcMillisFromIso = (iso: string): number => utcDateFromIso(iso).getTime();

// Derive the args shape structurally from the public client interface so the
// fake matches exactly what the adapter calls without relying on internal
// type exports.
type FindManyArgs = Parameters<
  PrismaProcessStoreClient["effectPmEvent"]["findMany"]
>[0];

// ---------------------------------------------------------------------------
// Structural Prisma client double — implements only what the adapter calls.
// ---------------------------------------------------------------------------

const makeFakeClient = () => {
  const rows: EffectPmEventRow[] = [];
  const insert = (input: EffectPmEventCreateInput) => {
    const row: EffectPmEventRow = {
      id: input.id,
      type: input.type,
      occurredAt: input.occurredAt,
      entityType: input.entityType,
      entityId: input.entityId,
      attributes: input.attributes ?? null,
      payload: input.payload,
      createdAt: utcDateFromMillis(0),
    };
    rows.push(row);
    return row;
  };

  const matches = (
    row: EffectPmEventRow,
    args: FindManyArgs | undefined,
  ): boolean => {
    const where = args?.where;
    if (where === undefined) return true;
    if (where.type !== undefined) {
      if (typeof where.type === "string") {
        if (row.type !== where.type) return false;
      } else {
        if (where.type.equals !== undefined && row.type !== where.type.equals) {
          return false;
        }
        if (where.type.in !== undefined && !where.type.in.includes(row.type)) {
          return false;
        }
      }
    }
    if (where.entityType !== undefined) {
      const want =
        typeof where.entityType === "string"
          ? where.entityType
          : where.entityType.equals;
      if (want !== undefined && row.entityType !== want) return false;
    }
    if (where.entityId !== undefined) {
      const want =
        typeof where.entityId === "string"
          ? where.entityId
          : where.entityId.equals;
      if (want !== undefined && row.entityId !== want) return false;
    }
    const range = where.occurredAt;
    if (range !== undefined) {
      const t = row.occurredAt.getTime();
      if (range.gt !== undefined && !(t > range.gt.getTime())) return false;
      if (range.gte !== undefined && !(t >= range.gte.getTime())) return false;
      if (range.lt !== undefined && !(t < range.lt.getTime())) return false;
      if (range.lte !== undefined && !(t <= range.lte.getTime())) return false;
    }
    return true;
  };

  const client: PrismaProcessStoreClient = {
    effectPmEvent: {
      create: (args) => Promise.resolve(insert(args.data)),
      createMany: (args) => {
        for (const data of args.data) {
          insert(data);
        }
        return Promise.resolve({ count: args.data.length });
      },
      findMany: (args) => {
        const out = rows.filter((row) => matches(row, args));
        const orderBy = Array.isArray(args?.orderBy)
          ? args?.orderBy[0]
          : args?.orderBy;
        if (orderBy?.occurredAt === "desc") {
          out.sort(
            (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
          );
        } else if (orderBy?.occurredAt === "asc") {
          out.sort(
            (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
          );
        }
        if (args?.skip !== undefined) {
          return Promise.resolve(
            out.slice(args.skip, args.skip + (args.take ?? out.length)),
          );
        }
        if (args?.take !== undefined) {
          return Promise.resolve(out.slice(0, args.take));
        }
        return Promise.resolve(out);
      },
    },
  };

  return { client, rows };
};

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

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
    const created = encodeEvent(event);
    const row: EffectPmEventRow = {
      id: created.id,
      type: created.type,
      occurredAt: created.occurredAt,
      entityType: created.entityType,
      entityId: created.entityId,
      attributes: created.attributes ?? null,
      payload: created.payload,
      createdAt: utcDateFromMillis(0),
    };
    const decoded = decodeEventRow(row);
    expect(decoded).toEqual(event);
  });

  it("round-trips a process.lifecycle.changed event with error", () => {
    const event: ProcessLifecycleChangedEvent = {
      id: "lc-1",
      type: "process.lifecycle.changed",
      occurredAt: utcMillisFromIso("2026-01-01T01:00:00.000Z"),
      entityType: "process",
      entityId: "p",
      lifecycle: { tag: "Errored", error: "boom" },
    };
    const created = encodeEvent(event);
    const row: EffectPmEventRow = {
      id: created.id,
      type: created.type,
      occurredAt: created.occurredAt,
      entityType: created.entityType,
      entityId: created.entityId,
      attributes: created.attributes ?? null,
      payload: created.payload,
      createdAt: utcDateFromMillis(0),
    };
    const decoded = decodeEventRow(row);
    expect(decoded).toEqual(event);
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
    const decoded = decodeEventRow(row);
    expect(decoded).toBeInstanceOf(PrismaProcessStoreDecodeError);
  });

  it("returns a tagged decode error for unknown event types", () => {
    const row: EffectPmEventRow = {
      id: "wat",
      type: "process.unknown",
      occurredAt: utcDateFromMillis(0),
      entityType: "process",
      entityId: "p",
      attributes: null,
      payload: {},
      createdAt: utcDateFromMillis(0),
    };
    const decoded = decodeEventRow(row);
    expect(decoded).toBeInstanceOf(PrismaProcessStoreDecodeError);
  });

  it("round-trips a runtime.fact.recorded event", () => {
    const event: RuntimeFactRecordedEvent = {
      id: "runtime-fact-1",
      type: "runtime.fact.recorded",
      occurredAt: utcMillisFromIso("2026-01-01T02:00:00.000Z"),
      entityType: "run-resource",
      entityId: "@test/RunGate",
      attributes: { source: "test" },
      fact: {
        id: "@test/RunGate/run/1/run-resource.run.completed",
        ref: { kind: "run-resource", id: "@test/RunGate" },
        type: "run-resource.run.completed",
        occurredAt: utcMillisFromIso("2026-01-01T02:00:00.000Z"),
        payload: { durationMs: 5 },
      },
    };
    const created = encodeEvent(event);
    const row: EffectPmEventRow = {
      id: created.id,
      type: created.type,
      occurredAt: created.occurredAt,
      entityType: created.entityType,
      entityId: created.entityId,
      attributes: created.attributes ?? null,
      payload: created.payload,
      createdAt: utcDateFromMillis(0),
    };
    const decoded = decodeEventRow(row);
    expect(decoded).toEqual(event);
  });

  it("round-trips a runtime.state.changed event", () => {
    const ref = { kind: "run-resource", id: "@test/RunGate" } as const;
    const current = {
      ref,
      observedAt: utcMillisFromIso("2026-01-01T02:10:00.000Z"),
      configVersion: 1,
      completed: 1,
    };
    const event: RuntimeStateChangedEvent = {
      id: "runtime-state-1",
      type: "runtime.state.changed",
      occurredAt: utcMillisFromIso("2026-01-01T02:10:00.000Z"),
      entityType: "run-resource",
      entityId: "@test/RunGate",
      change: {
        id: "@test/RunGate/state/1",
        ref,
        changedAt: utcMillisFromIso("2026-01-01T02:10:00.000Z"),
        reason: "run-resource.run.completed",
        previous: null,
        current,
      },
    };
    const created = encodeEvent(event);
    const row: EffectPmEventRow = {
      id: created.id,
      type: created.type,
      occurredAt: created.occurredAt,
      entityType: created.entityType,
      entityId: created.entityId,
      attributes: created.attributes ?? null,
      payload: created.payload,
      createdAt: utcDateFromMillis(0),
    };
    const decoded = decodeEventRow(row);
    expect(decoded).toEqual(event);
  });

  it("round-trips queue analytics events", () => {
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

    for (const event of [completed, lifecycle]) {
      const created = encodeEvent(event);
      const decoded = decodeEventRow({
        id: created.id,
        type: created.type,
        occurredAt: created.occurredAt,
        entityType: created.entityType,
        entityId: created.entityId,
        attributes: created.attributes ?? null,
        payload: created.payload,
        createdAt: utcDateFromMillis(0),
      });
      expect(decoded).toEqual(event);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end via the structural client double
// ---------------------------------------------------------------------------

describe("PrismaProcessStore — adapter", () => {
  it.live("appends and queries process executions through Prisma", () => {
    const { client, rows } = makeFakeClient();
    return Effect.gen(function* () {
      const store = yield* ProcessStore;
      yield* store.append({
        id: "e1",
        type: "process.execution.completed",
        occurredAt: utcMillisFromIso("2026-01-01T00:00:00.000Z"),
        entityType: "process",
        entityId: "p",
        execution: {
          scheduleKey: null,
          startedAt: utcMillisFromIso("2026-01-01T00:00:00.000Z"),
          completedAt: utcMillisFromIso("2026-01-01T00:00:00.500Z"),
          durationMs: 500,
          status: "completed",
          isStartupRun: true,
        },
      });
      yield* store.append({
        id: "e2",
        type: "process.execution.completed",
        occurredAt: utcMillisFromIso("2026-01-01T00:01:00.000Z"),
        entityType: "process",
        entityId: "p",
        execution: {
          scheduleKey: "live",
          startedAt: utcMillisFromIso("2026-01-01T00:01:00.000Z"),
          completedAt: utcMillisFromIso("2026-01-01T00:01:00.250Z"),
          durationMs: 250,
          status: "failed",
          error: "fail",
          isStartupRun: false,
        },
      });

      const recent = yield* store.getProcessExecutions("p", { limit: 1 });
      expect(recent.length).toBe(1);
      expect(recent[0]?.id).toBe("e2");

      const all = yield* store.getProcessExecutions("p");
      expect(all.map((row) => row.id)).toEqual(["e2", "e1"]);

      expect(rows.length).toBe(2);
    }).pipe(provideLayer(PrismaProcessStore.layer({ client })));
  });

  it.live("queries generic events through Prisma", () => {
    const { client } = makeFakeClient();
    return Effect.gen(function* () {
      const store = yield* ProcessStore;
      yield* store.append({
        id: "runtime-fact",
        type: "runtime.fact.recorded",
        occurredAt: utcMillisFromIso("2026-01-01T04:00:00.000Z"),
        entityType: "run-resource",
        entityId: "@test/RunGate",
        fact: {
          id: "@test/RunGate/run/1/run-resource.run.started",
          ref: { kind: "run-resource", id: "@test/RunGate" },
          type: "run-resource.run.started",
          occurredAt: utcMillisFromIso("2026-01-01T04:00:00.000Z"),
          payload: { concurrency: 1 },
        },
      });

      const rows = yield* store.events({
        entityType: "run-resource",
        entityId: "@test/RunGate",
        types: ["runtime.fact.recorded"],
      });
      const facts = yield* ProcessStore.runtime.facts({
        ref: { kind: "run-resource", id: "@test/RunGate" },
        types: ["run-resource.run.started"],
      });
      const history = yield* ProcessStore.runResource.history("@test/RunGate");

      expect(rows.map((row) => row.id)).toEqual(["runtime-fact"]);
      expect(facts.map((fact) => fact.id)).toEqual([
        "@test/RunGate/run/1/run-resource.run.started",
      ]);
      expect(history.map((fact) => fact.id)).toEqual([
        "@test/RunGate/run/1/run-resource.run.started",
      ]);
    }).pipe(provideLayer(PrismaProcessStore.layer({ client })));
  });

  it.live("projects runtime state history through Prisma", () => {
    const { client } = makeFakeClient();
    return Effect.gen(function* () {
      const store = yield* ProcessStore;
      const ref = { kind: "run-resource", id: "@test/PrismaStateGate" } as const;
      const changedAt = utcMillisFromIso("2026-01-01T04:30:00.000Z");
      const current = {
        ref,
        observedAt: changedAt,
        configVersion: 1,
        completed: 1,
      };

      yield* store.append({
        id: "prisma-state-change",
        type: "runtime.state.changed",
        occurredAt: changedAt,
        entityType: "run-resource",
        entityId: "@test/PrismaStateGate",
        change: {
          id: "prisma-state-change/inner",
          ref,
          changedAt,
          reason: "run-resource.run.completed",
          previous: null,
          current,
        },
      });

      const history = yield* ProcessStore.runtime.stateHistory({ ref });
      const latest = yield* ProcessStore.runtime.latestState(ref);

      expect(history.map((change) => change.id)).toEqual([
        "prisma-state-change/inner",
      ]);
      expect(Option.getOrNull(latest)).toEqual(current);
    }).pipe(provideLayer(PrismaProcessStore.layer({ client })));
  });

  it.live("queries queue completion and lifecycle events through Prisma", () => {
    const { client } = makeFakeClient();
    return Effect.gen(function* () {
      const store = yield* ProcessStore;
      const t1 = utcMillisFromIso("2026-01-01T05:00:00.000Z");
      const t2 = utcMillisFromIso("2026-01-01T05:05:00.000Z");
      const t3 = utcMillisFromIso("2026-01-01T05:10:00.000Z");

      yield* store.appendBatch([
        {
          id: "prisma-queue-item-completed",
          type: "queue.item.completed",
          occurredAt: t1,
          entityType: "queue",
          entityId: "email-queue",
          item: {
            status: "completed",
            priority: "normal",
            durationMs: 12,
            attempts: 1,
          },
        },
        {
          id: "prisma-queue-item-failed",
          type: "queue.item.completed",
          occurredAt: t3,
          entityType: "queue",
          entityId: "email-queue",
          item: {
            status: "failed",
            priority: "high",
            durationMs: 20,
            attempts: 2,
            error: "smtp down",
          },
        },
        {
          id: "prisma-queue-paused",
          type: "queue.lifecycle.changed",
          occurredAt: t2,
          entityType: "queue",
          entityId: "email-queue",
          lifecycle: { tag: "Paused" },
        },
        {
          id: "prisma-other-queue-item",
          type: "queue.item.completed",
          occurredAt: t2,
          entityType: "queue",
          entityId: "sms-queue",
          item: {
            status: "completed",
            priority: "low",
            durationMs: 4,
            attempts: 1,
          },
        },
      ]);

      const completions = yield* store.getQueueItemCompletions("email-queue");
      expect(completions.map((row) => row.id)).toEqual([
        "prisma-queue-item-failed",
        "prisma-queue-item-completed",
      ]);

      const limited = yield* store.getQueueItemCompletions("email-queue", {
        before: t3,
        limit: 1,
      });
      expect(limited.map((row) => row.id)).toEqual([
        "prisma-queue-item-completed",
      ]);

      const lifecycle = yield* store.getQueueLifecycle("email-queue");
      expect(lifecycle.map((row) => row.id)).toEqual(["prisma-queue-paused"]);
    }).pipe(provideLayer(PrismaProcessStore.layer({ client })));
  });

  it.live("orders process executions by event occurrence time", () => {
    const { client } = makeFakeClient();
    return Effect.gen(function* () {
      const store = yield* ProcessStore;

      const earlyStart = utcMillisFromIso("2026-01-01T00:00:00.000Z");
      const lateStart = utcMillisFromIso("2026-01-01T00:10:00.000Z");
      const earlyCompletion = utcMillisFromIso("2026-01-01T00:11:00.000Z");
      const lateCompletion = utcMillisFromIso("2026-01-01T00:12:00.000Z");

      yield* store.appendBatch([
        {
          id: "long-run",
          type: "process.execution.completed",
          occurredAt: lateCompletion,
          entityType: "process",
          entityId: "p-overlap",
          execution: {
            scheduleKey: "live",
            startedAt: earlyStart,
            completedAt: lateCompletion,
            durationMs: lateCompletion - earlyStart,
            status: "completed",
            isStartupRun: false,
          },
        },
        {
          id: "short-run",
          type: "process.execution.completed",
          occurredAt: earlyCompletion,
          entityType: "process",
          entityId: "p-overlap",
          execution: {
            scheduleKey: "live",
            startedAt: lateStart,
            completedAt: earlyCompletion,
            durationMs: earlyCompletion - lateStart,
            status: "completed",
            isStartupRun: false,
          },
        },
      ]);

      const all = yield* store.getProcessExecutions("p-overlap");
      expect(all.map((row) => row.id)).toEqual(["long-run", "short-run"]);

      const beforeLateCompletion = yield* store.getProcessExecutions("p-overlap", {
        before: lateCompletion,
      });
      expect(beforeLateCompletion.map((row) => row.id)).toEqual(["short-run"]);
    }).pipe(provideLayer(PrismaProcessStore.layer({ client })));
  });

  it.live("supports the layer-from-context wiring", () => {
    const { client } = makeFakeClient();
    const layer = Layer.provide(
      PrismaProcessStore.layerFromContext,
      PrismaProcessStore.prismaClientLayer({ client }),
    );
    return Effect.gen(function* () {
      const store = yield* ProcessStore;
      yield* store.append({
        id: "lc-1",
        type: "process.lifecycle.changed",
        occurredAt: utcMillisFromIso("2026-01-01T00:00:00.000Z"),
        entityType: "process",
        entityId: "p",
        lifecycle: { tag: "Started" },
      });
      const lifecycle = yield* store.getProcessLifecycle("p");
      expect(lifecycle.length).toBe(1);
      expect(lifecycle[0]?.lifecycle.tag).toBe("Started");
    }).pipe(provideLayer(layer));
  });
});
