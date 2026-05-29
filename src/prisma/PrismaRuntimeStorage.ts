/**
 * Prisma-backed RuntimeStorage adapter.
 *
 * @remarks
 * The adapter stores normalized `RuntimeRecord` rows through a structural
 * Prisma client. Consumers own Prisma generation, migrations, connection
 * lifetime, and shutdown; this module never imports `@prisma/client` and never
 * calls `$disconnect`.
 *
 * Public errors stay adapter-agnostic: duplicate ids and readonly upserts are
 * logical failures, while driver and decode failures map to
 * `RuntimeStorageQueryError` / `RuntimeStorageDecodeError`. Internal Prisma
 * errors are wrapped only long enough to preserve operation and row context.
 *
 * Prisma's native `Json?` input types use generated null sentinels, so runtime
 * JSON values are serialized into string columns at the storage boundary. That
 * keeps generated clients structurally compatible without importing generated
 * Prisma types into this package.
 *
 * @module PrismaRuntimeStorage
 */

import { Context, Data, DateTime, Effect, Layer, Option, Schema } from "effect";
import type {
  RuntimeRecordField,
  RuntimeRecordOrderField,
  RuntimeRecordPatch,
  RuntimeRecordPredicate,
  RuntimeRecordQuery,
} from "../Query";
import { ProcessStorage } from "../ProcessStorage";
import { RuntimeStorage } from "../RuntimeStorage";
import {
  RuntimeStorageDecodeError,
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageQueryError,
  RuntimeStorageReadonlyRecordError,
  RuntimeStorageTransactionError,
  type RuntimeStorageLogicalError,
  type DeleteResult,
  type RuntimeRecord,
  type RuntimeStorageOperation,
  type RuntimeStorageService,
  type UpdateResult,
} from "../RuntimeStorage";
import type { LogStore } from "../store/log";
import type { ProcessExecutionStore } from "../store/processExecution";
import type { ProcessGroupStore } from "../store/processGroup";
import type { ProcessLifecycleStore } from "../store/processLifecycle";
import type { QueueResourceStore } from "../store/queueResource";
import type { RunResourceStore } from "../store/runResource";
import { isJsonValue, unknownJsonString } from "../internal/json";
import type {
  EffectPmRuntimeRecordCreateInput,
  EffectPmRuntimeRecordFindManyArgs,
  EffectPmRuntimeRecordOrderByInput,
  EffectPmRuntimeRecordRow,
  EffectPmRuntimeRecordUpdateInput,
  EffectPmRuntimeRecordWhereInput,
  PrismaRuntimeStorageClient,
} from "./types";
import type { JsonValue } from "../ProcessStoreEvent";

/**
 * Effect Context service exposing a structural Prisma client.
 *
 * @public
 */
export class PrismaClientService extends Context.Service<
  PrismaClientService,
  PrismaRuntimeStorageClient
>()("@nikscripts/effect-pm/prisma/PrismaRuntimeStorage/PrismaClientService") {}

/**
 * Build a layer providing {@link PrismaClientService} from a concrete client.
 *
 * @public
 */
export const prismaClientLayer = (config: {
  readonly client: PrismaRuntimeStorageClient;
}): Layer.Layer<PrismaClientService> =>
  Layer.succeed(PrismaClientService, config.client);

class PrismaRuntimeStorageDriverError extends Data.TaggedError(
  "PrismaRuntimeStorageDriverError",
)<{
  readonly cause: unknown;
}> {}

class PrismaRuntimeStorageDecodeError extends Data.TaggedError(
  "PrismaRuntimeStorageDecodeError",
)<{
  readonly id: string;
  readonly cause: unknown;
}> {}

const prismaQueryError = (
  operation: RuntimeStorageOperation,
  error: PrismaRuntimeStorageDriverError,
): RuntimeStorageQueryError =>
  new RuntimeStorageQueryError({
    adapter: "prisma",
    operation,
    cause: error.cause,
  });

const prismaDecodeError = (
  error: PrismaRuntimeStorageDecodeError,
): RuntimeStorageDecodeError =>
  new RuntimeStorageDecodeError({
    adapter: "prisma",
    operation: "read",
    id: error.id,
    cause: error.cause,
    detail: "Failed to decode EffectPmRuntimeRecord row",
  });

const optionalStringFields: ReadonlySet<RuntimeRecordField> = new Set([
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
]);

const impossibleWhere: EffectPmRuntimeRecordWhereInput = {
  AND: [
    { id: { equals: "__effect_pm_never__" } },
    { id: { not: "__effect_pm_never__" } },
  ],
};

// JSON text columns mirror SQLite's storage boundary and avoid Prisma-specific
// JsonNull / DbNull sentinels in the public structural client interface.
const jsonColumn = (text: string | null): JsonValue | undefined => {
  if (text === null) {
    return undefined;
  }
  return Option.match(Schema.decodeUnknownOption(unknownJsonString)(text), {
    onNone: () => {
      throw new Error("PrismaRuntimeStorage: invalid JSON column");
    },
    onSome: (value) => {
      if (isJsonValue(value)) {
        return value;
      }
      throw new Error("PrismaRuntimeStorage: non-JSON column value");
    },
  });
};

const indexNamesColumn = (text: string | null): ReadonlyArray<string> | undefined => {
  const value = jsonColumn(text);
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new Error("PrismaRuntimeStorage: invalid indexNames JSON column");
};

const dateFromUtc = (value: DateTime.Utc): Date =>
  DateTime.toDateUtc(value);

const utcFromDate = (value: Date): DateTime.Utc => {
  const utc = DateTime.makeUnsafe(value.getTime());
  return DateTime.isUtc(utc) ? utc : DateTime.toUtc(utc);
};

const encodeJsonColumn = (value: JsonValue | undefined): string | null =>
  value === undefined
    ? null
    : Schema.encodeUnknownSync(unknownJsonString)(value);

const encodeIndexNamesColumn = (
  value: ReadonlyArray<string> | undefined,
): string | null =>
  value === undefined
    ? null
    : Schema.encodeUnknownSync(unknownJsonString)([...value]);

const encodeCreateInput = (
  record: RuntimeRecord,
): EffectPmRuntimeRecordCreateInput => ({
  id: record.id,
  type: record.type,
  occurredAt: dateFromUtc(record.occurredAt),
  createdAt: dateFromUtc(record.createdAt),
  runId: record.runId,
  processType: record.processType,
  processId: record.processId,
  subjectType: record.subjectType ?? null,
  subjectId: record.subjectId ?? null,
  key: record.key ?? null,
  indexA: record.indexA ?? null,
  indexB: record.indexB ?? null,
  indexC: record.indexC ?? null,
  indexD: record.indexD ?? null,
  indexE: record.indexE ?? null,
  indexF: record.indexF ?? null,
  indexG: record.indexG ?? null,
  indexH: record.indexH ?? null,
  indexNamesJson: encodeIndexNamesColumn(record.indexNames),
  payloadJson: encodeJsonColumn(record.payload),
  attributesJson: encodeJsonColumn(record.attributes),
  readonly: record.readonly ?? null,
});

const encodeUpdateInput = (
  record: RuntimeRecord,
): EffectPmRuntimeRecordUpdateInput => ({
  type: record.type,
  occurredAt: dateFromUtc(record.occurredAt),
  createdAt: dateFromUtc(record.createdAt),
  runId: record.runId,
  processType: record.processType,
  processId: record.processId,
  subjectType: record.subjectType ?? null,
  subjectId: record.subjectId ?? null,
  key: record.key ?? null,
  indexA: record.indexA ?? null,
  indexB: record.indexB ?? null,
  indexC: record.indexC ?? null,
  indexD: record.indexD ?? null,
  indexE: record.indexE ?? null,
  indexF: record.indexF ?? null,
  indexG: record.indexG ?? null,
  indexH: record.indexH ?? null,
  indexNamesJson: encodeIndexNamesColumn(record.indexNames),
  payloadJson: encodeJsonColumn(record.payload),
  attributesJson: encodeJsonColumn(record.attributes),
  readonly: record.readonly ?? null,
});

const encodePatchInput = (
  patch: RuntimeRecordPatch,
): EffectPmRuntimeRecordUpdateInput => ({
  ...(patch.type === undefined ? {} : { type: patch.type }),
  ...(patch.occurredAt === undefined ? {} : { occurredAt: dateFromUtc(patch.occurredAt) }),
  ...(patch.runId === undefined ? {} : { runId: patch.runId }),
  ...(patch.processType === undefined ? {} : { processType: patch.processType }),
  ...(patch.processId === undefined ? {} : { processId: patch.processId }),
  ...(patch.subjectType === undefined ? {} : { subjectType: patch.subjectType }),
  ...(patch.subjectId === undefined ? {} : { subjectId: patch.subjectId }),
  ...(patch.key === undefined ? {} : { key: patch.key }),
  ...(patch.indexA === undefined ? {} : { indexA: patch.indexA }),
  ...(patch.indexB === undefined ? {} : { indexB: patch.indexB }),
  ...(patch.indexC === undefined ? {} : { indexC: patch.indexC }),
  ...(patch.indexD === undefined ? {} : { indexD: patch.indexD }),
  ...(patch.indexE === undefined ? {} : { indexE: patch.indexE }),
  ...(patch.indexF === undefined ? {} : { indexF: patch.indexF }),
  ...(patch.indexG === undefined ? {} : { indexG: patch.indexG }),
  ...(patch.indexH === undefined ? {} : { indexH: patch.indexH }),
  ...(patch.indexNames === undefined
    ? {}
    : { indexNamesJson: patch.indexNames === null ? null : encodeIndexNamesColumn(patch.indexNames) }),
  ...(patch.payload === undefined
    ? {}
    : { payloadJson: patch.payload === null ? null : encodeJsonColumn(patch.payload) }),
  ...(patch.attributes === undefined
    ? {}
    : { attributesJson: patch.attributes === null ? null : encodeJsonColumn(patch.attributes) }),
});

const isEmptyUpdateInput = (
  input: EffectPmRuntimeRecordUpdateInput,
): boolean =>
  Object.keys(input).length === 0;

const decodeRow = (row: EffectPmRuntimeRecordRow): RuntimeRecord => ({
  id: row.id,
  type: row.type,
  occurredAt: utcFromDate(row.occurredAt),
  createdAt: utcFromDate(row.createdAt),
  runId: row.runId,
  processType: row.processType,
  processId: row.processId,
  subjectType: row.subjectType ?? undefined,
  subjectId: row.subjectId ?? undefined,
  key: row.key ?? undefined,
  indexA: row.indexA ?? undefined,
  indexB: row.indexB ?? undefined,
  indexC: row.indexC ?? undefined,
  indexD: row.indexD ?? undefined,
  indexE: row.indexE ?? undefined,
  indexF: row.indexF ?? undefined,
  indexG: row.indexG ?? undefined,
  indexH: row.indexH ?? undefined,
  indexNames: indexNamesColumn(row.indexNamesJson),
  payload: jsonColumn(row.payloadJson),
  attributes: jsonColumn(row.attributesJson),
  readonly: row.readonly ?? undefined,
});

const decodeRowEffect = (
  row: EffectPmRuntimeRecordRow,
): Effect.Effect<RuntimeRecord, PrismaRuntimeStorageDecodeError> =>
  Effect.try({
    try: () => decodeRow(row),
    catch: (cause) =>
      new PrismaRuntimeStorageDecodeError({
        id: row.id,
        cause: new Error(`PrismaRuntimeStorage: failed to decode row ${row.id}`, {
          cause,
        }),
      }),
  });

const comparisonMatchesStringField = (
  field: RuntimeRecordField,
  value: string | boolean,
): value is string => field !== "readonly" && typeof value === "string";

const comparisonMatchesReadonlyField = (
  field: RuntimeRecordField,
  value: string | boolean,
): value is boolean => field === "readonly" && typeof value === "boolean";

const whereEquals = (
  field: RuntimeRecordField,
  value: string | boolean,
): EffectPmRuntimeRecordWhereInput => {
  if (comparisonMatchesStringField(field, value)) {
    return { [field]: { equals: value } };
  }
  if (comparisonMatchesReadonlyField(field, value)) {
    return { readonly: { equals: value } };
  }
  return impossibleWhere;
};

const whereNotEquals = (
  field: RuntimeRecordField,
  value: string | boolean,
): EffectPmRuntimeRecordWhereInput => {
  if (comparisonMatchesStringField(field, value)) {
    const notEquals: EffectPmRuntimeRecordWhereInput = { [field]: { not: value } };
    return optionalStringFields.has(field)
      ? { OR: [{ [field]: { equals: null } }, notEquals] }
      : notEquals;
  }
  if (comparisonMatchesReadonlyField(field, value)) {
    return { OR: [{ readonly: { equals: null } }, { readonly: { not: value } }] };
  }
  return {};
};

const stringValues = (values: ReadonlyArray<string | boolean>): Array<string> =>
  values.filter((value): value is string => typeof value === "string");

const booleanValues = (values: ReadonlyArray<string | boolean>): Array<boolean> =>
  values.filter((value): value is boolean => typeof value === "boolean");

const whereIn = (
  field: RuntimeRecordField,
  values: ReadonlyArray<string | boolean>,
): EffectPmRuntimeRecordWhereInput => {
  if (field === "readonly") {
    const booleans = booleanValues(values);
    const branches: Array<EffectPmRuntimeRecordWhereInput> = values.includes("")
      ? [{ readonly: { equals: null } }, { readonly: { in: booleans } }]
      : [{ readonly: { in: booleans } }];
    return booleans.length === 0 && !values.includes("") ? impossibleWhere : { OR: branches };
  }

  const strings = stringValues(values);
  const inFilter: EffectPmRuntimeRecordWhereInput = { [field]: { in: strings } };
  if (strings.length === 0) {
    return impossibleWhere;
  }
  return optionalStringFields.has(field) && values.includes("")
    ? { OR: [{ [field]: { equals: null } }, inFilter] }
    : inFilter;
};

const whereIsNull = (field: RuntimeRecordField): EffectPmRuntimeRecordWhereInput =>
  optionalStringFields.has(field) || field === "readonly"
    ? { [field]: { equals: null } }
    : impossibleWhere;

const whereIsNotNull = (field: RuntimeRecordField): EffectPmRuntimeRecordWhereInput =>
  optionalStringFields.has(field) || field === "readonly"
    ? { [field]: { not: null } }
    : {};

const wherePredicate = (
  predicate: RuntimeRecordPredicate | undefined,
): EffectPmRuntimeRecordWhereInput | undefined => {
  if (predicate === undefined) {
    return undefined;
  }

  switch (predicate._tag) {
    case "Equals":
      return whereEquals(predicate.field, predicate.value);
    case "NotEquals":
      return whereNotEquals(predicate.field, predicate.value);
    case "In":
      return whereIn(predicate.field, predicate.values);
    case "IsNull":
      return whereIsNull(predicate.field);
    case "IsNotNull":
      return whereIsNotNull(predicate.field);
    case "After":
      return { [predicate.field]: { gt: dateFromUtc(predicate.value) } };
    case "Before":
      return { [predicate.field]: { lt: dateFromUtc(predicate.value) } };
    case "Between":
      return {
        [predicate.field]: {
          gt: dateFromUtc(predicate.start),
          lt: dateFromUtc(predicate.end),
        },
      };
    case "And":
      return predicate.predicates.length === 0
        // Treat accidental empty groups as guarded no-matches. `Where()` is the
        // explicit unfiltered query path.
        ? impossibleWhere
        : { AND: predicate.predicates.map((item) => wherePredicate(item) ?? {}) };
    case "Or":
      return predicate.predicates.length === 0
        ? impossibleWhere
        : { OR: predicate.predicates.map((item) => wherePredicate(item) ?? {}) };
  }
};

const orderByInput = (
  field: RuntimeRecordOrderField,
  direction: "asc" | "desc",
): EffectPmRuntimeRecordOrderByInput => ({ [field]: direction });

const findManyArgs = (
  query: RuntimeRecordQuery | undefined,
): EffectPmRuntimeRecordFindManyArgs => {
  const where = wherePredicate(query?.predicate);
  const orderBy = query?.orderBy ?? [
    { field: "occurredAt", direction: "desc" },
  ];
  const args: EffectPmRuntimeRecordFindManyArgs = {
    orderBy: orderBy.map((order) => orderByInput(order.field, order.direction)),
  };
  return {
    ...args,
    ...(where === undefined ? {} : { where }),
    ...(query?.limit === undefined ? {} : { take: Math.max(0, query.limit) }),
    ...(query?.offset === undefined ? {} : { skip: Math.max(0, query.offset) }),
  };
};

const queryWhere = (query: RuntimeRecordQuery | undefined): EffectPmRuntimeRecordWhereInput | undefined =>
  wherePredicate(query?.predicate);

const mutableWhere = (
  where: EffectPmRuntimeRecordWhereInput | undefined,
): EffectPmRuntimeRecordWhereInput => ({
  AND: [
    where ?? {},
    // RuntimeStorage update/delete skip readonly rows unless delete explicitly
    // opts in via `readonly === true`.
    {
      OR: [
        { readonly: { equals: null } },
        { readonly: { not: true } },
      ],
    },
  ],
});

const includesReadonlyTrue = (
  predicate: RuntimeRecordPredicate | undefined,
): boolean => {
  if (predicate === undefined) {
    return false;
  }
  switch (predicate._tag) {
    case "Equals":
      return predicate.field === "readonly" && predicate.value === true;
    case "And":
    case "Or":
      return predicate.predicates.some(includesReadonlyTrue);
    default:
      return false;
  }
};

const prismaPromise = <A>(
  evaluate: () => Promise<A>,
): Effect.Effect<A, PrismaRuntimeStorageDriverError> =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new PrismaRuntimeStorageDriverError({ cause }),
  });

const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
};

const isUniqueConstraintError = (error: unknown): boolean =>
  errorCode(error) === "P2002";

/**
 * Construct a Prisma-backed {@link RuntimeStorageService}.
 *
 * @public
 */
export const make = (
  client: PrismaRuntimeStorageClient,
): RuntimeStorageService => {
  const service: RuntimeStorageService = {
    create: (record) =>
      prismaPromise(() =>
        client.effectPmRuntimeRecord.create({ data: encodeCreateInput(record) })
      ).pipe(
        Effect.mapError((error) =>
          isUniqueConstraintError(error.cause)
            ? new RuntimeStorageDuplicateRecordError({ id: record.id })
            : prismaQueryError("create", error)
        ),
        Effect.asVoid,
      ),

    read: (query) =>
      prismaPromise(() =>
        client.effectPmRuntimeRecord.findMany(findManyArgs(query))
      ).pipe(
        Effect.mapError((error) => prismaQueryError("read", error)),
        Effect.flatMap((rows) => Effect.forEach(rows, decodeRowEffect)),
        Effect.mapError((error) =>
          error instanceof PrismaRuntimeStorageDecodeError
            ? prismaDecodeError(error)
            : error
        ),
      ),

    upsert: (record) =>
      Effect.gen(function* () {
        const existing = yield* prismaPromise(() =>
          client.effectPmRuntimeRecord.findMany({
            where: { id: { equals: record.id } },
            take: 1,
          })
        ).pipe(Effect.mapError((error) => prismaQueryError("upsert", error)));
        if (existing[0]?.readonly === true) {
          return yield* new RuntimeStorageReadonlyRecordError({ id: record.id });
        }
        yield* prismaPromise(() =>
          client.effectPmRuntimeRecord.upsert({
            where: { id: record.id },
            create: encodeCreateInput(record),
            update: encodeUpdateInput(record),
          })
        ).pipe(Effect.asVoid, Effect.mapError((error) => prismaQueryError("upsert", error)));
      }),

    update: (query, patch) => {
      const where = queryWhere(query);
      const data = encodePatchInput(patch);
      return prismaPromise(() =>
        client.effectPmRuntimeRecord.count({ where })
      ).pipe(
        Effect.mapError((error) => prismaQueryError("update", error)),
        Effect.flatMap((matched) =>
          isEmptyUpdateInput(data)
            ? prismaPromise(() =>
                client.effectPmRuntimeRecord.count({ where: mutableWhere(where) })
              ).pipe(
                Effect.mapError((error) => prismaQueryError("update", error)),
                Effect.map((updated) => ({ matched, updated }) satisfies UpdateResult),
              )
            : prismaPromise(() =>
                client.effectPmRuntimeRecord.updateMany({
                  where: mutableWhere(where),
                  data,
                })
              ).pipe(
                Effect.mapError((error) => prismaQueryError("update", error)),
                Effect.map((update) =>
                  ({ matched, updated: update.count }) satisfies UpdateResult
                ),
              )
        ),
      );
    },

    delete: (query) => {
      const where = queryWhere(query);
      const deleteWhere = includesReadonlyTrue(query.predicate)
        ? where
        : mutableWhere(where);
      return prismaPromise(() =>
        client.effectPmRuntimeRecord.deleteMany({ where: deleteWhere })
      ).pipe(
        Effect.mapError((error) => prismaQueryError("delete", error)),
        Effect.map((deleted) => ({ deleted: deleted.count }) satisfies DeleteResult),
      );
    },

    transaction: <A, E, R>(
      effect: Effect.Effect<A, E, R | RuntimeStorage>,
    ): Effect.Effect<
      A,
      E | RuntimeStorageTransactionError | RuntimeStorageLogicalError,
      Exclude<R, RuntimeStorage>
    > =>
      Effect.gen(function* () {
        const context = yield* Effect.context<R>();
        return yield* Effect.tryPromise({
          try: () =>
            client.$transaction((tx) =>
              Effect.runPromiseWith(context)(
                Effect.provideService(effect, RuntimeStorage, make(tx)),
              ),
            ),
          catch: (cause) =>
            new RuntimeStorageTransactionError({
              adapter: "prisma",
              operation: "transaction",
              cause,
            }),
        });
      }) as Effect.Effect<
        A,
        E | RuntimeStorageTransactionError | RuntimeStorageLogicalError,
        Exclude<R, RuntimeStorage>
      >,
  };

  return service;
};

/**
 * Layer that provides {@link RuntimeStorage} backed by an injected Prisma client.
 *
 * @public
 */
export const layer = (config: {
  readonly client: PrismaRuntimeStorageClient;
}): Layer.Layer<RuntimeStorage> =>
  Layer.succeed(RuntimeStorage, make(config.client));

/**
 * Layer that consumes {@link PrismaClientService} and provides
 * {@link RuntimeStorage}.
 *
 * @public
 */
export const layerFromContext: Layer.Layer<
  RuntimeStorage,
  never,
  PrismaClientService
> = Layer.effect(
  RuntimeStorage,
  Effect.map(PrismaClientService, make),
);

/**
 * Combined built-in ProcessStore facets backed by Prisma RuntimeStorage.
 *
 * @public
 */
export const layerProcessStore = (config: {
  readonly client: PrismaRuntimeStorageClient;
}): Layer.Layer<
  | LogStore
  | QueueResourceStore
  | RunResourceStore
  | ProcessExecutionStore
  | ProcessLifecycleStore
  | ProcessGroupStore
> =>
  Layer.provide(ProcessStorage.layerRuntimeStorage, layer(config));

export const PrismaRuntimeStorage = {
  make,
  layer,
  layerFromContext,
  layerProcessStore,
  prismaClientLayer,
  PrismaClientService,
} satisfies {
  readonly make: typeof make;
  readonly layer: typeof layer;
  readonly layerFromContext: typeof layerFromContext;
  readonly layerProcessStore: typeof layerProcessStore;
  readonly prismaClientLayer: typeof prismaClientLayer;
  readonly PrismaClientService: typeof PrismaClientService;
};
