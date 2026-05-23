import { Command, Flag } from "effect/unstable/cli";
import { Data, Effect, FileSystem, Layer, Path } from "effect";
import type { ProcessGroupEntry, ProcessGroupServiceDefinition } from "./ProcessGroup.js";
import { resolveChildLaunchPaths } from "./processManagerChildLaunch.js";
import { groupLocalRuntime } from "./processManagerGroupRuntime.js";
import * as Logs from "./Logs.js";
import { groupLogSqlitePath } from "./processManagerChildLaunch.js";
import { ProcessStore } from "./ProcessStore.js";
import { captureLoggerLayer } from "./processManagerLogRelay.js";

/** @public */
export class GroupChildArgvError extends Data.TaggedError("GroupChildArgvError")<{
  readonly reason: string;
}> {}

/** @public */
export class GroupChildImportError extends Data.TaggedError("GroupChildImportError")<{
  readonly entry: string;
  readonly reason: string;
}> {}

/** @public */
export class GroupChildNotFoundError extends Data.TaggedError("GroupChildNotFoundError")<{
  readonly entry: string;
  readonly groupId: string;
}> {}

type GroupSource = ProcessGroupServiceDefinition<
  never,
  string,
  readonly ProcessGroupEntry[]
>;

const isModuleExportsRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isProcessGroupServiceDefinition = (value: unknown): value is GroupSource => {
  if (typeof value !== "function" && (typeof value !== "object" || value === null)) {
    return false;
  }
  return (
    Reflect.get(value, "kind") === "group" &&
    typeof Reflect.get(value, "id") === "string" &&
    Reflect.get(value, "layer") !== undefined &&
    Reflect.get(value, "contract") !== undefined
  );
};

/** @internal */
export const findGroupExportById = (
  moduleExports: Record<string, unknown>,
  groupId: string,
): GroupSource | undefined => {
  for (const value of Object.values(moduleExports)) {
    if (isProcessGroupServiceDefinition(value) && value.id === groupId) {
      return value;
    }
  }
  return undefined;
};

/**
 * Run the group child entrypoint from parsed CLI flags.
 *
 * @public
 */
export const runGroupChildProgram = (args: {
  readonly entry: string;
  readonly groupId: string;
  readonly controlBaseUrl: string;
}) =>
  Effect.gen(function* () {
    const moduleUnknown: unknown = yield* Effect.tryPromise({
      try: (): Promise<unknown> => import(args.entry),
      catch: (error) =>
        new GroupChildImportError({
          entry: args.entry,
          reason: String(error),
        }),
    });
    if (!isModuleExportsRecord(moduleUnknown)) {
      return yield* new GroupChildImportError({
        entry: args.entry,
        reason: "Group module did not export an object record",
      });
    }
    const group = findGroupExportById(moduleUnknown, args.groupId);
    if (group === undefined) {
      return yield* new GroupChildNotFoundError({
        entry: args.entry,
        groupId: args.groupId,
      });
    }
    const paths = yield* resolveChildLaunchPaths();
    const logStorePath = groupLogSqlitePath(paths.logDirectory, args.groupId);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(logStorePath), { recursive: true }).pipe(Effect.orDie);
    const runtime = groupLocalRuntime(group, {
      controlBaseUrl: args.controlBaseUrl,
      store: ProcessStore.layerSqlite({ filename: logStorePath }),
    });
    const envLayer = runtime.layer.pipe(
      Layer.provideMerge(Logs.relayLayer),
      Layer.provideMerge(captureLoggerLayer),
    );
    return yield* Effect.never.pipe(
      Effect.provide(
        runtime.control.pipe(
          Layer.provideMerge(Logs.relayLayer),
          Layer.provide(envLayer),
        ),
      ),
      Effect.scoped,
    );
  });

const groupChildFlags = {
  entry: Flag.string("entry"),
  groupId: Flag.string("group-id"),
  controlBaseUrl: Flag.string("control-base-url"),
};

const groupChildRoot = Command.make(
  "effect-pm-group-child",
  groupChildFlags,
  ({ entry, groupId, controlBaseUrl }) =>
    runGroupChildProgram({ entry, groupId, controlBaseUrl }),
);

/**
 * Effect CLI runner for the packaged group child binary.
 *
 * @public
 */
export const runGroupChildCli = (argv: ReadonlyArray<string> = process.argv) =>
  Command.runWith(groupChildRoot, { version: "0.0.0" })(argv);
