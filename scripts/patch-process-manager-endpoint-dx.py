#!/usr/bin/env python3
"""Apply process-group endpoint DX changes to src/ProcessManager.ts."""
from __future__ import annotations

import re
from pathlib import Path

pm = Path("src/ProcessManager.ts")
text = pm.read_text()

if "childEndpointDefinition" in text:
    print("already patched")
    raise SystemExit(0)

old_imports = """import { makeControlTransportHttpClient } from "./ControlTransportHttp";
import { ControlService } from "./ControlService";
import { ProcessGroupContractSchema, localEnvLayer } from "./ProcessGroup";
import type {
  ProcessGroupContract,
  ProcessGroupEntry,
  ProcessGroupLocalEnvLayerOptions,
  ProcessGroupServiceDefinition,
} from "./ProcessGroup";
import {
  normalizeProcessManagerTarget,
  resolveProcessManagerTarget,
  type ProcessManagerTargetCandidate,
} from "./ProcessManagerTargetResolver";
import { responseBodyJson } from "./internal/json";"""

new_imports = """import { makeControlTransportHttpClient } from "./ControlTransportHttp";
import { ProcessGroupContractSchema } from "./ProcessGroup";
import type {
  ProcessGroupContract,
  ProcessGroupEntry,
} from "./ProcessGroup";
import {
  normalizeProcessManagerTarget,
  resolveProcessManagerTarget,
  type ProcessManagerTargetCandidate,
} from "./ProcessManagerTargetResolver";
import { responseBodyJson } from "./internal/json";
import {
  buildChildLaunchConfig,
  defaultChildLaunchPaths,
  resolveEntryUrl,
  type ProcessManagerChildLaunchConfig,
  type ProcessManagerChildLaunchPaths,
} from "./processManagerChildLaunch.js";
import {
  Transport,
  type ProcessManagerHttpTransport,
  type ProcessManagerTransport,
} from "./processManagerTransport.js";

export type { ProcessManagerHttpTransport, ProcessManagerTransport } from "./processManagerTransport.js";
export { Transport } from "./processManagerTransport.js";
import { groupLocalRuntime } from "./processManagerGroupRuntime.js";
export { groupLocalRuntime };"""

if old_imports not in text:
    raise SystemExit("import block not found")
text = text.replace(old_imports, new_imports)

text = text.replace(
    """/**
 * HTTP transport descriptor used by group-bundled endpoint config.
 *
 * @public
 */
export interface ProcessManagerHttpTransport {
  readonly _tag: "ProcessManagerHttpTransport";
  readonly baseUrl: string;
}

/**
 * Transport descriptor namespace for future protocol-agnostic endpoint config.
 *
 * @public
 */
export const Transport = {
  http: (config: { readonly baseUrl: string }): ProcessManagerHttpTransport => ({
    _tag: "ProcessManagerHttpTransport",
    baseUrl: config.baseUrl,
  }),
};

/**
 * Type-preserving descriptor""",
    """/**
 * Local child endpoint: spawn module at `entry`, control plane on `transport`.
 *
 * @public
 */
export interface ProcessManagerChildEndpointDefinition {
  readonly _tag: "ProcessManagerChildEndpoint";
  readonly entry: string;
  readonly transport: ProcessManagerHttpTransport;
}

/**
 * Type-preserving descriptor""",
)

text = re.sub(
    r"/\*\*\n \* Options for \{@link ProcessManager\.groupLocalRuntime\}\.\n[\s\S]*?control: ControlService\.layerHttp\(group, \{ port: options\.port \}\),\n  \}\);\n\n",
    "",
    text,
    count=1,
)

text = re.sub(
    r"export interface ProcessManagerModuleEndpointLaunchConfig \{[\s\S]*?\}\n\ninterface ProcessManagerRunState",
    "export type ProcessManagerModuleEndpointLaunchConfig = ProcessManagerChildLaunchConfig;\n\ninterface ProcessManagerRunState",
    text,
    count=1,
)

text = text.replace(
    "export type ProcessManagerEndpointDefinition =\n  | ProcessManagerHttpEndpointDefinition\n  | ProcessManagerModuleEndpointDefinition<AnyProcessManagerLocalRuntimeDefinition>;",
    "export type ProcessManagerEndpointDefinition =\n  | ProcessManagerHttpEndpointDefinition\n  | ProcessManagerChildEndpointDefinition\n  | ProcessManagerModuleEndpointDefinition<AnyProcessManagerLocalRuntimeDefinition>;",
)

text = re.sub(
    r"\nconst endpointHttp = \(\n  config: \{ readonly transport: ProcessManagerHttpTransport \},\n\): ProcessManagerHttpEndpointDefinition => \(\{\n  _tag: \"ProcessManagerHttpEndpoint\",\n  transport: config\.transport,\n\}\);\n",
    "\n",
    text,
    count=1,
)

text = text.replace(
    "const safePathSegment = (input: string): string =>\n  normalizeProcessManagerTarget(input).replace(/\\//g, \"__\") || \"group\";\n\nconst moduleEndpointLaunchConfig = (",
    """const safePathSegment = (input: string): string =>
  normalizeProcessManagerTarget(input).replace(/\\//g, "__") || "group";

const readChildLaunchEnv = (name: string): string | undefined => {
  // @effect-diagnostics-next-line processEnv:off — optional operator overrides for child launcher paths
  return process.env[name];
};

const resolveChildLaunchPaths = (): ProcessManagerChildLaunchPaths => {
  const defaults = defaultChildLaunchPaths();
  return {
    scriptPath: readChildLaunchEnv("EFFECT_PM_GROUP_CHILD_SCRIPT") ?? defaults.scriptPath,
    executorImport: readChildLaunchEnv("EFFECT_PM_EXECUTOR_IMPORT") ?? defaults.executorImport,
    logDirectory: readChildLaunchEnv("EFFECT_PM_LOG_DIRECTORY") ?? defaults.logDirectory,
    runDirectory: readChildLaunchEnv("EFFECT_PM_RUN_DIRECTORY") ?? defaults.runDirectory,
  };
};

const spawnEndpointLaunchConfig = (""",
)

text = text.replace(
    """  if (selected.endpoint._tag !== "ProcessManagerModuleEndpoint") {
    return Effect.fail(
      new ProcessManagerEndpointConfigError({
        reason: `Endpoint '${selected.label}' for group '${group.id}' is not a module endpoint`,
      }),
    );
  }
  return selected.endpoint.launch === undefined
    ? Effect.fail(
        new ProcessManagerEndpointConfigError({
          reason: `Endpoint '${selected.label}' for group '${group.id}' does not include launch config`,
        }),
      )
    : Effect.succeed(selected.endpoint.launch);
};""",
    """  switch (selected.endpoint._tag) {
    case "ProcessManagerChildEndpoint":
      return Effect.succeed(
        buildChildLaunchConfig(
          group.id,
          selected.endpoint.entry,
          selected.endpoint.transport,
          resolveChildLaunchPaths(),
        ),
      );
    case "ProcessManagerModuleEndpoint":
      return selected.endpoint.launch === undefined
        ? Effect.fail(
            new ProcessManagerEndpointConfigError({
              reason: `Endpoint '${selected.label}' for group '${group.id}' does not include launch config`,
            }),
          )
        : Effect.succeed(selected.endpoint.launch);
    default:
      return Effect.fail(
        new ProcessManagerEndpointConfigError({
          reason: `Endpoint '${selected.label}' for group '${group.id}' is not a spawn endpoint`,
        }),
      );
  }
};""",
)

text = text.replace("moduleEndpointLaunchConfig", "spawnEndpointLaunchConfig")
text = text.replace("function endpointModule", "function endpointRunner")
text = text.replace("Endpoint.module selector", "Endpoint.runner selector")
text = text.replace(
    "Endpoint.module default export must be a ProcessManager.LocalRuntime descriptor",
    "Endpoint.runner default export must be a ProcessManager.LocalRuntime descriptor",
)

needle = """    case "ProcessManagerModuleEndpoint":
      return selected.endpoint.launch === undefined
        ? Effect.fail(
            new ProcessManagerEndpointConfigError({
              reason:
                `Endpoint '${selected.label}' for group '${group.id}' is a module endpoint without launch config`,
            }),
          )
        : Effect.succeed(
            makeRemoteProcessManager(
              makeControlTransportHttpClient({
                baseUrl: selected.endpoint.launch.control.transport.baseUrl,
              }),
              group.contract,
            ),
          );
  }
};"""

child_case = """    case "ProcessManagerChildEndpoint":
      return Effect.succeed(
        makeRemoteProcessManager(
          makeControlTransportHttpClient({ baseUrl: selected.endpoint.transport.baseUrl }),
          group.contract,
        ),
      );
    case "ProcessManagerModuleEndpoint":
      return selected.endpoint.launch === undefined
        ? Effect.fail(
            new ProcessManagerEndpointConfigError({
              reason:
                `Endpoint '${selected.label}' for group '${group.id}' is a module endpoint without launch config`,
            }),
          )
        : Effect.succeed(
            makeRemoteProcessManager(
              makeControlTransportHttpClient({
                baseUrl: selected.endpoint.launch.control.transport.baseUrl,
              }),
              group.contract,
            ),
          );
    default:
      return Effect.fail(
        new ProcessManagerEndpointConfigError({
          reason: `Endpoint '${selected.label}' for group '${group.id}' has an unsupported definition`,
        }),
      );
  }
};"""

if needle in text:
    text = text.replace(needle, child_case)

probe_needle = """    case "ProcessManagerModuleEndpoint":
      return endpoint.launch === undefined
        ? Effect.succeed({
            _tag: "Configured",
            reason: "Module endpoint configured; local runtime launching is not implemented yet",
          })"""

probe_new = """    case "ProcessManagerChildEndpoint":
      return probeEndpointStatus(group, {
        ...selected,
        endpoint: {
          _tag: "ProcessManagerHttpEndpoint",
          transport: endpoint.transport,
        },
      });
    case "ProcessManagerModuleEndpoint":
      return endpoint.launch === undefined
        ? Effect.succeed({
            _tag: "Configured",
            reason: "Runner endpoint configured without launch metadata",
          })"""

if probe_needle in text:
    text = text.replace(probe_needle, probe_new)

old_endpoint = """export const Endpoint = Object.assign(makeEndpointFactory, {
  http: endpointHttp,
  module: endpointModule,
  local: <const Definition extends ProcessManagerEndpointDefinition>(
    endpoint: Definition,
  ): ProcessManagerEndpointConfigItem<"local", Definition, false> =>
    makeEndpointConfigItem("local", endpoint, false),
  production: <const Definition extends ProcessManagerEndpointDefinition>(
    endpoint: Definition,
  ): ProcessManagerEndpointConfigItem<"production", Definition, false> =>
    makeEndpointConfigItem("production", endpoint, false),
  define: <
    const Label extends string,
    const Definition extends ProcessManagerEndpointDefinition,
  >(
    label: Label,
    endpoint: Definition,
  ): ProcessManagerEndpointConfigItem<Label, Definition, false> =>
    makeEndpointConfigItem(label, endpoint, false),
});"""

new_endpoint = """const childEndpointDefinition = (
  transport: ProcessManagerTransport,
  entry: string | ImportMeta,
): ProcessManagerChildEndpointDefinition => ({
  _tag: "ProcessManagerChildEndpoint",
  entry: resolveEntryUrl(entry),
  transport,
});

const remoteEndpointFromTransport = (
  transport: ProcessManagerTransport,
): ProcessManagerHttpEndpointDefinition => ({
  _tag: "ProcessManagerHttpEndpoint",
  transport,
});

export const Endpoint = Object.assign(makeEndpointFactory, {
  local: (
    transport: ProcessManagerTransport,
    entry: string | ImportMeta,
  ): ProcessManagerEndpointConfigItem<"local", ProcessManagerChildEndpointDefinition, false> =>
    makeEndpointConfigItem("local", childEndpointDefinition(transport, entry), false),

  production: (
    transport: ProcessManagerTransport,
  ): ProcessManagerEndpointConfigItem<"production", ProcessManagerHttpEndpointDefinition, false> =>
    makeEndpointConfigItem("production", remoteEndpointFromTransport(transport), false),

  define: <const Label extends string>(
    label: Label,
    transport: ProcessManagerTransport,
  ): ProcessManagerEndpointConfigItem<Label, ProcessManagerHttpEndpointDefinition, false> =>
    makeEndpointConfigItem(label, remoteEndpointFromTransport(transport), false),

  runner: endpointRunner,
});"""

if old_endpoint not in text:
    raise SystemExit("endpoint export not found")
text = text.replace(old_endpoint, new_endpoint)
text = text.replace("  LocalRuntime,\n};", "  LocalRuntime,\n  groupLocalRuntime,\n};")

pm.write_text(text)
print("ProcessManager patched OK")
