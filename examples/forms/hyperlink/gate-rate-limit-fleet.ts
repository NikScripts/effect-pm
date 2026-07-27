/**
 * @module examples/forms/hyperlink/gate-rate-limit-fleet
 *
 * Fleet rate limiting — two Gate scopes share one {@link RateLimiterStore}.
 * Uses Redis when `REDIS_URL` / localhost:6379 answers PING; otherwise falls
 * back to in-memory (same-process stand-in only).
 *
 * ```bash
 * # memory stand-in
 * pnpm exec tsx examples/forms/hyperlink/gate-rate-limit-fleet.ts
 *
 * # real Redis (compose or local redis-server)
 * docker compose -f docker-compose.redis.yml up -d
 * REDIS_URL=redis://127.0.0.1:6379 pnpm exec tsx examples/forms/hyperlink/gate-rate-limit-fleet.ts
 * ```
 */
import * as NodeRedis from "@effect/platform-node/NodeRedis";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Duration, Effect, Layer, Ref } from "effect";
import {
  layerStoreMemory as rateLimiterStoreMemory,
  layerStoreRedis as rateLimiterStoreRedis,
} from "effect/unstable/persistence/RateLimiter";
import * as Gate from "../../../src/Gate";
import * as Store from "../../../src/Store";

const rateLimit = {
  key: "demo/egress",
  limit: 2,
  window: Duration.seconds(1),
  onExceeded: "delay" as const,
};

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

const redisEndpointFromUrl = (raw: string) => {
  const url = new URL(raw);
  return {
    host: url.hostname.length > 0 ? url.hostname : "127.0.0.1",
    port: url.port.length > 0 ? Number(url.port) : 6379,
  } as const;
};

const rateLimiterStoreLayer = (
  useRedis: boolean,
  endpoint: { readonly host: string; readonly port: number },
) =>
  useRedis
    ? Layer.provide(
        rateLimiterStoreRedis({ prefix: "hyperlink-demo:" }),
        NodeRedis.layer(endpoint),
      )
    : rateLimiterStoreMemory;

const program = (
  useRedis: boolean,
  endpoint: { readonly host: string; readonly port: number },
) =>
  Effect.gen(function* () {
    const starts = yield* Ref.make(0);
    const tick = (_: void) =>
      Ref.updateAndGet(starts, (n) => n + 1).pipe(
        Effect.tap((n) => Effect.log(`start #${n}`)),
      );

    yield* Effect.log(
      useRedis
        ? "store=Redis (true multi-process fleet budget)"
        : "store=memory (same-process stand-in — start Redis for fleet proof)",
    );

    // Two scopes ≈ two Nodes. Ambient store = fleet root.
    const east = yield* Gate.make({
      name: "demo/east",
      concurrency: 4,
      rateLimit,
      effect: tick,
    });
    const west = yield* Gate.make({
      name: "demo/west",
      concurrency: 4,
      rateLimit,
      effect: tick,
    });

    yield* Effect.log("firing 4 runs across east+west (limit 2 / second)…");
    const t0 = yield* Effect.clockWith((c) => c.currentTimeMillis);
    yield* Effect.all(
      [east.run(), west.run(), east.run(), west.run()],
      { concurrency: "unbounded" },
    );
    const elapsed = (yield* Effect.clockWith((c) => c.currentTimeMillis)) - t0;
    // Note: Gate.make is run-only — metrics nest lives on Tag/Service handles.
    yield* Effect.log(
      `done: starts=${yield* Ref.get(starts)} elapsedMs≈${elapsed} (expect ≥1000 with shared store)`,
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Store.layerDefaultMemory,
        rateLimiterStoreLayer(useRedis, endpoint),
      ),
    ),
    Effect.scoped,
  );

const main = Effect.gen(function* () {
  const rawUrl = yield* Config.string("REDIS_URL").pipe(
    Config.withDefault(DEFAULT_REDIS_URL),
  );
  const endpoint = redisEndpointFromUrl(rawUrl);
  const useRedis = yield* Effect.gen(function* () {
    const redis = yield* NodeRedis.NodeRedis;
    const pong = yield* redis.use((client) => client.ping());
    return pong === "PONG";
  }).pipe(
    Effect.provide(NodeRedis.layer(endpoint)),
    Effect.scoped,
    Effect.orElseSucceed(() => false),
  );
  yield* program(useRedis, endpoint);
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(main);
