import { Data, Effect, Layer } from "effect";
import type { ProcessGroupEntry, ProcessGroupServiceDefinition } from "./ProcessGroup.js";
import { groupLocalRuntime } from "./processManagerGroupRuntime.js";

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

/** @internal */
export const parseGroupChildArgv = (
  argv: ReadonlyArray<string>,
): Effect.Effect<
  { readonly entry: string; readonly groupId: string; readonly controlBaseUrl: string },
  GroupChildArgvError
> =>
  Effect.gen(function* () {
    let entry: string | undefined;
    let groupId: string | undefined;
    let controlBaseUrl: string | undefined;
    for (let i = 2; i < argv.length; i++) {
      const flag = argv[i];
      const value = argv[i + 1];
      if (flag === "--entry" && value !== undefined) {
        entry = value;
        i++;
        continue;
      }
      if (flag === "--group-id" && value !== undefined) {
        groupId = value;
        i++;
        continue;
      }
      if (flag === "--control-base-url" && value !== undefined) {
        controlBaseUrl = value;
        i++;
      }
    }
    if (entry === undefined) {
      return yield* new GroupChildArgvError({ reason: "Missing --entry <module-url>" });
    }
    if (groupId === undefined) {
      return yield* new GroupChildArgvError({ reason: "Missing --group-id <group-id>" });
    }
    if (controlBaseUrl === undefined) {
      return yield* new GroupChildArgvError({
        reason: "Missing --control-base-url <url>",
      });
    }
    return { entry, groupId, controlBaseUrl };
  });

/** @public */
export const runGroupChildProgram = (argv: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const args = yield* parseGroupChildArgv(argv);
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
    const runtime = groupLocalRuntime(group, { controlBaseUrl: args.controlBaseUrl });
    return yield* Effect.never.pipe(
      Effect.provide(runtime.control.pipe(Layer.provide(runtime.layer))),
      Effect.scoped,
    );
  });
