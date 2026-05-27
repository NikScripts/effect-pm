/**
 * Prisma-backed RuntimeStorage adapter.
 *
 * @remarks
 * The adapter stores normalized `RuntimeRecord` rows through a structural
 * Prisma client. Consumers own Prisma generation, migrations, connection
 * lifetime, and shutdown; this module never imports `@prisma/client` and never
 * calls `$disconnect`.
 *
 * @module PrismaRuntimeStorage
 */

import { Context, Data, DateTime, Effect, Layer, Option, Schema } from "effect";
import type {
  RuntimeRecordField,
  RuntimeRecordOrderField,
  RuntimeRecordPredicate,
  RuntimeRecordQuery,
} from "../Query";
import { ProcessStorage } from "../ProcessStorage";
import { RuntimeStorage } from "../RuntimeStorage";
import {
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
  applyRuntimeRecordPatch,
  type DeleteResult,
  type RuntimeRecord,
  type RuntimeStorageService,
  type UpdateResult,
} from "../RuntimeStorage";
import type { ProcessStoreLog } from "../store/log";
import type { ProcessStoreProcessExecution } from "../store/processExecution";
import type { ProcessStoreProcessGroup } from "../store/processGroup";
import type { ProcessStoreProcessLifecycle } from "../store/processLifecycle";
import type { ProcessStoreQueueResource } from "../store/queueResource";
import type { ProcessStoreRunResource } from "../store/runResource";
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
        ? {}
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

interface PrismaTransactionRunner {
  readonly $transaction: (
    operations: ReadonlyArray<Promise<EffectPmRuntimeRecordRow>>,
  ) => PromiseLike<ReadonlyArray<EffectPmRuntimeRecordRow>>;
}

const transactionRunner = (
  value: object,
): PrismaTransactionRunner | undefined => {
  if (!("$transaction" in value)) {
    return undefined;
  }
  const transaction = Reflect.get(value, "$transaction");
  if (typeof transaction !== "function") {
    return undefined;
  }
  return {
    $transaction: (operations) =>
      Promise.resolve(transaction.call(value, operations)),
  };
};

const runWriteBatch = (
  client: PrismaRuntimeStorageClient,
  operations: ReadonlyArray<() => Promise<EffectPmRuntimeRecordRow>>,
): Effect.Effect<void> => {
  if (operations.length === 0) {
    return Effect.void;
  }
  const transaction = transactionRunner(client);
  return prismaPromise(() =>
    transaction !== undefined
      ? Promise.resolve(transaction.$transaction(operations.map((operation) => operation())))
          .then(() => undefined)
      : operations.reduce<Promise<void>>(
          (previous, operation) => previous.then(() => operation()).then(() => undefined),
          Promise.resolve(),
        )
  ).pipe(Effect.orDie);
};

/**
 * Construct a Prisma-backed {@link RuntimeStorageService}.
 *
 * @public
 */
export const make = (
  client: PrismaRuntimeStorageClient,
): RuntimeStorageService => ({
  create: (record) =>
    prismaPromise(() =>
      client.effectPmRuntimeRecord.create({ data: encodeCreateInput(record) })
    ).pipe(
      Effect.asVoid,
      Effect.catch((error: PrismaRuntimeStorageDriverError) =>
        isUniqueConstraintError(error.cause)
          ? Effect.fail(new RuntimeStorageDuplicateRecordError({ id: record.id }))
          : Effect.die(error.cause)
      ),
    ),

  read: (query) =>
    prismaPromise(() =>
      client.effectPmRuntimeRecord.findMany(findManyArgs(query))
    ).pipe(
      Effect.map((rows) => rows.map(decodeRow)),
      Effect.orDie,
    ),

  upsert: (record) =>
    Effect.gen(function* () {
      const existing = yield* prismaPromise(() =>
        client.effectPmRuntimeRecord.findMany({
          where: { id: { equals: record.id } },
          take: 1,
        })
      ).pipe(Effect.orDie);
      const first = existing[0];
      if (first?.readonly === true) {
        return yield* new RuntimeStorageReadonlyRecordError({ id: record.id });
      }
      yield* prismaPromise(() =>
        client.effectPmRuntimeRecord.upsert({
          where: { id: record.id },
          create: encodeCreateInput(record),
          update: encodeUpdateInput(record),
        })
      ).pipe(Effect.orDie);
    }),

  update: (query, patch) =>
    Effect.gen(function* () {
      const matching = yield* make(client).read(query);
      let matched = 0;
      let updated = 0;
      const operations: Array<() => Promise<EffectPmRuntimeRecordRow>> = [];
      for (const record of matching) {
        matched++;
        if (record.readonly === true) {
          continue;
        }
        const next = applyRuntimeRecordPatch(record, patch);
        operations.push(() =>
          client.effectPmRuntimeRecord.update({
            where: { id: record.id },
            data: encodeUpdateInput(next),
          })
        );
        updated++;
      }
      yield* runWriteBatch(client, operations);
      return { matched, updated } satisfies UpdateResult;
    }),

  delete: (query) =>
    Effect.gen(function* () {
      const matching = yield* make(client).read(query);
      const includeReadonly = includesReadonlyTrue(query.predicate);
      let deleted = 0;
      const operations: Array<() => Promise<EffectPmRuntimeRecordRow>> = [];
      for (const record of matching) {
        if (record.readonly === true && !includeReadonly) {
          continue;
        }
        operations.push(() =>
          client.effectPmRuntimeRecord.delete({ where: { id: record.id } })
        );
        deleted++;
      }
      yield* runWriteBatch(client, operations);
      return { deleted } satisfies DeleteResult;
    }),
});

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
  | ProcessStoreLog
  | ProcessStoreQueueResource
  | ProcessStoreRunResource
  | ProcessStoreProcessExecution
  | ProcessStoreProcessLifecycle
  | ProcessStoreProcessGroup
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
