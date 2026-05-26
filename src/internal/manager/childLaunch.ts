import { Config, Context, Effect, Layer, Option } from "effect";
import type { Duration } from "effect";
import { createRequire } from "node:module";
import type { ProcessManagerTransport } from "../../Transport";

const packageResolverFrom = (startDirectory: string) =>
  createRequire(`${startDirectory.replace(/[\\/]+$/, "")}/package.json`);

const effectPmPackageJsonPath = (startDirectory: string = process.cwd()): string =>
  packageResolverFrom(startDirectory).resolve("@nikscripts/effect-pm/package.json");

const effectPmPackageRequire = (startDirectory: string = process.cwd()) =>
  createRequire(effectPmPackageJsonPath(startDirectory));

/** @internal */
export const findEffectPmPackageRoot = (startDirectory: string = process.cwd()): string =>
  effectPmPackageJsonPath(startDirectory).replace(/[\\/]package\.json$/, "");

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

const pathsFromConfig = (defaults?: ProcessManagerChildLaunchPaths) =>
  Effect.gen(function* () {
    const scriptPathOption = yield* Config.option(Config.string("EFFECT_PM_GROUP_CHILD_SCRIPT"));
    const executorImportOption = yield* Config.option(Config.string("EFFECT_PM_EXECUTOR_IMPORT"));
    const logDirectoryOption = yield* Config.option(Config.string("EFFECT_PM_LOG_DIRECTORY"));
    const runDirectoryOption = yield* Config.option(Config.string("EFFECT_PM_RUN_DIRECTORY"));

    if (
      Option.isSome(scriptPathOption) &&
      Option.isSome(executorImportOption) &&
      Option.isSome(logDirectoryOption) &&
      Option.isSome(runDirectoryOption)
    ) {
      return {
        scriptPath: scriptPathOption.value,
        executorImport: executorImportOption.value,
        logDirectory: logDirectoryOption.value,
        runDirectory: runDirectoryOption.value,
      };
    }

    const resolvedDefaults = defaults ?? defaultChildLaunchPaths();
    const scriptPath = Option.getOrElse(
      scriptPathOption,
      () => resolvedDefaults.scriptPath,
    );
    const executorImport = Option.getOrElse(
      executorImportOption,
      () => resolvedDefaults.executorImport,
    );
    const logDirectory = Option.getOrElse(
      logDirectoryOption,
      () => resolvedDefaults.logDirectory,
    );
    const runDirectory = Option.getOrElse(
      runDirectoryOption,
      () => resolvedDefaults.runDirectory,
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
>()("@nikscripts/effect-pm/internal/manager/childLaunch/ProcessManagerChildLaunch") {}

const resolveDefaultScriptPath = (): string => {
  const req = effectPmPackageRequire();
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
  defaults?: ProcessManagerChildLaunchPaths,
): Layer.Layer<ProcessManagerChildLaunch> =>
  Layer.succeed(ProcessManagerChildLaunch, {
    paths: pathsFromConfig(defaults),
  });

/** @internal */
export const resolveChildLaunchPaths = (
  defaults?: ProcessManagerChildLaunchPaths,
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
