/**
 * Composite {@link ProcessStore} materialization helpers.
 *
 * @module ProcessStoreComposite
 * @internal
 */

import { Clock, Effect, FileSystem, Path } from "effect";
import { makeProcessStoreGroupLog } from "./groupLog";
import { ProcessStoreGroupLog } from "./groupLog";
import { makeProcessStoreQueueResource } from "./queueResource";
import { ProcessStoreQueueResource } from "./queueResource";
import {
  assembleProcessStoreInterface,
  makeFileProcessStoreSpine,
  makeProcessStoreSpine,
  makeRunId,
} from "./spine";
import type { ProcessStoreInterface } from "../../ProcessStore";
import { RuntimeStorage } from "../../RuntimeStorage";

/** @internal */
export const makeFileProcessStore = (
  filePath: string,
): Effect.Effect<
  ProcessStoreInterface,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const spine = yield* makeFileProcessStoreSpine(filePath);
    const groupLog = makeProcessStoreGroupLog({
      append: spine.append,
      appendBatch: spine.appendBatch,
      events: spine.events,
    });
    const queue = makeProcessStoreQueueResource({
      append: spine.append,
      records: spine.records,
    });
    return assembleProcessStoreInterface(spine, groupLog, queue);
  });

/** @internal */
export const makeInMemoryProcessStore: Effect.Effect<
  ProcessStoreInterface,
  never,
  never
> = Effect.gen(function* () {
  const storage = yield* RuntimeStorage.memory;
  const now = yield* Clock.currentTimeMillis;
  const spine = makeProcessStoreSpine(storage, makeRunId(now));
  const groupLog = makeProcessStoreGroupLog({
    append: spine.append,
    appendBatch: spine.appendBatch,
    events: spine.events,
  });
  const queue = makeProcessStoreQueueResource({
    append: spine.append,
    records: spine.records,
  });
  return assembleProcessStoreInterface(spine, groupLog, queue);
});

/** @internal */
export const makeProcessStoreFromRuntimeStorage: Effect.Effect<
  ProcessStoreInterface,
  never,
  RuntimeStorage | ProcessStoreGroupLog | ProcessStoreQueueResource
> = Effect.gen(function* () {
  const groupLog = yield* ProcessStoreGroupLog;
  const queue = yield* ProcessStoreQueueResource;
  const storage = yield* RuntimeStorage;
  const now = yield* Clock.currentTimeMillis;
  const spine = makeProcessStoreSpine(storage, makeRunId(now));
  return assembleProcessStoreInterface(spine, groupLog, queue);
});
