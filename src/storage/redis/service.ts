/**
 * Redis-backed {@link RuntimeStorageService} for normalized runtime records.
 *
 * @module storage/redis/service
 * @internal
 */

import { Effect, Exit } from "effect";
import type { RuntimeRecordPredicate } from "../../Query";
import {
  RuntimeStorage,
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageQueryError,
  RuntimeStorageReadonlyRecordError,
  RuntimeStorageTransactionError,
  applyRuntimeRecordPatch,
  makeInMemoryRuntimeStorageService,
  selectRuntimeRecords,
  type DeleteResult,
  type RuntimeRecord,
  type RuntimeStorageService,
  type UpdateResult,
} from "../../RuntimeStorage";
import {
  decodeRuntimeRecordJson,
  encodeRuntimeRecordJson,
  parseExists,
  parseOptionalStringReply,
  parseSetNxOk,
  parseSmemberIds,
} from "./codec";
import type { RuntimeStorageRedisSend } from "./send";

const DEFAULT_NAMESPACE = "effect-pm";

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

const idsKey = (namespace: string): string => `${namespace}:runtime:ids`;

const recordKey = (namespace: string, id: string): string => `${namespace}:runtime:record:${id}`;

const redisQueryError = (
  operation: "create" | "read" | "upsert" | "update" | "delete" | "transaction",
  cause: unknown,
  detail?: string,
): RuntimeStorageQueryError =>
  new RuntimeStorageQueryError({
    adapter: "redis",
    operation,
    cause,
    detail,
  });

const loadAllRecords = (
  send: RuntimeStorageRedisSend,
  namespace: string,
): Effect.Effect<Map<string, RuntimeRecord>, RuntimeStorageQueryError> =>
  Effect.gen(function* () {
    const idsReply = yield* send.send("SMEMBERS", idsKey(namespace)).pipe(
      Effect.mapError((error) => redisQueryError("read", error)),
    );
    const ids = parseSmemberIds(idsReply);
    const records = new Map<string, RuntimeRecord>();
    for (const id of ids) {
      const textReply = yield* send.send("GET", recordKey(namespace, id)).pipe(
        Effect.mapError((error) => redisQueryError("read", error)),
      );
      const text = parseOptionalStringReply(textReply);
      if (text === undefined) {
        continue;
      }
      const record = yield* decodeRuntimeRecordJson(text, id).pipe(
        Effect.mapError((error) => redisQueryError("read", error, error.detail)),
      );
      records.set(record.id, record);
    }
    return records;
  });

const writeRecord = (
  send: RuntimeStorageRedisSend,
  namespace: string,
  record: RuntimeRecord,
  operation: "create" | "upsert" | "update",
): Effect.Effect<void, RuntimeStorageQueryError> =>
  Effect.gen(function* () {
    const json = yield* encodeRuntimeRecordJson(record).pipe(
      Effect.mapError((error) => redisQueryError(operation, error, error.detail)),
    );
    yield* send.send("SET", recordKey(namespace, record.id), json).pipe(
      Effect.mapError((error) => redisQueryError(operation, error)),
    );
    yield* send.send("SADD", idsKey(namespace), record.id).pipe(
      Effect.mapError((error) => redisQueryError(operation, error)),
    );
  });

const deleteRecord = (
  send: RuntimeStorageRedisSend,
  namespace: string,
  id: string,
): Effect.Effect<void, RuntimeStorageQueryError> =>
  Effect.gen(function* () {
    yield* send.send("DEL", recordKey(namespace, id)).pipe(
      Effect.mapError((error) => redisQueryError("delete", error)),
    );
    yield* send.send("SREM", idsKey(namespace), id).pipe(
      Effect.mapError((error) => redisQueryError("delete", error)),
    );
  });

const commitRecords = (
  send: RuntimeStorageRedisSend,
  namespace: string,
  before: ReadonlyMap<string, RuntimeRecord>,
  after: ReadonlyMap<string, RuntimeRecord>,
): Effect.Effect<void, RuntimeStorageQueryError> =>
  Effect.gen(function* () {
    for (const id of before.keys()) {
      if (!after.has(id)) {
        yield* deleteRecord(send, namespace, id);
      }
    }
    for (const record of after.values()) {
      yield* writeRecord(send, namespace, record, "upsert");
    }
  });

/**
 * Build a {@link RuntimeStorageService} backed by Redis string keys and a set index.
 *
 * @remarks
 * Reads load the id index and decode JSON blobs, then apply the same
 * {@link selectRuntimeRecords} semantics as memory and SQLite. Suitable for
 * moderate volumes; hot paths will move to Redis-native indexes in hybrid work.
 */
export const makeRedisRuntimeStorageService = (
  send: RuntimeStorageRedisSend,
  namespace: string = DEFAULT_NAMESPACE,
): RuntimeStorageService => ({
  create: (record) =>
    Effect.gen(function* () {
      const existsReply = yield* send.send("EXISTS", recordKey(namespace, record.id)).pipe(
        Effect.mapError((error) => redisQueryError("create", error)),
      );
      if (parseExists(existsReply)) {
        return yield* Effect.fail(new RuntimeStorageDuplicateRecordError({ id: record.id }));
      }
      const json = yield* encodeRuntimeRecordJson(record).pipe(
        Effect.mapError((error) => redisQueryError("create", error, error.detail)),
      );
      const setReply = yield* send.send("SET", recordKey(namespace, record.id), json, "NX").pipe(
        Effect.mapError((error) => redisQueryError("create", error)),
      );
      if (!parseSetNxOk(setReply)) {
        return yield* Effect.fail(new RuntimeStorageDuplicateRecordError({ id: record.id }));
      }
      yield* send.send("SADD", idsKey(namespace), record.id).pipe(
        Effect.mapError((error) => redisQueryError("create", error)),
      );
    }),

  read: (query) =>
    loadAllRecords(send, namespace).pipe(
      Effect.map((records) => selectRuntimeRecords([...records.values()], query)),
    ),

  upsert: (record) =>
    Effect.gen(function* () {
      const existing = yield* send.send("GET", recordKey(namespace, record.id)).pipe(
        Effect.mapError((error) => redisQueryError("upsert", error)),
      );
      const text = parseOptionalStringReply(existing);
      if (text !== undefined) {
        const decoded = yield* decodeRuntimeRecordJson(text, record.id).pipe(
          Effect.mapError((error) => redisQueryError("upsert", error, error.detail)),
        );
        if (decoded.readonly === true) {
          return yield* Effect.fail(new RuntimeStorageReadonlyRecordError({ id: record.id }));
        }
      }
      yield* writeRecord(send, namespace, record, "upsert");
    }),

  update: (query, patch) =>
    Effect.gen(function* () {
      const records = yield* loadAllRecords(send, namespace);
      const matching = selectRuntimeRecords([...records.values()], query);
      let matched = 0;
      let updated = 0;
      for (const row of matching) {
        matched++;
        if (row.readonly === true) {
          continue;
        }
        const next = applyRuntimeRecordPatch(row, patch);
        yield* writeRecord(send, namespace, next, "update");
        updated++;
      }
      return { matched, updated } satisfies UpdateResult;
    }),

  delete: (query) =>
    Effect.gen(function* () {
      const records = yield* loadAllRecords(send, namespace);
      const includeReadonly = includesReadonlyTrue(query.predicate);
      const matching = selectRuntimeRecords([...records.values()], query);
      let deleted = 0;
      for (const row of matching) {
        if (row.readonly === true && !includeReadonly) {
          continue;
        }
        yield* deleteRecord(send, namespace, row.id);
        deleted++;
      }
      return { deleted } satisfies DeleteResult;
    }),

  transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R | RuntimeStorage>,
  ): Effect.Effect<
    A,
    E | RuntimeStorageTransactionError | RuntimeStorageDuplicateRecordError | RuntimeStorageReadonlyRecordError,
    Exclude<R, RuntimeStorage>
  > =>
    Effect.gen(function* () {
      const before = yield* loadAllRecords(send, namespace).pipe(
        Effect.mapError((error) =>
          new RuntimeStorageTransactionError({
            adapter: "redis",
            operation: "transaction",
            cause: error,
            detail: error.detail,
          }),
        ),
      );
      const tx = new Map(before);
      const txService = makeInMemoryRuntimeStorageService(tx);
      const exit = yield* effect.pipe(
        Effect.provideService(RuntimeStorage, txService),
        Effect.exit,
      );
      return yield* Exit.match(exit, {
        onFailure: Effect.failCause,
        onSuccess: (value: A) =>
          commitRecords(send, namespace, before, tx).pipe(
            Effect.mapError((error) =>
              new RuntimeStorageTransactionError({
                adapter: "redis",
                operation: "transaction",
                cause: error,
                detail: error.detail,
              }),
            ),
            Effect.as(value),
          ),
      });
    }) as Effect.Effect<
      A,
      E | RuntimeStorageTransactionError | RuntimeStorageDuplicateRecordError | RuntimeStorageReadonlyRecordError,
      Exclude<R, RuntimeStorage>
    >,
});
