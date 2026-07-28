/**
 * Live proof for Effect Redis-backed stores apps compose alongside Hyperlink:
 * `Persistence.layerRedis` and `PersistedQueue.layerStoreRedis`.
 *
 * Hyperlink's own DurableWorkPoolStore remains SQLite-only — these suites cover
 * the Effect layers fleet apps may share with RateLimiter Redis.
 *
 * Skipped when Redis is unreachable (`REDIS_URL` or localhost:6379).
 */
import * as NodeRedis from "@effect/platform-node/NodeRedis";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Schema } from "effect";
import {
  Persistable,
  Persistence,
  PersistedQueue,
} from "effect/unstable/persistence";
import {
  nodeRedisLayer,
  redisAvailable,
  uniqueRedisId,
} from "./fixtures/redis";

class RedisUser extends Schema.Class<RedisUser>("RedisUser")({
  id: Schema.Number,
  name: Schema.String,
}) {}

class RedisUserRequest extends Persistable.Class<{
  payload: { id: number };
}>()("RedisUserRequest", {
  primaryKey: (req) => `RedisUserRequest:${req.id}`,
  success: RedisUser,
  error: Schema.String,
}) {}

const Item = Schema.Struct({ n: Schema.Number });

const FailedItem = Schema.Struct({
  id: Schema.String,
  element: Item,
  attempts: Schema.Number,
});

const FailedItemFromJson = Schema.fromJsonString(FailedItem);

describe.skipIf(!redisAvailable)("Persistence.layerRedis (live)", () => {
  it.live("set/get round-trips a Persistable Exit", () =>
    Effect.gen(function* () {
      const storeId = yield* uniqueRedisId("persistence");
      const persistence = yield* Persistence.Persistence;
      const store = yield* persistence.make({ storeId });
      const key = new RedisUserRequest({ id: 7 });
      const value = Exit.succeed(new RedisUser({ id: 7, name: "ada" }));

      yield* store.set(key, value);
      const got = yield* store.get(key);
      expect(got).toEqual(value);

      yield* store.remove(key);
      expect(yield* store.get(key)).toBeUndefined();
    }).pipe(
      Effect.provide(Layer.provide(Persistence.layerRedis, nodeRedisLayer)),
      Effect.scoped,
    ),
  );
});

describe.skipIf(!redisAvailable)("PersistedQueue.layerStoreRedis (live)", () => {
  it.live("offer/take round-trips an element", () =>
    Effect.gen(function* () {
      const name = yield* uniqueRedisId("persisted-queue");
      const prefix = `${yield* uniqueRedisId("pq")}:`;
      const storeLayer = Layer.provide(
        PersistedQueue.layerStoreRedis({
          prefix,
          pollInterval: "50 millis",
          lockRefreshInterval: "100 millis",
        }),
        nodeRedisLayer,
      );
      const live = PersistedQueue.layer.pipe(Layer.provideMerge(storeLayer));

      yield* Effect.gen(function* () {
        const queue = yield* PersistedQueue.make({ name, schema: Item });
        const id = yield* queue.offer({ n: 42 });
        let seen: { n: number } | undefined;
        yield* queue.take((element) =>
          Effect.sync(() => {
            seen = element;
          }),
        );
        expect(seen).toEqual({ n: 42 });
        expect(typeof id).toBe("string");
      }).pipe(Effect.provide(live), Effect.scoped);
    }),
  );

  it.live("exhausted elements land on the Redis failed list", () =>
    Effect.gen(function* () {
      const name = yield* uniqueRedisId("pq-failed");
      const prefix = `${yield* uniqueRedisId("pqf")}:`;
      const storeLayer = Layer.provide(
        PersistedQueue.layerStoreRedis({
          prefix,
          pollInterval: "50 millis",
          lockRefreshInterval: "100 millis",
        }),
        nodeRedisLayer,
      );
      const live = Layer.mergeAll(
        nodeRedisLayer,
        PersistedQueue.layer.pipe(Layer.provideMerge(storeLayer)),
      );

      yield* Effect.gen(function* () {
        const redis = yield* NodeRedis.NodeRedis;
        const queue = yield* PersistedQueue.make({ name, schema: Item });
        const id = yield* queue.offer({ n: 9 });
        const error = yield* queue
          .take(() => Effect.fail("boom"), { maxAttempts: 1 })
          .pipe(Effect.flip);
        expect(error).toBe("boom");

        const failed = yield* redis.use((client) =>
          client.lrange(`${prefix}${name}:failed`, 0, -1),
        );
        expect(failed.length).toBe(1);
        const failedItem = yield* Schema.decodeUnknownEffect(FailedItemFromJson)(
          failed[0]!,
        );
        expect(failedItem.id).toBe(id);
        expect(failedItem.element).toEqual({ n: 9 });
        expect(failedItem.attempts).toBe(1);
      }).pipe(Effect.provide(live), Effect.scoped);
    }),
  );
});
