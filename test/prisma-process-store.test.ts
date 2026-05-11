import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  ProcessStore,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleChangedEvent,
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
      const want =
        typeof where.type === "string" ? where.type : where.type.equals;
      if (want !== undefined && row.type !== want) return false;
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
      occurredAt: utcDateFromIso("2026-01-01T00:00:00.000Z"),
      entityType: "process",
      entityId: "p",
      execution: {
        scheduleKey: "live",
        startedAt: utcDateFromIso("2026-01-01T00:00:00.000Z"),
        completedAt: utcDateFromIso("2026-01-01T00:00:01.000Z"),
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
      occurredAt: utcDateFromIso("2026-01-01T01:00:00.000Z"),
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
        occurredAt: utcDateFromIso("2026-01-01T00:00:00.000Z"),
        entityType: "process",
        entityId: "p",
        execution: {
          scheduleKey: null,
          startedAt: utcDateFromIso("2026-01-01T00:00:00.000Z"),
          completedAt: utcDateFromIso("2026-01-01T00:00:00.500Z"),
          durationMs: 500,
          status: "completed",
          isStartupRun: true,
        },
      });
      yield* store.append({
        id: "e2",
        type: "process.execution.completed",
        occurredAt: utcDateFromIso("2026-01-01T00:01:00.000Z"),
        entityType: "process",
        entityId: "p",
        execution: {
          scheduleKey: "live",
          startedAt: utcDateFromIso("2026-01-01T00:01:00.000Z"),
          completedAt: utcDateFromIso("2026-01-01T00:01:00.250Z"),
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
        occurredAt: utcDateFromIso("2026-01-01T00:00:00.000Z"),
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
