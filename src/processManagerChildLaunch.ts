import type { Duration } from "effect";
import { createRequire } from "node:module";
import type { ProcessManagerTransport } from "./processManagerTransport.js";

/** @internal */
export const resolveEntryUrl = (entry: string | ImportMeta): string =>
  typeof entry === "string" ? entry : entry.url;

/** @internal */
export interface ProcessManagerChildLaunchPaths {
  readonly scriptPath: string;
  readonly executorImport: string;
  readonly logDirectory: string;
  readonly runDirectory: string;
}

/** @internal */
export const defaultChildLaunchPaths = (): ProcessManagerChildLaunchPaths => {
  const requireFromPackage = createRequire(__filename);
  let scriptPath: string;
  try {
    scriptPath = requireFromPackage.resolve("./bin/effect-pm-group-child.js");
  } catch {
    scriptPath = requireFromPackage.resolve("./bin/effect-pm-group-child.ts");
  }
  return {
    scriptPath,
    executorImport: "tsx",
    logDirectory: ".effect-pm/logs",
    runDirectory: ".effect-pm/run/groups",
  };
};

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

/** @internal */
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
  paths: ProcessManagerChildLaunchPaths = defaultChildLaunchPaths(),
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

/** @internal */
export const buildChildLaunchConfigWithScript = (
  groupId: string,
  entry: string,
  transport: ProcessManagerTransport,
  scriptPath: string,
  options?: {
    readonly executorImport?: string;
    readonly logDirectory?: string;
    readonly runDirectory?: string;
    readonly pollInterval?: Duration.Input;
    readonly startupTimeout?: Duration.Input;
  },
): ProcessManagerChildLaunchConfig => {
  const defaults = defaultChildLaunchPaths();
  return buildChildLaunchConfig(groupId, entry, transport, {
    scriptPath,
    executorImport: options?.executorImport ?? defaults.executorImport,
    logDirectory: options?.logDirectory ?? defaults.logDirectory,
    runDirectory: options?.runDirectory ?? defaults.runDirectory,
  });
};
