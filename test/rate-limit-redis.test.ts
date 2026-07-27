/**
 * Live Redis fleet rate-limit proof — Gate + WorkPool share one Redis
 * `RateLimiterStore`, including a real child-process peer.
 *
 * Skipped when Redis is unreachable (`REDIS_URL` or localhost:6379).
 */
import * as NodeRedis from "@effect/platform-node/NodeRedis";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  Data,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Stream,
} from "effect";
import {
  RateLimiterError,
  RateLimiterStore,
} from "effect/unstable/persistence/RateLimiter";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess } from "effect/unstable/process";
import * as Gate from "../src/Gate";
import * as Store from "../src/Store";
import * as WorkPool from "../src/WorkPool";
import {
  nodeRedisLayer,
  rateLimiterRedisLayer,
  redisAvailable,
  redisEndpoint,
  uniqueRedisId,
} from "./fixtures/redis";

class RedisPeerFailed extends Data.TaggedError("RedisPeerFailed")<{
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  override get message(): string {
    return `redis peer failed (status=${String(this.status)}):\n${this.stdout}\n${this.stderr}`;
  }
}

/** Relative to package root (vitest cwd). */
const peerScript = "test/fixtures/redisRateLimitPeer.ts";

const runPeerConsume = (
  prefix: string,
  key: string,
): Effect.Effect<void, PlatformError | RedisPeerFailed> =>
  Effect.gen(function* () {
    const args = [
      "exec",
      "tsx",
      peerScript,
      `--prefix=${prefix}`,
      `--key=${key}`,
      `--host=${redisEndpoint.host}`,
      `--port=${String(redisEndpoint.port)}`,
    ];
    if (redisEndpoint.db !== undefined) {
      args.push(`--db=${String(redisEndpoint.db)}`);
    }
    const handle = yield* ChildProcess.make("pnpm", args);
    const { code, stderr, stdout } = yield* Effect.all(
      {
        code: handle.exitCode,
        stdout: Stream.mkString(Stream.decodeText(handle.stdout)),
        stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
      },
      { concurrency: "unbounded" },
    );
    if (Number(code) !== 0) {
      return yield* new RedisPeerFailed({
        status: Number(code),
        stdout,
        stderr,
      });
    }
  }).pipe(
    Effect.asVoid,
    Effect.provide(NodeServices.layer),
    Effect.scoped,
  );

describe.skipIf(!redisAvailable)("Gate fleet rateLimit (live Redis)", () => {
  it.live(
    "shared Redis RateLimiterStore enforces one budget across two gate scopes",
    () =>
      Effect.gen(function* () {
        const storePrefix = yield* uniqueRedisId("gate-fleet-store");
        const key = yield* uniqueRedisId("gate-fleet-key");
        const starts = yield* Ref.make(0);
        const rateLimit = {
          key,
          limit: 1,
          window: Duration.minutes(5),
          onExceeded: "fail" as const,
        };

        yield* Effect.gen(function* () {
          const east = yield* Gate.make({
            name: "@test/redis-east",
            concurrency: 10,
            rateLimit,
            effect: (_: void) => Ref.update(starts, (n) => n + 1),
          });
          const west = yield* Gate.make({
            name: "@test/redis-west",
            concurrency: 10,
            rateLimit,
            effect: (_: void) => Ref.update(starts, (n) => n + 1),
          });

          expect((yield* Effect.serviceOption(RateLimiterStore))._tag).toBe(
            "Some",
          );

          yield* east.run();
          expect(yield* Ref.get(starts)).toBe(1);

          const exit = yield* Effect.exit(west.run());
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
            expect(err).toBeInstanceOf(RateLimiterError);
          }
          expect(yield* Ref.get(starts)).toBe(1);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Store.layerDefaultMemory,
              rateLimiterRedisLayer(storePrefix),
            ),
          ),
          Effect.scoped,
        );
      }),
  );

  it.live("child process consume counts against the same Redis budget", () =>
    Effect.gen(function* () {
      const storePrefix = yield* uniqueRedisId("gate-mp-store");
      const key = yield* uniqueRedisId("gate-mp-key");
      yield* runPeerConsume(storePrefix, key);

      const starts = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const gate = yield* Gate.make({
          name: "@test/redis-multiprocess",
          concurrency: 4,
          rateLimit: {
            key,
            limit: 1,
            window: Duration.minutes(5),
            onExceeded: "fail",
          },
          effect: (_: void) => Ref.update(starts, (n) => n + 1),
        });

        const exit = yield* Effect.exit(gate.run());
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(RateLimiterError);
        }
        expect(yield* Ref.get(starts)).toBe(0);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Store.layerDefaultMemory,
            rateLimiterRedisLayer(storePrefix),
          ),
        ),
        Effect.scoped,
      );
    }),
  );
});

describe.skipIf(!redisAvailable)("WorkPool fleet rateLimit (live Redis)", () => {
  it.live(
    "shared Redis RateLimiterStore enforces one budget across two queues",
    () =>
      Effect.gen(function* () {
        const storePrefix = yield* uniqueRedisId("queue-fleet-store");
        const key = yield* uniqueRedisId("queue-fleet-key");
        const starts = yield* Ref.make(0);
        const rateLimit = {
          key,
          limit: 1,
          window: Duration.minutes(5),
          onExceeded: "fail" as const,
        };

        yield* Effect.gen(function* () {
          const east = yield* WorkPool.make({
            name: "@test/redis-queue-east",
            concurrency: 4,
            rateLimit,
            effect: () => Ref.update(starts, (n) => n + 1),
          });
          const west = yield* WorkPool.make({
            name: "@test/redis-queue-west",
            concurrency: 4,
            rateLimit,
            effect: () => Ref.update(starts, (n) => n + 1),
          });

          yield* east.add(1);
          for (let i = 0; i < 50; i++) {
            if ((yield* Ref.get(starts)) === 1) break;
            yield* Effect.sleep(Duration.millis(20));
          }
          expect(yield* Ref.get(starts)).toBe(1);

          yield* west.add(1);
          yield* Effect.sleep(Duration.millis(150));
          expect(yield* Ref.get(starts)).toBe(1);
        }).pipe(
          Effect.provide(rateLimiterRedisLayer(storePrefix)),
          Effect.scoped,
        );
      }),
  );
});

describe.skipIf(!redisAvailable)("NodeRedis layer", () => {
  it.live("NodeRedis.use can PING", () =>
    Effect.gen(function* () {
      const redis = yield* NodeRedis.NodeRedis;
      const pong = yield* redis.use((client) => client.ping());
      expect(pong).toBe("PONG");
    }).pipe(Effect.provide(nodeRedisLayer), Effect.scoped),
  );
});
