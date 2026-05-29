import { describe, expect, it } from "@effect/vitest";
import { Context, DateTime, Effect, Layer, Scope, pipe } from "effect";
import {
  And,
  Key,
  Occurred,
  ProcessId,
  RuntimeStorage,
  RuntimeStorageDecodeError,
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageQueryError,
  Type,
} from "../src";
import { PrismaRuntimeStorage } from "../src/storage/prisma";
import type {
  EffectPmRuntimeRecordCreateInput,
  EffectPmRuntimeRecordFindManyArgs,
  EffectPmRuntimeRecordRow,
  EffectPmRuntimeRecordUpdateInput,
  EffectPmRuntimeRecordWhereInput,
  PrismaRuntimeStorageClient,
} from "../src/prisma/types";
import { describeRuntimeStorageContract, runtimeStorageRecord } from "./runtime-storage.conformance";

type ComparableField =
  | "id"
  | "type"
  | "runId"
  | "processType"
  | "processId"
  | "subjectType"
  | "subjectId"
  | "key"
  | "indexA"
  | "indexB"
  | "indexC"
  | "indexD"
  | "indexE"
  | "indexF"
  | "indexG"
  | "indexH"
  | "readonly"
  | "occurredAt"
  | "createdAt";

const comparableFields: ReadonlyArray<ComparableField> = [
  "id",
  "type",
  "runId",
  "processType",
  "processId",
  "subjectType",
  "subjectId",
  "key",
  "indexA",
  "indexB",
  "indexC",
  "indexD",
  "indexE",
  "indexF",
  "indexG",
  "indexH",
  "readonly",
  "occurredAt",
  "createdAt",
];

const fieldValue = (
  row: EffectPmRuntimeRecordRow,
  field: ComparableField,
): string | boolean | Date | null => {
  switch (field) {
    case "id":
      return row.id;
    case "type":
      return row.type;
    case "runId":
      return row.runId;
    case "processType":
      return row.processType;
    case "processId":
      return row.processId;
    case "subjectType":
      return row.subjectType;
    case "subjectId":
      return row.subjectId;
    case "key":
      return row.key;
    case "indexA":
      return row.indexA;
    case "indexB":
      return row.indexB;
    case "indexC":
      return row.indexC;
    case "indexD":
      return row.indexD;
    case "indexE":
      return row.indexE;
    case "indexF":
      return row.indexF;
    case "indexG":
      return row.indexG;
    case "indexH":
      return row.indexH;
    case "readonly":
      return row.readonly;
    case "occurredAt":
      return row.occurredAt;
    case "createdAt":
      return row.createdAt;
  }
};

const compareValue = (
  left: string | boolean | Date | null,
  right: string | boolean | Date | null,
): number => {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
};

const matchesField = (
  row: EffectPmRuntimeRecordRow,
  field: ComparableField,
  condition: EffectPmRuntimeRecordWhereInput[ComparableField] | undefined,
): boolean => {
  if (condition === undefined) {
    return true;
  }
  const value = fieldValue(row, field);
  if (
    condition === null ||
    typeof condition === "string" ||
    typeof condition === "boolean"
  ) {
    return value === condition;
  }
  if ("equals" in condition && value !== condition.equals) {
    return false;
  }
  if ("not" in condition && value === condition.not) {
    return false;
  }
  if (
    "in" in condition &&
    condition.in !== undefined &&
    !condition.in.some((item) => item === value)
  ) {
    return false;
  }
  if ("gt" in condition && condition.gt !== undefined) {
    if (!(value instanceof Date) || value.getTime() <= condition.gt.getTime()) {
      return false;
    }
  }
  if ("lt" in condition && condition.lt !== undefined) {
    if (!(value instanceof Date) || value.getTime() >= condition.lt.getTime()) {
      return false;
    }
  }
  return true;
};

const matchesWhere = (
  row: EffectPmRuntimeRecordRow,
  where: EffectPmRuntimeRecordWhereInput | undefined,
): boolean => {
  if (where === undefined) {
    return true;
  }
  const andPredicates = Array.isArray(where.AND)
    ? where.AND
    : where.AND === undefined
    ? []
    : [where.AND];
  if (andPredicates.length > 0 && !andPredicates.every((item) => matchesWhere(row, item))) {
    return false;
  }
  if (where.OR !== undefined && !where.OR.some((item) => matchesWhere(row, item))) {
    return false;
  }
  for (const field of comparableFields) {
    if (!matchesField(row, field, where[field])) {
      return false;
    }
  }
  return true;
};

const sortRows = (
  rows: ReadonlyArray<EffectPmRuntimeRecordRow>,
  args: EffectPmRuntimeRecordFindManyArgs | undefined,
): EffectPmRuntimeRecordRow[] => {
  const orderBy = Array.isArray(args?.orderBy)
    ? args.orderBy
    : args?.orderBy === undefined
    ? []
    : [args.orderBy];
  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      for (const field of comparableFields) {
        const directionValue = order[field];
        if (directionValue === undefined) {
          continue;
        }
        const direction = directionValue === "asc" ? 1 : -1;
        const comparison = compareValue(
          fieldValue(left, field),
          fieldValue(right, field),
        );
        if (comparison !== 0) {
          return comparison * direction;
        }
      }
    }
    return 0;
  });
};

const rowFromInput = (
  input: EffectPmRuntimeRecordCreateInput,
): EffectPmRuntimeRecordRow => ({
  id: input.id,
  type: input.type,
  occurredAt: input.occurredAt,
  createdAt: input.createdAt,
  runId: input.runId,
  processType: input.processType,
  processId: input.processId,
  subjectType: input.subjectType ?? null,
  subjectId: input.subjectId ?? null,
  key: input.key ?? null,
  indexA: input.indexA ?? null,
  indexB: input.indexB ?? null,
  indexC: input.indexC ?? null,
  indexD: input.indexD ?? null,
  indexE: input.indexE ?? null,
  indexF: input.indexF ?? null,
  indexG: input.indexG ?? null,
  indexH: input.indexH ?? null,
  indexNamesJson: input.indexNamesJson ?? null,
  payloadJson: input.payloadJson ?? null,
  attributesJson: input.attributesJson ?? null,
  readonly: input.readonly ?? null,
});

const applyUpdate = (
  row: EffectPmRuntimeRecordRow,
  input: EffectPmRuntimeRecordUpdateInput,
): EffectPmRuntimeRecordRow => ({
  ...row,
  ...input,
  subjectType: input.subjectType === undefined ? row.subjectType : input.subjectType,
  subjectId: input.subjectId === undefined ? row.subjectId : input.subjectId,
  key: input.key === undefined ? row.key : input.key,
  indexA: input.indexA === undefined ? row.indexA : input.indexA,
  indexB: input.indexB === undefined ? row.indexB : input.indexB,
  indexC: input.indexC === undefined ? row.indexC : input.indexC,
  indexD: input.indexD === undefined ? row.indexD : input.indexD,
  indexE: input.indexE === undefined ? row.indexE : input.indexE,
  indexF: input.indexF === undefined ? row.indexF : input.indexF,
  indexG: input.indexG === undefined ? row.indexG : input.indexG,
  indexH: input.indexH === undefined ? row.indexH : input.indexH,
  indexNamesJson: input.indexNamesJson === undefined ? row.indexNamesJson : input.indexNamesJson,
  payloadJson: input.payloadJson === undefined ? row.payloadJson : input.payloadJson,
  attributesJson: input.attributesJson === undefined ? row.attributesJson : input.attributesJson,
  readonly: input.readonly === undefined ? row.readonly : input.readonly,
});

const uniqueError = () => ({ code: "P2002" });

const makeMemoryPrismaClient = (): PrismaRuntimeStorageClient & {
  readonly calls: {
    count: number;
    update: number;
    updateMany: number;
    delete: number;
    deleteMany: number;
  };
} => {
  const rows = new Map<string, EffectPmRuntimeRecordRow>();
  const calls = {
    count: 0,
    update: 0,
    updateMany: 0,
    delete: 0,
    deleteMany: 0,
  };
  const client: PrismaRuntimeStorageClient = {
    effectPmRuntimeRecord: {
      create: async ({ data }) => {
        if (rows.has(data.id)) {
          throw uniqueError();
        }
        const row = rowFromInput(data);
        rows.set(row.id, row);
        return row;
      },
      findMany: async (args) => {
        const selected = [...rows.values()].filter((row) => matchesWhere(row, args?.where));
        const ordered = sortRows(selected, args);
        const offset = Math.max(0, args?.skip ?? 0);
        const limited = ordered.slice(offset);
        return args?.take === undefined ? limited : limited.slice(0, Math.max(0, args.take));
      },
      count: async (args) => {
        calls.count++;
        return [...rows.values()].filter((row) => matchesWhere(row, args?.where)).length;
      },
      upsert: async ({ where, create, update }) => {
        const existing = rows.get(where.id);
        if (existing === undefined) {
          const row = rowFromInput(create);
          rows.set(row.id, row);
          return row;
        }
        const row = applyUpdate(existing, update);
        rows.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        calls.update++;
        const existing = rows.get(where.id);
        if (existing === undefined) {
          throw new Error(`missing row ${where.id}`);
        }
        const row = applyUpdate(existing, data);
        rows.set(row.id, row);
        return row;
      },
      delete: async ({ where }) => {
        calls.delete++;
        const existing = rows.get(where.id);
        if (existing === undefined) {
          throw new Error(`missing row ${where.id}`);
        }
        rows.delete(where.id);
        return existing;
      },
      updateMany: async ({ where, data }) => {
        calls.updateMany++;
        let count = 0;
        for (const row of [...rows.values()].filter((item) => matchesWhere(item, where))) {
          rows.set(row.id, applyUpdate(row, data));
          count++;
        }
        return { count };
      },
      deleteMany: async (args) => {
        calls.deleteMany++;
        let count = 0;
        for (const row of [...rows.values()].filter((item) => matchesWhere(item, args?.where))) {
          if (rows.delete(row.id)) {
            count++;
          }
        }
        return { count };
      },
    },
    $transaction: async (fn) => {
      const backup = new Map(rows);
      try {
        return await fn(client);
      } catch (cause) {
        rows.clear();
        for (const [id, row] of backup) {
          rows.set(id, row);
        }
        throw cause;
      }
    },
  };
  return Object.assign(client, { calls });
};

describeRuntimeStorageContract(
  "PrismaRuntimeStorage contract",
  Effect.sync(() => PrismaRuntimeStorage.make(makeMemoryPrismaClient())),
);

describe("PrismaRuntimeStorage", () => {
  it.effect("layer provides RuntimeStorage from an injected client", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const context = yield* Layer.buildWithScope(
        PrismaRuntimeStorage.layer({ client: makeMemoryPrismaClient() }),
        scope,
      );
      const storage = Context.get(context, RuntimeStorage);
      yield* storage.create(runtimeStorageRecord("layer-smoke"));
      const rows = yield* storage.read({ predicate: ProcessId.equals("queue-contract") });
      expect(rows.map((row) => row.id)).toEqual(["layer-smoke"]);
    }),
  );

  it.effect("layerFromContext consumes PrismaClientService", () =>
    Effect.gen(function* () {
      const storage = yield* RuntimeStorage;
      yield* storage.create(runtimeStorageRecord("context-smoke"));
      const rows = yield* storage.read({ predicate: Type.equals("queue.entry.enqueued") });
      expect(rows.map((row) => row.id)).toEqual(["context-smoke"]);
    }).pipe(
      Effect.provide(PrismaRuntimeStorage.layerFromContext),
      Effect.provide(PrismaRuntimeStorage.prismaClientLayer({ client: makeMemoryPrismaClient() })),
    ),
  );

  it.effect("maps duplicate Prisma constraint failures to RuntimeStorageDuplicateRecordError", () =>
    Effect.gen(function* () {
      const storage = PrismaRuntimeStorage.make(makeMemoryPrismaClient());
      yield* storage.create(runtimeStorageRecord("duplicate"));
      const error = yield* pipe(
        storage.create(runtimeStorageRecord("duplicate")),
        Effect.flip,
      );
      expect(error).toBeInstanceOf(RuntimeStorageDuplicateRecordError);
    }),
  );

  it.effect("round-trips Prisma Date and Json columns", () =>
    Effect.gen(function* () {
      const storage = PrismaRuntimeStorage.make(makeMemoryPrismaClient());
      yield* storage.create(runtimeStorageRecord("json-date", {
        occurredAt: DateTime.makeUnsafe("2026-03-01T00:00:00.000Z"),
        indexNames: ["batch"],
        payload: { status: "ok" },
        attributes: { source: "test" },
        key: "json-key",
      }));

      const rows = yield* storage.read({ predicate: Key.equals("json-key") });
      expect(rows[0]?.indexNames).toEqual(["batch"]);
      expect(rows[0]?.payload).toEqual({ status: "ok" });
      expect(rows[0]?.attributes).toEqual({ source: "test" });
      expect(rows[0] === undefined ? undefined : DateTime.formatIso(rows[0].occurredAt))
        .toBe("2026-03-01T00:00:00.000Z");
    }),
  );

  it.effect("uses exclusive date bounds for Between predicates", () =>
    Effect.gen(function* () {
      const start = DateTime.makeUnsafe("2026-04-01T00:00:00.000Z");
      const middle = DateTime.makeUnsafe("2026-04-01T00:01:00.000Z");
      const end = DateTime.makeUnsafe("2026-04-01T00:02:00.000Z");
      const storage = PrismaRuntimeStorage.make(makeMemoryPrismaClient());
      yield* storage.create(runtimeStorageRecord("before", {
        occurredAt: DateTime.makeUnsafe("2026-03-31T23:59:59.999Z"),
      }));
      yield* storage.create(runtimeStorageRecord("start-boundary", { occurredAt: start }));
      yield* storage.create(runtimeStorageRecord("middle", { occurredAt: middle }));
      yield* storage.create(runtimeStorageRecord("end-boundary", { occurredAt: end }));
      yield* storage.create(runtimeStorageRecord("after", {
        occurredAt: DateTime.makeUnsafe("2026-04-01T00:02:00.001Z"),
      }));

      const rows = yield* storage.read({ predicate: Occurred.between(start, end) });

      expect(rows.map((row) => row.id)).toEqual(["middle"]);
    }),
  );

  it.effect("uses aggregate writes for broad update and delete queries", () =>
    Effect.gen(function* () {
      const client = makeMemoryPrismaClient();
      const storage = PrismaRuntimeStorage.make(client);
      for (let index = 0; index < 25; index++) {
        yield* storage.create(runtimeStorageRecord(`bulk-${index}`, {
          key: "bulk",
        }));
      }

      const update = yield* storage.update(
        { predicate: Key.equals("bulk") },
        { payload: { updated: true } },
      );
      const deleted = yield* storage.delete({ predicate: Key.equals("bulk") });

      expect(update).toEqual({ matched: 25, updated: 25 });
      expect(deleted).toEqual({ deleted: 25 });
      expect(client.calls.count).toBe(1);
      expect(client.calls.updateMany).toBe(1);
      expect(client.calls.deleteMany).toBe(1);
      expect(client.calls.update).toBe(0);
      expect(client.calls.delete).toBe(0);
    }),
  );

  it.effect("counts empty patches without sending empty updateMany data", () =>
    Effect.gen(function* () {
      const client = makeMemoryPrismaClient();
      const storage = PrismaRuntimeStorage.make(client);
      yield* storage.create(runtimeStorageRecord("empty-patch"));
      yield* storage.create(runtimeStorageRecord("empty-patch-locked", { readonly: true }));

      const result = yield* storage.update(
        { predicate: ProcessId.equals("queue-contract") },
        {},
      );

      expect(result).toEqual({ matched: 2, updated: 1 });
      expect(client.calls.count).toBe(2);
      expect(client.calls.updateMany).toBe(0);
    }),
  );

  it.effect("treats an empty And predicate as a guarded no-match query", () =>
    Effect.gen(function* () {
      const storage = PrismaRuntimeStorage.make(makeMemoryPrismaClient());
      yield* storage.create(runtimeStorageRecord("empty-and"));

      const rows = yield* storage.read({ predicate: And([]) });

      expect(rows).toEqual([]);
    }),
  );

  it.effect("does not decode corrupt rows excluded by indexed predicates", () =>
    Effect.gen(function* () {
      const client = makeMemoryPrismaClient();
      const storage = PrismaRuntimeStorage.make(client);
      yield* storage.create(runtimeStorageRecord("good", {
        key: "good-key",
        payload: { ok: true },
      }));
      yield* Effect.promise(() =>
        client.effectPmRuntimeRecord.create({
          data: {
            id: "corrupt",
            type: "queue.entry.enqueued",
            occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
            createdAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01T00:00:01.000Z")),
            runId: "run-contract",
            processType: "queue-resource",
            processId: "queue-contract",
            key: "bad-key",
            payloadJson: "{",
          },
        })
      );

      const rows = yield* storage.read({ predicate: Key.equals("good-key") });

      expect(rows.map((row) => row.id)).toEqual(["good"]);
      expect(rows[0]?.payload).toEqual({ ok: true });
    }),
  );

  it.effect("surfaces matching corrupt rows as typed decode errors", () =>
    Effect.gen(function* () {
      const client = makeMemoryPrismaClient();
      const storage = PrismaRuntimeStorage.make(client);
      yield* Effect.promise(() =>
        client.effectPmRuntimeRecord.create({
          data: {
            id: "corrupt-selected",
            type: "queue.entry.enqueued",
            occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
            createdAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01T00:00:01.000Z")),
            runId: "run-contract",
            processType: "queue-resource",
            processId: "queue-contract",
            key: "bad-key",
            payloadJson: "{",
          },
        })
      );

      const error = yield* Effect.flip(storage.read({ predicate: Key.equals("bad-key") }));

      expect(error).toBeInstanceOf(RuntimeStorageDecodeError);
      expect(error._tag).toBe("RuntimeStorageDecodeError");
      if (error instanceof RuntimeStorageDecodeError) {
        expect(error.adapter).toBe("prisma");
        expect(error.operation).toBe("read");
        expect(error.id).toBe("corrupt-selected");
      }
    }),
  );

  it.effect("surfaces driver failures as typed query errors", () =>
    Effect.gen(function* () {
      const base = makeMemoryPrismaClient();
      const client: PrismaRuntimeStorageClient = {
        effectPmRuntimeRecord: {
          ...base.effectPmRuntimeRecord,
          findMany: () => Promise.reject(new Error("driver offline")),
        },
        $transaction: base.$transaction,
      };
      const storage = PrismaRuntimeStorage.make(client);

      const error = yield* Effect.flip(storage.read());

      expect(error).toBeInstanceOf(RuntimeStorageQueryError);
      expect(error._tag).toBe("RuntimeStorageQueryError");
      if (error instanceof RuntimeStorageQueryError) {
        expect(error.adapter).toBe("prisma");
        expect(error.operation).toBe("read");
        expect(String(error.cause)).toContain("driver offline");
      }
    }),
  );
});
