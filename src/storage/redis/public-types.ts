/**
 * Configuration for Redis-backed {@link RuntimeStorage}.
 *
 * @module storage/redis/public-types
 * @public
 */

import type { RuntimeStorageRedisSend } from "./send";

/**
 * Options for {@link RedisRuntimeStorage.layer} and related factories.
 *
 * @public
 */
export interface RedisRuntimeStorageConfig {
  /**
   * Key prefix for all runtime record keys (default `effect-pm`).
   * Use a distinct namespace per deployment or tenant.
   */
  readonly namespace?: string;
  /**
   * Low-level Redis command transport. Apps wire `ioredis`, `@effect/platform`
   * Redis, or a test double; the adapter only depends on this `send` shape.
   */
  readonly send: RuntimeStorageRedisSend;
}
