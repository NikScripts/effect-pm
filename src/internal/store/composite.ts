/**
 * Composite {@link ProcessStore} materialization helpers.
 *
 * @module ProcessStoreComposite
 * @internal
 */

import { Clock, Effect, FileSystem, Path } from "effect";
import { makeProcessStoreLog } from "../../store/log";
import { ProcessStoreLog } from "../../store/log";
import { makeProcessStoreQueueResource } from "../../store/queueResource";
import { ProcessStoreQueueResource } from "../../store/queueResource";
import {
  assembleProcessStoreInterface,
  makeFileProcessStoreSpine,
  makeProcessStoreSpine,
  makeRunId,
} from "./spine";
import type { ProcessStoreInterface } from "../../ProcessStore";
import { ProcessStoreProcessExecution } from "../../store/processExecution";
import { ProcessStoreProcessGroup } from "../../store/processGroup";
import { ProcessStoreProcessLifecycle } from "../../store/processLifecycle";
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
    const log = makeProcessStoreLog({
      append: spine.append,
      appendBatch: spine.appendBatch,
      events: spine.events,
    });
    const queue = makeProcessStoreQueueResource({
      append: spine.append,
      records: spine.records,
    });
    return assembleProcessStoreInterface(spine, log, queue);
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
  const log = makeProcessStoreLog({
    append: spine.append,
    appendBatch: spine.appendBatch,
    events: spine.events,
  });
  const queue = makeProcessStoreQueueResource({
    append: spine.append,
    records: spine.records,
  });
  return assembleProcessStoreInterface(spine, log, queue);
});

/** @internal */
export const makeProcessStoreFromRuntimeStorage: Effect.Effect<
  ProcessStoreInterface,
  never,
  | RuntimeStorage
  | ProcessStoreLog
  | ProcessStoreQueueResource
  | ProcessStoreProcessExecution
  | ProcessStoreProcessLifecycle
  | ProcessStoreProcessGroup
> = Effect.gen(function* () {
  const log = yield* ProcessStoreLog;
  const queue = yield* ProcessStoreQueueResource;
  yield* ProcessStoreProcessExecution;
  yield* ProcessStoreProcessLifecycle;
  yield* ProcessStoreProcessGroup;
  const storage = yield* RuntimeStorage;
  const now = yield* Clock.currentTimeMillis;
  const spine = makeProcessStoreSpine(storage, makeRunId(now));
  return assembleProcessStoreInterface(spine, log, queue);
});
