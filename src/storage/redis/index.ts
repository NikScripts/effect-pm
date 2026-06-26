/**
 * Redis-backed {@link RuntimeStorageService} for normalized runtime records.
 *
 * @packageDocumentation
 *
 * ## Import path
 *
 * ```ts
 * import { RedisRuntimeStorage } from "@nikscripts/effect-pm/storage/redis";
 * ```
 *
 * ## Semantics contract
 *
 * Matches {@link RuntimeStorage.memory} and SQLite: same query predicates,
 * ordering, readonly rules, and {@link RuntimeStorageService.transaction}
 * commit/rollback behavior. Implementation loads the id index and record JSON
 * blobs, then delegates filtering to {@link selectRuntimeRecords}.
 *
 * ## Wiring Redis
 *
 * Provide a {@link RuntimeStorageRedisSend} — typically your client's
 * `send(command, ...args)` — plus an optional key `namespace` prefix.
 * Use {@link makeInMemoryRedisSend} in tests without a Redis server.
 *
 * @module storage/redis
 */

import { Effect, Layer } from "effect";
import { ProcessStorage } from "../../ProcessStorage";
import type { LogStore } from "../../store/log";
import type { ProcessExecutionStore } from "../../store/processExecution";
import type { ProcessLifecycleStore } from "../../store/processLifecycle";
import type { QueueResourceStore } from "../../store/queueResource";
import type { RunResourceStore } from "../../store/runResource";
import { RuntimeStorage } from "../../RuntimeStorage";
import type { RuntimeStorageService } from "../../RuntimeStorage";
import type { RedisRuntimeStorageConfig } from "./public-types";
import { makeRedisRuntimeStorageService } from "./service";

export type { RedisRuntimeStorageConfig } from "./public-types";
export type { RuntimeStorageRedisSend } from "./send";
export { makeInMemoryRedisSend } from "./send";

const resolveNamespace = (config: RedisRuntimeStorageConfig): string =>
  config.namespace ?? "effect-pm";

/**
 * Build a Redis-backed {@link RuntimeStorageService} from config.
 *
 * @public
 */
export const makeRuntimeStorage = (
  config: RedisRuntimeStorageConfig,
): Effect.Effect<RuntimeStorageService, never, never> =>
  Effect.sync(() => makeRedisRuntimeStorageService(config.send, resolveNamespace(config)));

/**
 * `Layer` providing {@link RuntimeStorage} backed by Redis.
 *
 * @public
 */
export const layerRuntimeStorage = (
  config: RedisRuntimeStorageConfig,
): Layer.Layer<RuntimeStorage> =>
  Layer.effect(
    RuntimeStorage,
    makeRuntimeStorage(config),
  );

/**
 * `ProcessStorage` facet layers backed by Redis {@link RuntimeStorage}.
 *
 * @public
 */
export const layerProcessStore = (
  config: RedisRuntimeStorageConfig,
): Layer.Layer<
  | LogStore
  | QueueResourceStore
  | RunResourceStore
  | ProcessExecutionStore
  | ProcessLifecycleStore
> =>
  Layer.provide(ProcessStorage.layerRuntimeStorage, layerRuntimeStorage(config));

/**
 * Same as {@link layerProcessStore} with acquisition errors as defects.
 *
 * @public
 */
export const layerProcessStoreOrDie = (
  config: RedisRuntimeStorageConfig,
): Layer.Layer<
  | LogStore
  | QueueResourceStore
  | RunResourceStore
  | ProcessExecutionStore
  | ProcessLifecycleStore
> =>
  layerProcessStore(config);

export const RedisRuntimeStorage = {
  make: makeRuntimeStorage,
  layer: layerRuntimeStorage,
  layerProcessStore,
  layerProcessStoreOrDie,
} as const;
