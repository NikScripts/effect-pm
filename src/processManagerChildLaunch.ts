import { Config, Context, Effect, Layer } from "effect";
import type { Duration } from "effect";
import { createRequire } from "node:module";

const pathDirname = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return normalized.startsWith("/") ? "/" : ".";
  }
  return normalized.slice(0, index);
};

const pathJoin = (...segments: ReadonlyArray<string>): string =>
  segments
    .filter((segment) => segment.length > 0)
    .join("/")
    .replace(/\/+/g, "/");

import type { ProcessManagerTransport } from "./processManagerTransport.js";


const readPackageName = (packageJsonPath: string): string | undefined => {
  try {
    const req = createRequire(packageJsonPath);
    const pkg = req(packageJsonPath) as { readonly name?: string };
    return pkg.name;
  } catch {
    return undefined;
  }
};

/** @internal */
export const findEffectPmPackageRoot = (startDirectory: string = process.cwd()): string => {
  let current = startDirectory;
  for (;;) {
    const packageJsonPath = pathJoin(current, "package.json");
    try {
      const req = createRequire(packageJsonPath);
      req.resolve("./package.json");
      if (readPackageName(packageJsonPath) === "@nikscripts/effect-pm") {
        return current;
      }
    } catch {
      // not a package root
    }
    const parent = pathDirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return startDirectory;
};

/** @internal */
export const resolveEntryUrl = (entry: string | ImportMeta): string =>
  typeof entry === "string" ? entry : entry.url;

/**
 * Resolved paths and directories used when spawning a group child process.
 *
 * @public
 */
export interface ProcessManagerChildLaunchPaths {
  readonly scriptPath: string;
  readonly executorImport: string;
  readonly logDirectory: string;
  readonly runDirectory: string;
}

const pathsFromConfig = (defaults: ProcessManagerChildLaunchPaths) =>
  Effect.gen(function* () {
    const scriptPath = yield* Config.string("EFFECT_PM_GROUP_CHILD_SCRIPT").pipe(
      Config.withDefault(defaults.scriptPath),
    );
    const executorImport = yield* Config.string("EFFECT_PM_EXECUTOR_IMPORT").pipe(
      Config.withDefault(defaults.executorImport),
    );
    const logDirectory = yield* Config.string("EFFECT_PM_LOG_DIRECTORY").pipe(
      Config.withDefault(defaults.logDirectory),
    );
    const runDirectory = yield* Config.string("EFFECT_PM_RUN_DIRECTORY").pipe(
      Config.withDefault(defaults.runDirectory),
    );
    return { scriptPath, executorImport, logDirectory, runDirectory };
  });

/**
 * Config resolution failures for {@link ProcessManagerChildLaunch}.
 *
 * @public
 */
export type ProcessManagerChildLaunchPathsError = Effect.Error<
  ReturnType<typeof pathsFromConfig>
>;

/**
 * Supplies child launcher paths for {@link ProcessManager} `group-start`.
 *
 * @public
 */
export interface ProcessManagerChildLaunchService {
  readonly paths: ReturnType<typeof pathsFromConfig>;
}

/**
 * @public
 */
export class ProcessManagerChildLaunch extends Context.Service<
  ProcessManagerChildLaunch,
  ProcessManagerChildLaunchService
>()("@nikscripts/effect-pm/processManagerChildLaunch") {}

const resolveDefaultScriptPath = (): string => {
  const req = createRequire(pathJoin(findEffectPmPackageRoot(), "package.json"));
  try {
    return req.resolve("./dist/bin/effect-pm-group-child.js");
  } catch {
    return req.resolve("./src/bin/effect-pm-group-child.ts");
  }
};

/** @internal */
export const defaultChildLaunchPaths = (): ProcessManagerChildLaunchPaths => ({
  scriptPath: resolveDefaultScriptPath(),
  executorImport: "tsx",
  logDirectory: ".effect-pm/logs",
  runDirectory: ".effect-pm/run/groups",
});

/** @internal */
export const endpointHttpFromTransport = (
  transport: ProcessManagerTransport,
): {
  readonly _tag: "ProcessManagerHttpEndpoint";
  readonly transport: ProcessManagerTransport;
} => ({
  _tag: "ProcessManagerHttpEndpoint",
  transport,
});

/**
 * Resolved argv and control transport used when spawning a group child process.
 *
 * @public
 */
export interface ProcessManagerChildLaunchConfig {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly control: ReturnType<typeof endpointHttpFromTransport>;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly logDirectory?: string;
  readonly runDirectory?: string;
  readonly pollInterval?: Duration.Input;
  readonly startupTimeout?: Duration.Input;
}

/** @internal */
export const buildChildLaunchConfig = (
  groupId: string,
  entry: string,
  transport: ProcessManagerTransport,
  paths: ProcessManagerChildLaunchPaths,
): ProcessManagerChildLaunchConfig => ({
  command: process.execPath,
  args: [
    "--import",
    paths.executorImport,
    paths.scriptPath,
    "--entry",
    entry,
    "--group-id",
    groupId,
    "--control-base-url",
    transport.baseUrl,
  ],
  control: endpointHttpFromTransport(transport),
  logDirectory: paths.logDirectory,
  runDirectory: paths.runDirectory,
  pollInterval: "200 millis",
  startupTimeout: "15 seconds",
});

/**
 * Override layer with explicit child launcher paths (tests and custom CLIs).
 *
 * @public
 */
export const layerConfig = (
  paths: ProcessManagerChildLaunchPaths,
): Layer.Layer<ProcessManagerChildLaunch> =>
  Layer.succeed(ProcessManagerChildLaunch, {
    paths: Effect.succeed(paths),
  });

/**
 * Layer that resolves child launcher paths from `Config` / environment variables.
 *
 * @public
 */
export const layerFromEnv = (
  defaults: ProcessManagerChildLaunchPaths = defaultChildLaunchPaths(),
): Layer.Layer<ProcessManagerChildLaunch> =>
  Layer.succeed(ProcessManagerChildLaunch, {
    paths: pathsFromConfig(defaults),
  });

/** @internal */
export const resolveChildLaunchPaths = (
  defaults: ProcessManagerChildLaunchPaths = defaultChildLaunchPaths(),
): Effect.Effect<
  ProcessManagerChildLaunchPaths,
  ProcessManagerChildLaunchPathsError
> =>
  Effect.gen(function* () {
    const service = yield* Effect.serviceOption(ProcessManagerChildLaunch);
    if (service._tag === "Some") {
      return yield* service.value.paths;
    }
    return yield* pathsFromConfig(defaults);
  });

const safeGroupStoreSegment = (groupId: string): string =>
  groupId.replace(/[^a-zA-Z0-9._-]+/g, "_");

/**
 * On-disk SQLite file path for a group's {@link ProcessStore} (ops layout only).
 *
 * @remarks
 * Not a storage API. Compose `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`
 * with this path at
 * child launch; use {@link Logs} for log event encoding/querying.
 *
 * @public
 */
export const groupLogSqlitePath = (
  logDirectory: string,
  groupId: string,
): string =>
  `${logDirectory.replace(/\/+$/, "")}/${safeGroupStoreSegment(groupId)}/logs.sqlite`;

/** @public */
export { buildChildLaunchConfig as buildLaunchConfig };
