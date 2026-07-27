/**
 * @module examples/forms/hyperlink/gate-rate-limit-fleet
 *
 * Fleet rate limiting — two Gate scopes share one {@link RateLimiterStore}
 * (memory stand-in for Redis). Same `rateLimit.key` → one budget across
 * "nodes". Compose `RateLimiter.layerStoreRedis` at the app root for a real
 * multi-process fleet.
 *
 * ```bash
 * pnpm exec tsx examples/forms/hyperlink/gate-rate-limit-fleet.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Duration, Effect, Layer, Ref } from "effect";
import {
  layerStoreMemory as rateLimiterStoreMemory,
} from "effect/unstable/persistence/RateLimiter";
import * as Gate from "../../../src/Gate";
import * as Store from "../../../src/Store";

const rateLimit = {
  key: "demo/egress",
  limit: 2,
  window: Duration.seconds(1),
  onExceeded: "delay" as const,
};

const program = Effect.gen(function* () {
  const starts = yield* Ref.make(0);
  const tick = (_: void) =>
    Ref.updateAndGet(starts, (n) => n + 1).pipe(
      Effect.tap((n) => Effect.log(`start #${n}`)),
    );

  // Two scopes ≈ two Nodes. Ambient store ≈ Redis at the fleet root.
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
  yield* Effect.log(
    `done: starts=${yield* Ref.get(starts)} elapsedMs≈${elapsed} (expect ≥1000 with shared store)`,
  );
}).pipe(
  Effect.provide(
    Layer.mergeAll(Store.layerDefaultMemory, rateLimiterStoreMemory),
  ),
  Effect.scoped,
);

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
