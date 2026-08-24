/**
 * Live Redis helpers for fleet / Effect Redis store tests.
 *
 * Availability is probed once at import (localhost or `REDIS_URL`). Suites use
 * `describe.skipIf(!redisAvailable)` so CI without Redis stays green.
 */
import * as NodeRedis from "@effect/platform-node/NodeRedis";
import { Clock, Config, Effect, Layer, Random } from "effect";
import {
  layerStoreRedis as rateLimiterStoreRedis,
} from "effect/unstable/persistence/RateLimiter";

export type RedisEndpoint = {
  readonly host: string;
  readonly port: number;
  readonly db?: number | undefined;
  readonly password?: string | undefined;
};

const DEFAULT_URL = "redis://127.0.0.1:6379";

const parseRedisUrl = (raw: string): RedisEndpoint => {
  const url = new URL(raw);
  const dbPath = url.pathname.replace(/^\//, "");
  const db = dbPath.length > 0 ? Number(dbPath) : undefined;
  return {
    host: url.hostname.length > 0 ? url.hostname : "127.0.0.1",
    port: url.port.length > 0 ? Number(url.port) : 6379,
    db: db !== undefined && Number.isFinite(db) ? db : undefined,
    password: url.password.length > 0 ? decodeURIComponent(url.password) : undefined,
  };
};

/** Parse `REDIS_URL` (`redis://[:password@]host:port[/db]`) or fall back to localhost. */
export const redisEndpoint: RedisEndpoint = parseRedisUrl(
  Effect.runSync(
    Config.string("REDIS_URL").pipe(Config.withDefault(DEFAULT_URL)),
  ),
);

/** Node `Redis` + `NodeRedis` services for the probed endpoint. */
export const nodeRedisLayer = NodeRedis.layer({
  host: redisEndpoint.host,
  port: redisEndpoint.port,
  db: redisEndpoint.db,
  password: redisEndpoint.password,
});

const probeRedis = Effect.gen(function* () {
  const redis = yield* NodeRedis.NodeRedis;
  const pong = yield* redis.use((client) => client.ping());
  return pong === "PONG";
}).pipe(
  Effect.provide(nodeRedisLayer),
  Effect.scoped,
  Effect.orElseSucceed(() => false),
);

/** `true` when a Redis server answered PING (skip live suites otherwise). */
export const redisAvailable: boolean = await Effect.runPromise(probeRedis);

/** Fleet `RateLimiterStore` over Redis (unique prefix per suite recommended). */
export const rateLimiterRedisLayer = (prefix: string) =>
  Layer.provide(rateLimiterStoreRedis({ prefix }), nodeRedisLayer);

/** Unique Redis key/prefix fragment for test isolation. */
export const uniqueRedisId = (label: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const n = yield* Random.nextIntBetween(1_000_000, 9_999_999);
    return `hl:${label}:${now.toString(36)}:${n.toString(36)}`;
  });
