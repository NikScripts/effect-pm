import { Effect, Layer } from "effect";
import type { ProcessGroupEntry, ProcessGroupServiceDefinition } from "./ProcessGroup.js";
import { groupLocalRuntime } from "./processManagerGroupRuntime.js";

type GroupSource = ProcessGroupServiceDefinition<
  unknown,
  string,
  readonly ProcessGroupEntry[]
>;

const isGroupSource = (value: unknown): value is GroupSource =>
  typeof value === "function" &&
  "id" in value &&
  typeof value.id === "string" &&
  "layer" in value &&
  "contract" in value;

/** @internal */
export const findGroupExportById = (
  moduleExports: Record<string, unknown>,
  groupId: string,
): GroupSource | undefined => {
  for (const value of Object.values(moduleExports)) {
    if (isGroupSource(value) && value.id === groupId) {
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
  string
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
      return yield* Effect.fail("Missing --entry <module-url>");
    }
    if (groupId === undefined) {
      return yield* Effect.fail("Missing --group-id <group-id>");
    }
    if (controlBaseUrl === undefined) {
      return yield* Effect.fail("Missing --control-base-url <url>");
    }
    return { entry, groupId, controlBaseUrl };
  });

/** @public */
export const runGroupChildProgram = (argv: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const args = yield* parseGroupChildArgv(argv);
    const module = (yield* Effect.tryPromise({
      try: () => import(args.entry),
      catch: (error) => `Unable to import group module '${args.entry}': ${String(error)}`,
    })) as Record<string, unknown>;
    const group = findGroupExportById(module, args.groupId);
    if (group === undefined) {
      return yield* Effect.fail(
        `No ProcessGroup.Service export with id '${args.groupId}' in '${args.entry}'`,
      );
    }
    const runtime = groupLocalRuntime(group, { controlBaseUrl: args.controlBaseUrl });
    yield* Effect.never.pipe(
      Effect.provide(runtime.control.pipe(Layer.provide(runtime.layer))),
      Effect.scoped,
    );
  });
