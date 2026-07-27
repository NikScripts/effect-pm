/**
 * Child-process peer for multi-process RateLimiter Redis proof.
 *
 * Consumes one token from a Redis-backed RateLimiterStore, then exits 0 on
 * success or 1 on failure. Invoked by `test/rate-limit-redis.test.ts`.
 *
 * Args: `--prefix=<prefix> --key=<key> [--host=] [--port=] [--db=]`
 */
import * as NodeRedis from "@effect/platform-node/NodeRedis";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Duration, Effect, Layer } from "effect";
import {
  RateLimiter,
  layer as rateLimiterLayer,
  layerStoreRedis as rateLimiterStoreRedis,
} from "effect/unstable/persistence/RateLimiter";

const arg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
};

const required = (name: string): string => {
  const value = arg(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`missing --${name}=`);
  }
  return value;
};

const prefix = required("prefix");
const key = required("key");
const host = arg("host") ?? "127.0.0.1";
const port = Number(arg("port") ?? "6379");
const dbRaw = arg("db");
const db = dbRaw !== undefined && dbRaw.length > 0 ? Number(dbRaw) : undefined;

const redis = NodeRedis.layer({ host, port, db });
const store = Layer.provide(rateLimiterStoreRedis({ prefix }), redis);
const live = Layer.provide(rateLimiterLayer, store);

const program = Effect.gen(function* () {
  const limiter = yield* RateLimiter;
  yield* limiter.consume({
    key,
    limit: 1,
    window: Duration.minutes(5),
    onExceeded: "fail",
  });
}).pipe(Effect.provide(live), Effect.scoped);

NodeRuntime.runMain(program);
