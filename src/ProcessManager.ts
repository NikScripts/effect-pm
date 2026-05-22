/**
 * **ProcessManager** — typed remote client for ProcessGroup control surfaces.
 *
 * @remarks
 * A manager does not own local process or queue internals. It connects to a
 * `ControlService` exposed by a `ProcessGroup`, uses the group's schema-backed
 * contract for typed IDs, and routes supported controls over a control transport.
 *
 * @module ProcessManager
 */

import { Clock, Config, ConfigProvider, Console, Context, Data, DateTime, Duration, Effect, Exit, FileSystem, Layer, Logger, Option, Path, Schema, Scope } from "effect";
import type { Terminal } from "effect/Terminal";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type {
  ControlProtocolMetadata,
  ControlProtocolRequest,
  ControlResponse,
  ControlTransportClientShape,
  ControlTransportError,
} from "./ControlProtocol";
import { makeControlProtocolRequestEnvelope } from "./ControlProtocol";
import { ControlTransportClient as ControlTransportClientTag } from "./ControlProtocol";
import { makeControlTransportHttpClient } from "./ControlTransportHttp";
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
  layerConfig as childLaunchLayerConfig,
  layerFromEnv as childLaunchLayerFromEnv,
  resolveChildLaunchPaths,
  resolveEntryUrl,
  type ProcessManagerChildLaunchConfig,
} from "./processManagerChildLaunch.js";
import {
  Transport,
  type ProcessManagerHttpTransport,
  type ProcessManagerTransport,
} from "./processManagerTransport.js";

export type { ProcessManagerHttpTransport, ProcessManagerTransport } from "./processManagerTransport.js";
export type { ProcessManagerChildLaunchConfig } from "./processManagerChildLaunch.js";
export { Transport } from "./processManagerTransport.js";
import { groupLocalRuntime } from "./processManagerGroupRuntime.js";
export { groupLocalRuntime };
import {
  decodeProcessManagerRunStateJson,
  encodeProcessManagerRunStateJson,
  type ProcessManagerRunState,
} from "./processManagerRunState.js";
import {
  ProcessManagerGroupLogError,
} from "./processManagerGroupLogs.js";
import { watchGroupLogs } from "./processManagerGroupLogsInteractive.js";
import { httpEndpoint } from "./processManagerTransport.js";

type AnyProcessGroupContract = ProcessGroupContract<
  string,
  readonly ProcessGroupEntry[]
>;

type ProcessId<Contract extends AnyProcessGroupContract> =
  Contract["processes"][number]["id"];

type QueueId<Contract extends AnyProcessGroupContract> =
  Contract["queues"][number]["id"];

type ContractSource<Contract extends AnyProcessGroupContract> = {
  readonly contract: Contract;
};

type ContractFromSource<Source extends ContractSource<AnyProcessGroupContract>> =
  Source["contract"];

type ConnectionSource<Contract extends AnyProcessGroupContract> =
  ContractSource<Contract> & {
    readonly id: Contract["id"];
  };

type ConnectionGroupId<Groups extends readonly ConnectionSource<AnyProcessGroupContract>[]> =
  Groups[number]["id"];

export type ProcessManagerConnectionMap<
  Groups extends readonly ConnectionSource<AnyProcessGroupContract>[],
> = {
  readonly [Id in ConnectionGroupId<Groups>]: string;
};

export type ProcessManagerConnectionConfigMap<
  Groups extends readonly ConnectionSource<AnyProcessGroupContract>[],
> = {
  readonly [Id in ConnectionGroupId<Groups>]: Config.Config<string>;
} & {
  readonly [groupId: string]: Config.Config<string>;
};

/**
 * Configuration for a remote ProcessManager endpoint service.
 *
 * @public
 */
export type ProcessManagerEndpointConfig =
  | {
      readonly baseUrl: string;
    }
  | {
      readonly transport: "context";
    };

/**
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
 * Error returned when endpoint configuration cannot be interpreted safely.
 *
 * @public
 */

export class ProcessManagerEndpointConfigError extends Data.TaggedError(
  "ProcessManagerEndpointConfigError",
)<{
  readonly reason: string;
}> {}

/**
 * HTTP endpoint definition. The endpoint will provide a ControlTransportClient
 * when interpreted by a CLI/daemon runtime.
 *
 * @public
 */
export interface ProcessManagerHttpEndpointDefinition {
  readonly _tag: "ProcessManagerHttpEndpoint";
  readonly transport: ProcessManagerHttpTransport;
}

/**
 * Endpoint definitions that can appear in a group config item array.
 *
 * @public
 */
export type ProcessManagerEndpointDefinition =
  | ProcessManagerHttpEndpointDefinition
  | ProcessManagerChildEndpointDefinition;

/**
 * Labeled endpoint config item contributed by a ProcessGroup config array.
 *
 * @public
 */
export interface ProcessManagerEndpointConfigItem<
  Label extends string,
  Definition extends ProcessManagerEndpointDefinition,
  IsDefault extends boolean,
> {
  readonly _tag: "ProcessManagerEndpointConfigItem";
  readonly label: Label;
  readonly endpoint: Definition;
  readonly isDefault: IsDefault;
  readonly default: ProcessManagerEndpointConfigItem<Label, Definition, true>;
}

/**
 * Heterogeneous group config item. Endpoint items are the first supported item
 * type; logs, fallback, daemon, and security items can join this union later.
 *
 * @public
 */
export type ProcessManagerGroupConfigItem =
  ProcessManagerEndpointConfigItem<string, ProcessManagerEndpointDefinition, boolean>;

type ConfigSource<Contract extends AnyProcessGroupContract = AnyProcessGroupContract> =
  ConnectionSource<Contract> & {
    readonly config?: readonly ProcessManagerGroupConfigItem[];
  };

/**
 * Normalized endpoint selected from a ProcessManager group config.
 *
 * @public
 */
export interface ProcessManagerEndpointSelection {
  readonly label: string;
  readonly endpoint: ProcessManagerEndpointDefinition;
  readonly isDefault: boolean;
}

/**
 * Normalized endpoint configuration for one ProcessGroup.
 *
 * @public
 */
export interface ProcessManagerGroupConfig<
  Id extends string = string,
  Contract extends AnyProcessGroupContract = AnyProcessGroupContract,
> {
  readonly _tag: "ProcessManagerGroupConfig";
  readonly group: ConnectionSource<Contract>;
  readonly groupId: Id;
  readonly endpoints: ReadonlyArray<ProcessManagerEndpointSelection>;
  readonly defaultEndpoint: string;
}

/**
 * Observed status for a configured ProcessManager group endpoint.
 *
 * @public
 */
export type ProcessManagerGroupEndpointStatus =
  | {
      readonly _tag: "Configured";
      readonly reason?: string;
    }
  | {
      readonly _tag: "Pending";
      readonly reason?: string;
    }
  | {
      readonly _tag: "Online";
    }
  | {
      readonly _tag: "Offline";
      readonly reason: string;
      readonly status?: number;
    }
  | {
      readonly _tag: "ContractDrift";
      readonly reason: string;
    };

/**
 * Service used to override group-bundled ProcessManager endpoint config.
 *
 * @public
 */
export interface ProcessManagerConfigService {
  readonly groupConfig: (
    groupId: string,
  ) => Effect.Effect<ProcessManagerGroupConfig, ProcessManagerEndpointConfigError>;
}

/**
 * Override layer for ProcessManager endpoint config.
 *
 * @public
 */
export class ProcessManagerConfig extends Context.Service<
  ProcessManagerConfig,
  ProcessManagerConfigService
>()("@nikscripts/effect-pm/ProcessManager/ProcessManagerConfig") {}

const makeEndpointConfigItem = <
  const Label extends string,
  const Definition extends ProcessManagerEndpointDefinition,
  const IsDefault extends boolean,
>(
  label: Label,
  endpoint: Definition,
  isDefault: IsDefault,
): ProcessManagerEndpointConfigItem<Label, Definition, IsDefault> => ({
  _tag: "ProcessManagerEndpointConfigItem",
  label,
  endpoint,
  isDefault,
  get default() {
    return makeEndpointConfigItem(label, endpoint, true);
  },
});


const endpointHttp = (
  config: { readonly transport: ProcessManagerHttpTransport },
): ProcessManagerHttpEndpointDefinition => httpEndpoint(config.transport);

const isHttpEndpointDefinition = (
  input: ProcessManagerTransport | ProcessManagerHttpEndpointDefinition,
): input is ProcessManagerHttpEndpointDefinition =>
  typeof input === "object" &&
  input !== null &&
  "_tag" in input &&
  input._tag === "ProcessManagerHttpEndpoint";

const transportFromEndpointInput = (
  input: ProcessManagerTransport | ProcessManagerHttpEndpointDefinition,
): ProcessManagerTransport =>
  isHttpEndpointDefinition(input) ? input.transport : input;

const endpointItemsFrom = (
  items: readonly ProcessManagerGroupConfigItem[],
): ReadonlyArray<ProcessManagerEndpointConfigItem<string, ProcessManagerEndpointDefinition, boolean>> =>
  items.filter((item): item is ProcessManagerEndpointConfigItem<string, ProcessManagerEndpointDefinition, boolean> =>
    item._tag === "ProcessManagerEndpointConfigItem"
  );

const normalizeEndpointItems = <
  const Source extends ConnectionSource<AnyProcessGroupContract>,
>(
  group: Source,
  items: readonly ProcessManagerGroupConfigItem[],
): Effect.Effect<ProcessManagerGroupConfig<Source["id"], ContractFromSource<Source>>, ProcessManagerEndpointConfigError> =>
  Effect.gen(function* () {
    const endpoints = endpointItemsFrom(items);
    if (endpoints.length === 0) {
      return yield* new ProcessManagerEndpointConfigError({
        reason: `Group '${group.id}' does not declare any ProcessManager endpoints`,
      });
    }

    const labels = new Set<string>();
    for (const endpoint of endpoints) {
      if (labels.has(endpoint.label)) {
        return yield* new ProcessManagerEndpointConfigError({
          reason: `Group '${group.id}' declares duplicate endpoint label '${endpoint.label}'`,
        });
      }
      labels.add(endpoint.label);
    }

    const defaults = endpoints.filter((endpoint) => endpoint.isDefault);
    if (defaults.length !== 1) {
      return yield* new ProcessManagerEndpointConfigError({
        reason: `Group '${group.id}' must declare exactly one default endpoint; found ${defaults.length}`,
      });
    }

    return {
      _tag: "ProcessManagerGroupConfig",
      group,
      groupId: group.id,
      endpoints,
      defaultEndpoint: defaults[0]!.label,
    };
  });

export const GroupConfig = <
  const Source extends ConfigSource<AnyProcessGroupContract>,
>(
  group: Source,
  items: readonly ProcessManagerGroupConfigItem[] = group.config ?? [],
): Effect.Effect<ProcessManagerGroupConfig<Source["id"], ContractFromSource<Source>>, ProcessManagerEndpointConfigError> =>
  normalizeEndpointItems(group, items);

const makeProcessManagerConfigLayer = (
  configs: ReadonlyArray<ProcessManagerGroupConfig>,
): Layer.Layer<ProcessManagerConfig> => {
  const byGroupId = new Map<string, ProcessManagerGroupConfig>();
  for (const config of configs) {
    byGroupId.set(config.groupId, config);
  }
  return Layer.succeed(ProcessManagerConfig, {
    groupConfig: (groupId) => {
      const config = byGroupId.get(groupId);
      return config === undefined
        ? Effect.fail(
            new ProcessManagerEndpointConfigError({
              reason: `Group '${groupId}' is not registered in ProcessManager.Config`,
            }),
          )
        : Effect.succeed(config);
    },
  });
};

const safePathSegment = (input: string): string =>
  normalizeProcessManagerTarget(input).replace(/\//g, "__") || "group";

const spawnEndpointLaunchConfig = (
  group: ConfigSource,
  selected: ProcessManagerEndpointSelection,
): Effect.Effect<ProcessManagerChildLaunchConfig, ProcessManagerEndpointConfigError> =>
  Effect.gen(function* () {
    if (selected.endpoint._tag !== "ProcessManagerChildEndpoint") {
      return yield* new ProcessManagerEndpointConfigError({
        reason: `Endpoint '${selected.label}' for group '${group.id}' is not a local child endpoint`,
      });
    }
    const paths = yield* resolveChildLaunchPaths().pipe(
      Effect.mapError(
        (error) =>
          new ProcessManagerEndpointConfigError({
            reason: `Child launch paths: ${String(error)}`,
          }),
      ),
    );
    return buildChildLaunchConfig(
      group.id,
      selected.endpoint.entry,
      selected.endpoint.transport,
      paths,
    );
  });

const runStateFileFor = (
  group: ConfigSource,
  launch: ProcessManagerChildLaunchConfig,
): Effect.Effect<string, never, Path.Path> =>
  Effect.map(Path.Path, (path) => {
    const runDirectory = launch.runDirectory ?? path.join(".effect-pm", "run", "groups");
    return path.join(runDirectory, `${safePathSegment(group.id)}.json`);
  });

const writeRunState = (
  runFile: string,
  state: ProcessManagerRunState,
): Effect.Effect<void, ProcessManagerEndpointConfigError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const encoded = yield* encodeProcessManagerRunStateJson(state).pipe(
      Effect.mapError(
        (error) =>
          new ProcessManagerEndpointConfigError({
            reason: `Unable to encode ProcessManager run state for '${runFile}': ${String(error)}`,
          }),
      ),
    );
    yield* fs.writeFileString(runFile, encoded);
  }).pipe(
    Effect.mapError(
      (error) =>
        new ProcessManagerEndpointConfigError({
          reason: `Unable to write ProcessManager run state '${runFile}': ${String(error)}`,
        }),
    ),
  );

const decodeRunState = (
  runFile: string,
  text: string,
): Effect.Effect<ProcessManagerRunState, ProcessManagerEndpointConfigError> =>
  decodeProcessManagerRunStateJson(text).pipe(
    Effect.mapError(
      (error) =>
        new ProcessManagerEndpointConfigError({
          reason: `Unable to decode ProcessManager run state '${runFile}': ${String(error)}`,
        }),
    ),
  );

const readRunState = (
  runFile: string,
): Effect.Effect<
  Option.Option<ProcessManagerRunState>,
  ProcessManagerEndpointConfigError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(runFile).pipe(
      Effect.mapError(
        (error) =>
          new ProcessManagerEndpointConfigError({
            reason: `Unable to inspect ProcessManager run state '${runFile}': ${String(error)}`,
          }),
      ),
    );
    if (!exists) {
      return Option.none();
    }
    const text = yield* fs.readFileString(runFile).pipe(
      Effect.mapError(
        (error) =>
          new ProcessManagerEndpointConfigError({
            reason: `Unable to read ProcessManager run state '${runFile}': ${String(error)}`,
          }),
      ),
    );
    return Option.some(yield* decodeRunState(runFile, text));
  });

const removeRunState = (
  runFile: string,
): Effect.Effect<void, ProcessManagerEndpointConfigError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(runFile, { force: true }).pipe(
      Effect.mapError(
        (error) =>
          new ProcessManagerEndpointConfigError({
            reason: `Unable to remove ProcessManager run state '${runFile}': ${String(error)}`,
          }),
      ),
    );
  });

const signalPid = (
  pid: number,
  signal: NodeJS.Signals | 0,
): Effect.Effect<void, ProcessManagerEndpointConfigError> =>
  Effect.try({
    try: () => {
      process.kill(pid, signal);
    },
    catch: (error) =>
      new ProcessManagerEndpointConfigError({
        reason: `Unable to signal pid ${String(pid)}: ${String(error)}`,
      }),
  });

const isPidRunning = (pid: number): Effect.Effect<boolean> =>
  signalPid(pid, 0).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );

const launchDetachedProcess = (
  launch: ProcessManagerChildLaunchConfig,
): Effect.Effect<
  number,
  ProcessManagerEndpointConfigError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const handle = yield* ChildProcess.make(launch.command, [...launch.args], {
      cwd: launch.cwd,
      detached: true,
      env: launch.env,
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
    }).pipe(
      Effect.mapError(
        (error) =>
          new ProcessManagerEndpointConfigError({
            reason: `Unable to launch ProcessManager child endpoint: ${String(error)}`,
          }),
      ),
    );
    const reref = yield* handle.unref.pipe(
      Effect.mapError(
        (error) =>
          new ProcessManagerEndpointConfigError({
            reason: `Unable to unref ProcessManager child endpoint: ${String(error)}`,
          }),
      ),
    );
    void reref;
    return handle.pid;
  });

const waitForEndpointReady = (
  group: ConfigSource,
  launch: ProcessManagerChildLaunchConfig,
): Effect.Effect<
  void,
  ProcessManagerEndpointConfigError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const timeoutMs = Duration.toMillis(
      Duration.fromInputUnsafe(launch.startupTimeout ?? Duration.seconds(10)),
    );
    const interval = launch.pollInterval ?? Duration.millis(250);
    const startedAt = yield* Clock.currentTimeMillis;
    const manager = makeRemoteProcessManager(
      makeControlTransportHttpClient({ baseUrl: launch.control.transport.baseUrl }),
      group.contract,
    );
    while (true) {
      const result = yield* Effect.exit(manager.verifyContract);
      if (Exit.isSuccess(result)) {
        return;
      }
      const now = yield* Clock.currentTimeMillis;
      if (now - startedAt >= timeoutMs) {
        return yield* new ProcessManagerEndpointConfigError({
          reason: `Timed out waiting for group '${group.id}' endpoint '${launch.control.transport.baseUrl}' to become ready`,
        });
      }
      yield* Effect.sleep(interval);
    }
  });

/**
 * Error returned when a remote ProcessGroup request fails or returns malformed
 * data.
 *
 * @public
 */
export class ProcessManagerRequestError extends Data.TaggedError(
  "ProcessManagerRequestError",
)<{
  readonly reason: string;
  readonly status?: number;
}> {}

const requestError = (
  reason: string,
  status?: number,
): ProcessManagerRequestError =>
  new ProcessManagerRequestError({
    reason,
    ...(status === undefined ? {} : { status }),
  });

/** @public */
export class ProcessManagerConnectionError extends Data.TaggedError(
  "ProcessManagerConnectionError",
)<{
  readonly groupId: string;
  readonly reason: string;
}> {}

/** @public */
export interface ProcessManagerConnectionRegistryService {
  readonly baseUrl: (
    groupId: string,
  ) => Effect.Effect<string, ProcessManagerConnectionError>;
}

/** @public */
export class ProcessManagerConnectionRegistry extends Context.Service<
  ProcessManagerConnectionRegistry,
  ProcessManagerConnectionRegistryService
>()("@nikscripts/effect-pm/ProcessManager/ProcessManagerConnectionRegistry") {}

/** @public */
export interface ProcessManagerCliConfig {
  readonly name?: string;
  readonly version?: string;
}

interface ProcessManagerCliOptions {
  readonly json: boolean;
  readonly endpointLabel?: string;
}

/**
 * Remote controls for one process ID from a group contract.
 *
 * @public
 */
export interface RemoteProcessControls<Requirements = HttpClient.HttpClient> {
  readonly start: Effect.Effect<void, ProcessManagerRequestError, Requirements>;
  readonly stop: Effect.Effect<void, ProcessManagerRequestError, Requirements>;
  readonly restart: Effect.Effect<void, ProcessManagerRequestError, Requirements>;
  readonly runImmediately: Effect.Effect<void, ProcessManagerRequestError, Requirements>;
  readonly status: Effect.Effect<
    ControlResponse<unknown>,
    ProcessManagerRequestError,
    Requirements
  >;
}

/**
 * Remote controls for one queue ID from a group contract.
 *
 * @public
 */
export interface RemoteQueueControls<Requirements = HttpClient.HttpClient> {
  readonly start: Effect.Effect<void, ProcessManagerRequestError, Requirements>;
  readonly pause: Effect.Effect<void, ProcessManagerRequestError, Requirements>;
  readonly resume: Effect.Effect<void, ProcessManagerRequestError, Requirements>;
  readonly clear: Effect.Effect<
    ControlResponse<unknown>,
    ProcessManagerRequestError,
    Requirements
  >;
  readonly status: Effect.Effect<
    ControlResponse<unknown>,
    ProcessManagerRequestError,
    Requirements
  >;
}

/**
 * Typed remote client for a single ProcessGroup contract.
 *
 * @effect-expect-leaking HttpClient.HttpClient
 *
 * @public
 */
export interface RemoteProcessManager<
  Contract extends AnyProcessGroupContract,
  Requirements = HttpClient.HttpClient,
> {
  readonly contract: Contract;
  readonly fetchContract: Effect.Effect<
    typeof ProcessGroupContractSchema.Type,
    ProcessManagerRequestError,
    Requirements
  >;
  /**
   * Fetch the remote group contract and compare group id, version, process ids,
   * queue ids, and exposed control sets with the local contract.
   */
  readonly verifyContract: Effect.Effect<void, ProcessManagerRequestError, Requirements>;
  readonly process: (id: ProcessId<Contract>) => RemoteProcessControls<Requirements>;
  readonly queue: (id: QueueId<Contract>) => RemoteQueueControls<Requirements>;
  readonly status: Effect.Effect<
    ControlResponse<unknown>,
    ProcessManagerRequestError,
    Requirements
  >;
}

/**
 * Injectable endpoint service for one remote ProcessGroup.
 *
 * @effect-expect-leaking HttpClient.HttpClient Remote requests need an HttpClient
 * configured at the application's edge.
 *
 * @public
 */
export interface ProcessManagerEndpoint<
  Self,
  Id extends string,
  Contract extends AnyProcessGroupContract,
  ManagerRequirements = HttpClient.HttpClient,
  Error = never,
  Requirements = never,
> extends Context.ServiceClass<Self, Id, RemoteProcessManager<Contract, ManagerRequirements>> {
  readonly group: ContractSource<Contract>;
  readonly contract: Contract;
  readonly config: ProcessManagerEndpointConfig | undefined;
  readonly layer: Layer.Layer<Self, Error, Requirements>;
}

const requestErrorFromTransport = (
  error: ControlTransportError,
): ProcessManagerRequestError =>
  requestError(error.reason, error.status);

const requestProtocol = <R>(
  transport: ControlTransportClientShape<R>,
  request: ControlProtocolRequest,
  metadata?: ControlProtocolMetadata,
) =>
  Effect.flatMap(
    makeControlProtocolRequestEnvelope(request, metadata),
    (envelope) => transport.request(envelope),
  ).pipe(
    Effect.map((envelope) => envelope.response),
    Effect.mapError(requestErrorFromTransport),
  );

const requestContract = <R>(
  transport: ControlTransportClientShape<R>,
): Effect.Effect<typeof ProcessGroupContractSchema.Type, ProcessManagerRequestError, R> =>
  requestProtocol(transport, { _tag: "GetContract" }).pipe(
    Effect.flatMap((response) => {
      if (response._tag !== "Contract") {
        return Effect.fail(
          requestError("Remote contract response had the wrong protocol tag", response.status),
        );
      }
      if (response.status < 200 || response.status >= 300) {
        return Effect.fail(requestError(`HTTP ${response.status}`, response.status));
      }
      return Schema.decodeUnknownEffect(ProcessGroupContractSchema)(response.body).pipe(
        Effect.mapError(
          (cause) =>
            requestError(`Malformed group contract: ${String(cause)}`),
        ),
      );
    }),
  );

const requestControl = <R>(
  transport: ControlTransportClientShape<R>,
  request: ControlProtocolRequest,
): Effect.Effect<ControlResponse<unknown>, ProcessManagerRequestError, R> =>
  requestProtocol(transport, request).pipe(
    Effect.flatMap((response) => {
      if (response._tag !== "Control") {
        return Effect.fail(
          requestError("Remote control response had the wrong protocol tag", response.status),
        );
      }
      if (response.status >= 200 && response.status < 300 && response.body.success) {
        return Effect.succeed(response.body);
      }
      return Effect.fail(
        requestError(response.body.error ?? `HTTP ${response.status}`, response.status),
      );
    }),
  );

const commandVoid = <R>(
  transport: ControlTransportClientShape<R>,
  request: ControlProtocolRequest,
): Effect.Effect<void, ProcessManagerRequestError, R> =>
  Effect.asVoid(requestControl(transport, request));

interface ContractEntity {
  readonly id: string;
  readonly controls: ReadonlyArray<string>;
}

const sameStringSet = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
};

const describeMembers = (members: ReadonlyArray<string>): string =>
  members.length === 0 ? "(none)" : members.join(", ");

const findEntity = (
  entities: ReadonlyArray<ContractEntity>,
  id: string,
): ContractEntity | undefined =>
  entities.find((entity) => entity.id === id);

const assertEntitiesMatch = (
  kind: "process" | "queue",
  expected: ReadonlyArray<ContractEntity>,
  remote: ReadonlyArray<ContractEntity>,
): Effect.Effect<void, ProcessManagerRequestError> =>
  Effect.gen(function* () {
    const expectedIds = expected.map((entity) => entity.id);
    const remoteIds = remote.map((entity) => entity.id);
    if (!sameStringSet(
      expectedIds,
      remoteIds,
    )) {
      return yield* requestError(
        `Remote ${kind} ids '${describeMembers(remoteIds)}' did not match '${describeMembers(expectedIds)}'`,
      );
    }

    for (const expectedEntity of expected) {
      const remoteEntity = findEntity(remote, expectedEntity.id);
      if (
        remoteEntity === undefined ||
        !sameStringSet(expectedEntity.controls, remoteEntity.controls)
      ) {
        return yield* requestError(`Remote ${kind} '${expectedEntity.id}' controls did not match`);
      }
    }
  });

type DecodedQueueContract = (typeof ProcessGroupContractSchema.Type)["queues"][number];

const assertQueueItemCodecsMatch = (
  expected: ReadonlyArray<DecodedQueueContract>,
  remote: ReadonlyArray<DecodedQueueContract>,
): Effect.Effect<void, ProcessManagerRequestError> =>
  Effect.gen(function* () {
    for (const exp of expected) {
      const rem = remote.find((q) => q.id === exp.id);
      if (rem === undefined) continue;
      const expItem = exp.item;
      const remItem = rem.item;
      if (expItem === undefined && remItem === undefined) continue;
      if (expItem === undefined || remItem === undefined) {
        return yield* requestError(
          `Remote queue '${exp.id}' item codec metadata did not match (one side missing item contract data)`,
        );
      }
      if (expItem.id !== remItem.id || expItem.version !== remItem.version) {
        return yield* requestError(
          `Remote queue '${exp.id}' item codec id/version did not match local '${expItem.id}'@${expItem.version} vs remote '${remItem.id}'@${remItem.version}`,
        );
      }
      if (expItem.encoding !== remItem.encoding) {
        return yield* requestError(`Remote queue '${exp.id}' item codec encoding did not match`);
      }
    }
  });

const assertContractMatches = (
  expected: AnyProcessGroupContract,
  remote: typeof ProcessGroupContractSchema.Type,
): Effect.Effect<void, ProcessManagerRequestError> =>
  Effect.gen(function* () {
    if (remote.id !== expected.id) {
      return yield* requestError(`Remote contract id '${remote.id}' did not match '${expected.id}'`);
    }
    if (remote.version !== expected.version) {
      return yield* requestError(`Remote contract version '${remote.version}' did not match '${expected.version}'`);
    }

    yield* assertEntitiesMatch("process", expected.processes, remote.processes);
    yield* assertEntitiesMatch("queue", expected.queues, remote.queues);
    yield* assertQueueItemCodecsMatch(expected.queues, remote.queues);
  });

const makeRemoteProcessManager = <
  const Contract extends AnyProcessGroupContract,
  Requirements,
>(
  transport: ControlTransportClientShape<Requirements>,
  contract: Contract,
): RemoteProcessManager<Contract, Requirements> => {
  const fetchContract = requestContract(transport);

  return {
    contract,
    fetchContract,
    verifyContract: Effect.gen(function* () {
      const remote = yield* fetchContract;
      yield* assertContractMatches(contract, remote);
    }),
    process: (id) => ({
      start: commandVoid(transport, { _tag: "StartProcess", processId: id }),
      stop: commandVoid(transport, { _tag: "StopProcess", processId: id }),
      restart: commandVoid(transport, { _tag: "RestartProcess", processId: id }),
      runImmediately: commandVoid(transport, {
        _tag: "RunProcessImmediately",
        processId: id,
      }),
      status: requestControl(transport, {
        _tag: "ReadProcessStatus",
        processId: id,
      }),
    }),
    queue: (id) => ({
      start: commandVoid(transport, { _tag: "StartQueue", queueId: id }),
      pause: commandVoid(transport, { _tag: "PauseQueue", queueId: id }),
      resume: commandVoid(transport, { _tag: "ResumeQueue", queueId: id }),
      clear: requestControl(transport, { _tag: "ClearQueue", queueId: id }),
      status: requestControl(transport, {
        _tag: "ReadQueueStatus",
        queueId: id,
      }),
    }),
    status: requestControl(transport, { _tag: "ReadGroupStatus" }),
  };
};

const makeConnectionRegistryLayer = <
  const Groups extends readonly ConnectionSource<AnyProcessGroupContract>[],
>(
  _groups: Groups,
  connections: ProcessManagerConnectionMap<Groups>,
): Layer.Layer<ProcessManagerConnectionRegistry> => {
  const baseUrls = new Map<string, string>();
  for (const [groupId, baseUrl] of Object.entries(connections)) {
    if (typeof baseUrl === "string") {
      baseUrls.set(groupId, baseUrl);
    }
  }
  return Layer.succeed(ProcessManagerConnectionRegistry, {
    baseUrl: (groupId) => {
      const baseUrl = baseUrls.get(groupId);
      if (baseUrl === undefined) {
        return Effect.fail(
          new ProcessManagerConnectionError({
            groupId,
            reason: `Group '${groupId}' is not registered in this connection registry`,
          }),
        );
      }
      return Effect.succeed(baseUrl);
    },
  });
};

const makeConnectionRegistryConfigLayer = <
  const Groups extends readonly ConnectionSource<AnyProcessGroupContract>[],
>(
  _groups: Groups,
  connections: ProcessManagerConnectionConfigMap<Groups>,
) =>
  Layer.effect(ProcessManagerConnectionRegistry)(
    Effect.gen(function* () {
      const provider = yield* ConfigProvider.ConfigProvider;
      const baseUrls = new Map<string, string>();
      for (const [groupId, cfg] of Object.entries(connections)) {
        const baseUrl = yield* cfg.parse(provider);
        baseUrls.set(groupId, baseUrl);
      }
      return {
        baseUrl: (groupId) => {
          const baseUrl = baseUrls.get(groupId);
          if (baseUrl === undefined) {
            return Effect.fail(
              new ProcessManagerConnectionError({
                groupId,
                reason: `Group '${groupId}' is not registered in this connection registry`,
              }),
            );
          }
          return Effect.succeed(baseUrl);
        },
      };
    }),
  );

const hasConnectionId = (
  source: ContractSource<AnyProcessGroupContract>,
): source is ConnectionSource<AnyProcessGroupContract> =>
  "id" in source && typeof source.id === "string";

const connectFromRegistry = <
  Source extends ConnectionSource<AnyProcessGroupContract>,
>(
  source: Source,
): Effect.Effect<
  RemoteProcessManager<ContractFromSource<Source>>,
  ProcessManagerConnectionError,
  ProcessManagerConnectionRegistry
> =>
  Effect.gen(function* () {
    const registry = yield* ProcessManagerConnectionRegistry;
    const baseUrl = yield* registry.baseUrl(source.id);
    return makeRemoteProcessManager(
      makeControlTransportHttpClient({ baseUrl }),
      source.contract,
    );
  });

const connectFromTransportService = <
  Source extends ContractSource<AnyProcessGroupContract>,
>(
  source: Source,
): Effect.Effect<
  RemoteProcessManager<ContractFromSource<Source>, never>,
  never,
  ControlTransportClientTag
> =>
  Effect.map(
    ControlTransportClientTag,
    (transport) => makeRemoteProcessManager(transport, source.contract),
  );

const targetCandidatesFrom = (
  groups: ReadonlyArray<ConfigSource>,
): ReadonlyArray<ProcessManagerTargetCandidate> =>
  groups.flatMap((group) => [
    ...group.contract.processes.map((process) => ({
      id: process.id,
      kind: "process" as const,
      groupId: group.id,
      controls: process.controls,
    })),
    ...group.contract.queues.map((queue) => ({
      id: queue.id,
      kind: "queue" as const,
      groupId: group.id,
      controls: queue.controls,
    })),
  ]);

const selectEndpoint = (
  config: ProcessManagerGroupConfig,
  label: string | undefined,
): Effect.Effect<ProcessManagerEndpointSelection, ProcessManagerEndpointConfigError> => {
  const selectedLabel = label ?? config.defaultEndpoint;
  const selected = config.endpoints.find((endpoint) => endpoint.label === selectedLabel);
  return selected === undefined
    ? Effect.fail(
        new ProcessManagerEndpointConfigError({
          reason: `Group '${config.groupId}' does not declare endpoint '${selectedLabel}'. Available endpoints: ${
            config.endpoints.map((endpoint) => endpoint.label).join(", ")
          }`,
        }),
      )
    : Effect.succeed(selected);
};

const hasBundledEndpointConfig = (
  group: ConfigSource,
): group is ConfigSource & { readonly config: readonly ProcessManagerGroupConfigItem[] } =>
  Array.isArray(group.config) && endpointItemsFrom(group.config).length > 0;

const bundledGroupConfig = (
  group: ConfigSource,
): Effect.Effect<ProcessManagerGroupConfig, ProcessManagerEndpointConfigError> =>
  hasBundledEndpointConfig(group)
    ? GroupConfig(group, group.config)
    : Effect.fail(
        new ProcessManagerEndpointConfigError({
          reason: `Group '${group.id}' does not have bundled ProcessManager endpoint config`,
        }),
      );

const managerFromEndpoint = (
  group: ConfigSource,
  selected: ProcessManagerEndpointSelection,
): Effect.Effect<
  RemoteProcessManager<AnyProcessGroupContract>,
  ProcessManagerEndpointConfigError
> => {
  switch (selected.endpoint._tag) {
    case "ProcessManagerHttpEndpoint":
    case "ProcessManagerChildEndpoint":
      return Effect.succeed(
        makeRemoteProcessManager(
          makeControlTransportHttpClient({ baseUrl: selected.endpoint.transport.baseUrl }),
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
};

const isContractDriftError = (error: ProcessManagerRequestError): boolean =>
  error.reason.includes("did not match") ||
  error.reason.includes("Malformed group contract");

const probeEndpointStatus = (
  group: ConfigSource,
  selected: ProcessManagerEndpointSelection,
): Effect.Effect<ProcessManagerGroupEndpointStatus, never, HttpClient.HttpClient> => {
  const endpoint = selected.endpoint;
  switch (endpoint._tag) {
    case "ProcessManagerHttpEndpoint":
      return Effect.gen(function* () {
        const manager = makeRemoteProcessManager(
          makeControlTransportHttpClient({ baseUrl: endpoint.transport.baseUrl }),
          group.contract,
        );
        yield* manager.verifyContract;
        return { _tag: "Online" as const };
      }).pipe(
        Effect.catch((error: ProcessManagerRequestError) =>
          Effect.succeed(
            isContractDriftError(error)
              ? {
                  _tag: "ContractDrift" as const,
                  reason: error.reason,
                }
              : {
                  _tag: "Offline" as const,
                  reason: error.reason,
                  ...(error.status === undefined ? {} : { status: error.status }),
                },
          )
        ),
      );
    case "ProcessManagerChildEndpoint":
      return probeEndpointStatus(group, {
        ...selected,
        endpoint: {
          _tag: "ProcessManagerHttpEndpoint",
          transport: endpoint.transport,
        },
      });
  }
};

const asOptionalGroupConfig = (
  config: ProcessManagerGroupConfig,
): ProcessManagerGroupConfig | undefined => config;

const managerFor = (
  groups: ReadonlyArray<ConfigSource>,
  groupId: string,
  endpointLabel?: string,
): Effect.Effect<
  RemoteProcessManager<AnyProcessGroupContract>,
  ProcessManagerConnectionError | ProcessManagerEndpointConfigError,
  ProcessManagerConnectionRegistry
> => {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (group === undefined) {
    return Effect.fail(
      new ProcessManagerConnectionError({
        groupId,
        reason: `Group '${groupId}' is not registered in this CLI`,
      }),
    );
  }
  return Effect.gen(function* () {
    const configOption = yield* Effect.serviceOption(ProcessManagerConfig);
    if (Option.isSome(configOption)) {
      const config = yield* configOption.value.groupConfig(group.id);
      const endpoint = yield* selectEndpoint(config, endpointLabel);
      return yield* managerFromEndpoint(group, endpoint);
    }
    if (hasBundledEndpointConfig(group) || endpointLabel !== undefined) {
      const config = yield* bundledGroupConfig(group);
      const endpoint = yield* selectEndpoint(config, endpointLabel);
      return yield* managerFromEndpoint(group, endpoint);
    }
    return yield* connectFromRegistry(group);
  });
};

const resolveGroup = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
): Effect.Effect<ConfigSource, ProcessManagerConnectionError> => {
  const normalizedInput = normalizeProcessManagerTarget(input);
  const indexed = groups.map((group) => ({
    group,
    normalizedId: normalizeProcessManagerTarget(group.id),
  }));
  const matches = indexed.filter(({ normalizedId }) =>
    normalizedId === normalizedInput || normalizedId.endsWith(`/${normalizedInput}`)
  );
  if (matches.length === 1) {
    return Effect.succeed(matches[0]!.group);
  }
  if (matches.length > 1) {
    return Effect.fail(
      new ProcessManagerConnectionError({
        groupId: "",
        reason: `Ambiguous group '${input}'. Candidates: ${matches.map(({ group }) => group.id).join(", ")}`,
      }),
    );
  }
  return Effect.fail(
    new ProcessManagerConnectionError({
      groupId: "",
      reason: `No group matched '${input}'`,
    }),
  );
};

const launchModuleEndpointForGroup = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
  endpointLabel: string | undefined,
): Effect.Effect<
  ProcessManagerRunState,
  ProcessManagerConnectionError | ProcessManagerEndpointConfigError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | HttpClient.HttpClient | Path.Path | Scope.Scope
> =>
  Effect.gen(function* () {
    const group = yield* resolveGroup(groups, input);
    const configOption = yield* Effect.serviceOption(ProcessManagerConfig);
    const config = Option.isSome(configOption)
      ? yield* configOption.value.groupConfig(group.id)
      : yield* bundledGroupConfig(group);
    const selected = yield* selectEndpoint(config, endpointLabel);
    const launch = yield* spawnEndpointLaunchConfig(group, selected);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const safeGroupId = safePathSegment(group.id);
    const runDirectory = launch.runDirectory ?? path.join(".effect-pm", "run", "groups");
    const runFile = path.join(runDirectory, `${safeGroupId}.json`);
    yield* fs.makeDirectory(runDirectory, { recursive: true }).pipe(
      Effect.mapError(
        (error) =>
          new ProcessManagerEndpointConfigError({
            reason: `Unable to create ProcessManager run directory '${runDirectory}': ${String(error)}`,
          }),
      ),
    );
    const existing = yield* readRunState(runFile);
    if (Option.isSome(existing)) {
      const running = yield* isPidRunning(existing.value.pid);
      if (running) {
        return existing.value;
      }
      yield* removeRunState(runFile);
    }
    const pid = yield* launchDetachedProcess(launch);
    const startedAtMs = yield* Clock.currentTimeMillis;
    const state: ProcessManagerRunState = {
      args: launch.args,
      command: launch.command,
      controlBaseUrl: launch.control.transport.baseUrl,
      ...(launch.cwd === undefined ? {} : { cwd: launch.cwd }),
      endpointLabel: selected.label,
      groupId: group.id,
      pid,
      startedAt: DateTime.formatIso(DateTime.makeUnsafe(startedAtMs)),
    };
    yield* writeRunState(runFile, state);
    yield* waitForEndpointReady(group, launch);
    return state;
  });

const stopModuleEndpointForGroup = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
  endpointLabel: string | undefined,
): Effect.Effect<
  { readonly _tag: "Stopped" | "Stale"; readonly pid: number; readonly groupId: string },
  ProcessManagerConnectionError | ProcessManagerEndpointConfigError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const group = yield* resolveGroup(groups, input);
    const configOption = yield* Effect.serviceOption(ProcessManagerConfig);
    const config = Option.isSome(configOption)
      ? yield* configOption.value.groupConfig(group.id)
      : yield* bundledGroupConfig(group);
    const selected = yield* selectEndpoint(config, endpointLabel);
    const launch = yield* spawnEndpointLaunchConfig(group, selected);
    const runFile = yield* runStateFileFor(group, launch);
    const stateOption = yield* readRunState(runFile);
    if (Option.isNone(stateOption)) {
      return yield* new ProcessManagerEndpointConfigError({
        reason: `Group '${group.id}' does not have recorded run state`,
      });
    }
    const state = stateOption.value;
    const running = yield* isPidRunning(state.pid);
    yield* removeRunState(runFile);
    if (!running) {
      return {
        _tag: "Stale" as const,
        groupId: group.id,
        pid: state.pid,
      };
    }
    yield* signalPid(state.pid, "SIGTERM");
    return {
      _tag: "Stopped" as const,
      groupId: group.id,
      pid: state.pid,
    };
  });


const resolveGroupControlBaseUrl = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
  endpointLabel: string | undefined,
): Effect.Effect<
  string,
  ProcessManagerConnectionError | ProcessManagerEndpointConfigError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const group = yield* resolveGroup(groups, input);
    const configOption = yield* Effect.serviceOption(ProcessManagerConfig);
    const config = Option.isSome(configOption)
      ? yield* configOption.value.groupConfig(group.id)
      : yield* bundledGroupConfig(group);
    const selected = yield* selectEndpoint(config, endpointLabel);
    const launch = yield* spawnEndpointLaunchConfig(group, selected);
    const runFile = yield* runStateFileFor(group, launch);
    const stateOption = yield* readRunState(runFile);
    if (Option.isSome(stateOption)) {
      return stateOption.value.controlBaseUrl;
    }
    return launch.control.transport.baseUrl;
  });

const formatAmbiguousTarget = (
  input: string,
  candidates: ReadonlyArray<{
    readonly candidate: ProcessManagerTargetCandidate;
    readonly minimumSuffix: string;
  }>,
): string => {
  const rows = candidates
    .map(({ candidate, minimumSuffix }) =>
      `${candidate.kind}\t[${minimumSuffix}]\t${candidate.id}`
    )
    .join("\n");
  return (
    `Ambiguous target '${input}'.\nKIND\tTYPE THIS MINIMUM\tCANONICAL ID\n${rows}\n` +
    "Disambiguate with a longer suffix from TYPE THIS MINIMUM or the full CANONICAL ID."
  );
};

/** Shown when no target ID matches */
const cliHintNoTargetMatch =
  "Try `ls` for process and queue ids, or `groups` for group endpoints. " +
  "Use a full canonical id or a normalized suffix that matches exactly one target.";

/** Shown when the imported contract omits a control (local check before HTTP). */
const cliHintContractSource =
  "Controls come from your imported group contract. Run `verify` to compare each remote group to that contract.";

const cliFooterGroups =
  "Each row pairs a declared group id with the selected endpoint label and transport target.";

const cliFooterList =
  "IDs are canonical. Short CLI targets must match exactly one entry across all listed groups.";
const cliFooterVerify =
  "Compared each group's remote GET /contract payload to the imported local contract.";

const formatEndpointStatus = (status: ProcessManagerGroupEndpointStatus): string =>
  status._tag === "Online"
    ? "online"
    : status._tag === "Configured"
      ? "configured"
      : status._tag === "Pending"
        ? "pending"
        : status._tag === "ContractDrift"
          ? `contract-drift: ${status.reason}`
          : `offline: ${status.reason}`;

const prettyPrintCliJsonLine = (minifiedJson: string): string => {
  try {
    return JSON.stringify(JSON.parse(minifiedJson), null, 2);
  } catch {
    return minifiedJson;
  }
};
const encodeCliJson = (
  value: unknown,
): Effect.Effect<string, ProcessManagerRequestError> =>
  Schema.encodeUnknownEffect(responseBodyJson)(value).pipe(
    Effect.mapError(
      (cause) =>
        requestError(`Unable to encode CLI JSON output: ${String(cause)}`),
    ),
  );

const resolveCliTarget = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
  expectedKind: "process" | "queue",
): Effect.Effect<ProcessManagerTargetCandidate, ProcessManagerConnectionError> => {
  const resolution = resolveProcessManagerTarget(input, targetCandidatesFrom(groups));
  if (resolution._tag === "Missing") {
    return Effect.fail(
      new ProcessManagerConnectionError({
        groupId: "",
        reason: `No process or queue target matched '${input}'. ${cliHintNoTargetMatch}`,
      }),
    );
  }
  if (resolution._tag === "Ambiguous") {
    return Effect.fail(
      new ProcessManagerConnectionError({
        groupId: "",
        reason: formatAmbiguousTarget(input, resolution.candidates),
      }),
    );
  }
  if (resolution.candidate.kind !== expectedKind) {
    const processHint = "use start, stop, restart, or now with a process id.";
    const queueHint =
      "use queue-start, pause, resume, or clear with a queue id.";
    return Effect.fail(
      new ProcessManagerConnectionError({
        groupId: resolution.candidate.groupId,
        reason: `Target '${input}' is a ${resolution.candidate.kind}, not a ${expectedKind}. Hint: ${
          expectedKind === "queue" ? queueHint : processHint
        }`,
      }),
    );
  }
  return Effect.succeed(resolution.candidate);
};

const assertTargetControl = (
  target: ProcessManagerTargetCandidate,
  control: string,
): Effect.Effect<void, ProcessManagerConnectionError> =>
  target.controls.includes(control)
    ? Effect.void
    : Effect.fail(
        new ProcessManagerConnectionError({
          groupId: target.groupId,
          reason:
            `${target.kind} '${target.id}' does not expose '${control}'. Available controls: ${target.controls.join(", ") || "(none)"}. ${cliHintContractSource}`,
        }),
      );

const processControlFor = (
  operation: "start" | "stop" | "restart" | "now",
): "start" | "stop" | "restart" | "runImmediately" =>
  operation === "now" ? "runImmediately" : operation;

const targetResolutionError = (
  input: string,
  groups: ReadonlyArray<ConfigSource>,
): ProcessManagerConnectionError | undefined => {
  const resolution = resolveProcessManagerTarget(input, targetCandidatesFrom(groups));
  if (resolution._tag === "Missing") {
    return new ProcessManagerConnectionError({
      groupId: "",
      reason: `No process or queue target matched '${input}'. ${cliHintNoTargetMatch}`,
    });
  }
  if (resolution._tag === "Ambiguous") {
    return new ProcessManagerConnectionError({
      groupId: "",
      reason: formatAmbiguousTarget(input, resolution.candidates),
    });
  }
  return undefined;
};

const resolveCliAnyTarget = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
): Effect.Effect<ProcessManagerTargetCandidate, ProcessManagerConnectionError> => {
  const resolution = resolveProcessManagerTarget(input, targetCandidatesFrom(groups));
  if (resolution._tag === "Resolved") {
    return Effect.succeed(resolution.candidate);
  }
  const error = targetResolutionError(input, groups);
  return Effect.fail(
    error ??
      new ProcessManagerConnectionError({
        groupId: "",
        reason: `Unable to resolve target '${input}'`,
      }),
  );
};

const verifiedManagerForTarget = (
  groups: ReadonlyArray<ConfigSource>,
  target: ProcessManagerTargetCandidate,
  endpointLabel?: string,
): Effect.Effect<
  RemoteProcessManager<AnyProcessGroupContract>,
  ProcessManagerConnectionError | ProcessManagerRequestError | ProcessManagerEndpointConfigError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const manager = yield* managerFor(groups, target.groupId, endpointLabel);
    // CLI controls are contract-first: verify before every mutation/read so
    // stale imported contracts fail before the wrong remote operation runs.
    yield* manager.verifyContract;
    return manager;
  });

const runRemoteProcessOperation = (
  process: RemoteProcessControls,
  operation: "start" | "stop" | "restart" | "now",
) => {
  switch (operation) {
    case "start":
      return process.start;
    case "stop":
      return process.stop;
    case "restart":
      return process.restart;
    case "now":
      return process.runImmediately;
  }
};

const runRemoteQueueOperation = (
  queue: RemoteQueueControls,
  operation: "start" | "pause" | "resume" | "clear",
) => {
  switch (operation) {
    case "start":
      return queue.start;
    case "pause":
      return queue.pause;
    case "resume":
      return queue.resume;
    case "clear":
      return Effect.asVoid(queue.clear);
  }
};

const runProcessCommand = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
  operation: "start" | "stop" | "restart" | "now",
  options: Pick<ProcessManagerCliOptions, "endpointLabel">,
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerRequestError | ProcessManagerEndpointConfigError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const target = yield* resolveCliTarget(groups, input, "process");
    yield* assertTargetControl(target, processControlFor(operation));
    const manager = yield* verifiedManagerForTarget(groups, target, options.endpointLabel);
    yield* runRemoteProcessOperation(manager.process(target.id), operation);
    yield* Console.log(`OK process ${target.id} ${operation} requested`);
  });

const runQueueCommand = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
  operation: "start" | "pause" | "resume" | "clear",
  options: Pick<ProcessManagerCliOptions, "endpointLabel">,
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerRequestError | ProcessManagerEndpointConfigError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const target = yield* resolveCliTarget(groups, input, "queue");
    yield* assertTargetControl(target, operation);
    const manager = yield* verifiedManagerForTarget(groups, target, options.endpointLabel);
    yield* runRemoteQueueOperation(manager.queue(target.id), operation);
    yield* Console.log(`OK queue ${target.id} ${operation} requested`);
  });

const runStatusCommand = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
  options: ProcessManagerCliOptions,
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerRequestError | ProcessManagerEndpointConfigError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const target = yield* resolveCliAnyTarget(groups, input);
    yield* assertTargetControl(target, "status");
    const manager = yield* verifiedManagerForTarget(groups, target, options.endpointLabel);
    const response = target.kind === "process"
      ? yield* manager.process(target.id).status
      : yield* manager.queue(target.id).status;
    const data = yield* encodeCliJson(response.data ?? {});
    if (options.json) {
      const json = yield* encodeCliJson({
        kind: target.kind,
        id: target.id,
        groupId: target.groupId,
        status: response.data ?? {},
      });
      return yield* Console.log(json);
    }
    yield* Console.log(
      `STATUS ${target.kind} ${target.id}\n${prettyPrintCliJsonLine(data)}`,
    );
  });

const runVerifyCommand = (
  groups: ReadonlyArray<ConfigSource>,
  options: ProcessManagerCliOptions,
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerRequestError | ProcessManagerEndpointConfigError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const verified: Array<{ readonly groupId: string }> = [];
    for (const group of groups) {
      const manager = yield* managerFor(groups, group.id, options.endpointLabel);
      yield* manager.verifyContract;
      verified.push({ groupId: group.id });
      if (options.json) {
        continue;
      }
      yield* Console.log(`OK contract verified for ${group.id}`);
    }
    if (options.json) {
      yield* Console.log(yield* encodeCliJson({ groups: verified }));
    } else if (verified.length > 0) {
      yield* Console.log("");
      yield* Console.log(cliFooterVerify);
    }
  });

const runGroupStartCommand = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
  options: Pick<ProcessManagerCliOptions, "endpointLabel">,
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerEndpointConfigError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | HttpClient.HttpClient | Path.Path | Scope.Scope
> =>
  Effect.gen(function* () {
    const state = yield* launchModuleEndpointForGroup(groups, input, options.endpointLabel);
    yield* Console.log(
      `OK group ${state.groupId} started with pid ${String(state.pid)} at ${state.controlBaseUrl}`,
    );
  });


const stdinIsInteractive = (): boolean => {
  if (typeof process === "undefined") {
    return false;
  }
  const stdin = process.stdin;
  return typeof stdin !== "undefined" && stdin.isTTY === true;
};

const runGroupLogsCommand = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
  options: {
    readonly endpointLabel?: string;
    readonly lines: number;
    readonly interactive: boolean;
    readonly live: boolean;
  },
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerEndpointConfigError | ProcessManagerGroupLogError,
  FileSystem.FileSystem | HttpClient.HttpClient | Path.Path | Terminal
> =>
  Effect.gen(function* () {
    const controlBaseUrl = yield* resolveGroupControlBaseUrl(
      groups,
      input,
      options.endpointLabel,
    );
    if (!options.live && !options.interactive) {
      yield* Console.log(`Snapshot from ${controlBaseUrl} (up to ${String(options.lines)} lines)`);
    }
    yield* watchGroupLogs({
      controlBaseUrl,
      preludeLines: options.lines,
      interactive: options.interactive,
      live: options.live,
    });
  });

const runGroupStopCommand = (
  groups: ReadonlyArray<ConfigSource>,
  input: string,
  options: Pick<ProcessManagerCliOptions, "endpointLabel">,
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerEndpointConfigError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const result = yield* stopModuleEndpointForGroup(groups, input, options.endpointLabel);
    const verb = result._tag === "Stopped" ? "stopped" : "removed stale run state for";
    yield* Console.log(
      `OK group ${result.groupId} ${verb} pid ${String(result.pid)}`,
    );
  });

const runGroupsCommand = (
  groups: ReadonlyArray<ConfigSource>,
  options: ProcessManagerCliOptions,
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerRequestError | ProcessManagerEndpointConfigError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const rows: Array<{
      readonly groupId: string;
      readonly endpoint: string;
      readonly status: ProcessManagerGroupEndpointStatus;
      readonly target: string;
    }> = [];
    const lines: string[] = ["GROUP\tTARGET\tSTATUS\tENDPOINT"];
    for (const group of groups) {
      const configOption = yield* Effect.serviceOption(ProcessManagerConfig).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              hasBundledEndpointConfig(group) || options.endpointLabel !== undefined
                ? Effect.map(bundledGroupConfig(group), asOptionalGroupConfig)
                : Effect.sync((): ProcessManagerGroupConfig | undefined => undefined),
            onSome: (config) =>
              Effect.map(config.groupConfig(group.id), asOptionalGroupConfig),
          }),
        ),
      );
      if (configOption !== undefined) {
        const selected = yield* selectEndpoint(configOption, options.endpointLabel);
        const endpoint = selected.endpoint._tag === "ProcessManagerHttpEndpoint"
          ? selected.endpoint.transport.baseUrl
          : selected.endpoint._tag;
        const status = yield* probeEndpointStatus(group, selected);
        rows.push({ groupId: group.id, target: selected.label, endpoint, status });
        lines.push(`${group.id}\t${selected.label}\t${formatEndpointStatus(status)}\t${endpoint}`);
        continue;
      }
      const registry = yield* ProcessManagerConnectionRegistry;
      const baseUrl = yield* registry.baseUrl(group.id);
      const status: ProcessManagerGroupEndpointStatus = {
        _tag: "Configured",
        reason: "ConnectionRegistry endpoint configured; no endpoint config probe available",
      };
      rows.push({ groupId: group.id, target: "registry", endpoint: baseUrl, status });
      lines.push(`${group.id}\tregistry\t${formatEndpointStatus(status)}\t${baseUrl}`);
    }
    if (options.json) {
      yield* Console.log(yield* encodeCliJson({ groups: rows }));
      return;
    }
    yield* Console.log(`${lines.join("\n")}\n\n${cliFooterGroups}`);
  });

const runListCommand = (
  groups: ReadonlyArray<ConfigSource>,
  options: ProcessManagerCliOptions,
): Effect.Effect<void, ProcessManagerRequestError> =>
  Effect.gen(function* () {
    if (options.json) {
      const json = yield* encodeCliJson({
        groups: groups.map((group) => ({
          groupId: group.id,
          processes: group.contract.processes,
          queues: group.contract.queues,
        })),
      });
      return yield* Console.log(json);
    }
    const formatListedControls = (controls: ReadonlyArray<string>): string =>
      controls.length > 0 ? controls.join(", ") : "(none)";
    yield* Console.log(
      `${groups.map((group) => {
        const processLines = group.contract.processes.map(
          (process) =>
            `process\t${process.id}\t${formatListedControls(process.controls)}`,
        );
        const queueLines = group.contract.queues.map(
          (queue) =>
            `queue\t${queue.id}\t${formatListedControls(queue.controls)}`,
        );
        return [
          `GROUP ${group.id}`,
          "KIND\tID\tCONTROLS",
          ...processLines,
          ...queueLines,
        ].join("\n");
      }).join("\n\n")}\n\n${cliFooterList}`,
    );
  });

const makeCli = <
  const Groups extends readonly ConfigSource[],
>(
  groups: Groups,
  config: ProcessManagerCliConfig = {},
) => {
  const target = Argument.string("target");
  const jsonOption = Flag.boolean("json").pipe(Flag.withDefault(false));
  const endpointLabelOption = Flag.string("target").pipe(Flag.optional);
  const linesOption = Flag.integer("lines").pipe(Flag.withAlias("n"), Flag.withDefault(100));
  const snapshotOption = Flag.boolean("snapshot").pipe(Flag.withDefault(false));
  const noInteractiveOption = Flag.boolean("no-interactive").pipe(Flag.withDefault(false));
  const endpointLabelFrom = (endpointLabel: Option.Option<string>): string | undefined =>
    Option.isSome(endpointLabel) ? endpointLabel.value : undefined;
  const groupsCommand = Command.make("groups", { json: jsonOption, endpointLabel: endpointLabelOption }, ({ json, endpointLabel }) =>
    runGroupsCommand(groups, { json, endpointLabel: endpointLabelFrom(endpointLabel) })
  );
  const listCommand = Command.make("ls", { json: jsonOption }, ({ json }) =>
    runListCommand(groups, { json })
  );
  const verifyCommand = Command.make("verify", { json: jsonOption, endpointLabel: endpointLabelOption }, ({ json, endpointLabel }) =>
    runVerifyCommand(groups, { json, endpointLabel: endpointLabelFrom(endpointLabel) })
  );
  const groupStartCommand = Command.make("group-start", { target, endpointLabel: endpointLabelOption }, ({ target, endpointLabel }) =>
    runGroupStartCommand(groups, target, { endpointLabel: endpointLabelFrom(endpointLabel) })
  );
  const groupStopCommand = Command.make("group-stop", { target, endpointLabel: endpointLabelOption }, ({ target, endpointLabel }) =>
    runGroupStopCommand(groups, target, { endpointLabel: endpointLabelFrom(endpointLabel) })
  );
  const groupLogsCommand = Command.make(
    "group-logs",
    {
      target,
      endpointLabel: endpointLabelOption,
      lines: linesOption,
      snapshot: snapshotOption,
      noInteractive: noInteractiveOption,
    },
    ({ target, endpointLabel, lines, snapshot, noInteractive }) =>
      runGroupLogsCommand(groups, target, {
        endpointLabel: endpointLabelFrom(endpointLabel),
        lines,
        interactive: stdinIsInteractive() && !noInteractive,
        live: !snapshot,
      }),
  );
  const statusCommand = Command.make("status", { target, json: jsonOption, endpointLabel: endpointLabelOption }, ({ target, json, endpointLabel }) =>
    runStatusCommand(groups, target, { json, endpointLabel: endpointLabelFrom(endpointLabel) })
  );
  const processCommand = (
    name: "start" | "stop" | "restart" | "now",
    operation: "start" | "stop" | "restart" | "now",
  ) =>
    Command.make(name, { target, endpointLabel: endpointLabelOption }, ({ target, endpointLabel }) =>
      runProcessCommand(groups, target, operation, { endpointLabel: endpointLabelFrom(endpointLabel) })
    );
  const queueCommand = (name: "pause" | "resume" | "clear") =>
    Command.make(name, { target, endpointLabel: endpointLabelOption }, ({ target, endpointLabel }) =>
      runQueueCommand(groups, target, name, { endpointLabel: endpointLabelFrom(endpointLabel) }),
    );

  const queueStartCommand = Command.make("queue-start", { target, endpointLabel: endpointLabelOption }, ({ target, endpointLabel }) =>
    runQueueCommand(groups, target, "start", { endpointLabel: endpointLabelFrom(endpointLabel) }),
  );

  const root = Command.make(
    "pm",
    {},
    () =>
      Effect.logInfo(
        `${config.name ?? "ProcessManager CLI"}. Use \`pm --help\`; try \`pm ls\` or \`pm groups\` for targets (--json on read commands).`,
      ),
  ).pipe(
    Command.withSubcommands([
      groupsCommand,
      listCommand,
      verifyCommand,
      groupStartCommand,
      groupStopCommand,
      groupLogsCommand,
      statusCommand,
      processCommand("start", "start"),
      processCommand("stop", "stop"),
      processCommand("restart", "restart"),
      processCommand("now", "now"),
      queueStartCommand,
      queueCommand("pause"),
      queueCommand("resume"),
      queueCommand("clear"),
    ]),
  );

  return Command.runWith(root, {
    version: config.version ?? "0.0.0",
  });
};

function makeEndpoint<
  Self,
  const Id extends string,
  const Source extends ConnectionSource<AnyProcessGroupContract>,
>(
  id: Id,
  group: Source,
): ProcessManagerEndpoint<
  Self,
  Id,
  ContractFromSource<Source>,
  HttpClient.HttpClient,
  ProcessManagerConnectionError,
  ProcessManagerConnectionRegistry
>;
function makeEndpoint<
  Self,
  const Id extends string,
  const Source extends ContractSource<AnyProcessGroupContract>,
>(
  id: Id,
  group: Source,
  config: { readonly baseUrl: string },
): ProcessManagerEndpoint<Self, Id, ContractFromSource<Source>, HttpClient.HttpClient>;
function makeEndpoint<
  Self,
  const Id extends string,
  const Source extends ContractSource<AnyProcessGroupContract>,
>(
  id: Id,
  group: Source,
  config: { readonly transport: "context" },
): ProcessManagerEndpoint<
  Self,
  Id,
  ContractFromSource<Source>,
  never,
  never,
  ControlTransportClientTag
>;
function makeEndpoint<
  Self,
  const Id extends string,
  const Source extends ContractSource<AnyProcessGroupContract>,
>(
  id: Id,
  group: Source,
  config?: ProcessManagerEndpointConfig,
): ProcessManagerEndpoint<
  Self,
  Id,
  ContractFromSource<Source>,
  unknown,
  ProcessManagerConnectionError,
  ProcessManagerConnectionRegistry | ControlTransportClientTag
> {
  const base = Context.Service<
    Self,
    RemoteProcessManager<ContractFromSource<Source>, unknown>
  >()(id);
  const layer = config === undefined
    ? hasConnectionId(group)
      ? Layer.effect(base)(connectFromRegistry(group))
      : Layer.effect(base)(
          Effect.fail(
            new ProcessManagerConnectionError({
              groupId: group.contract.id,
              reason: "Endpoint without config requires a group service with an id",
            }),
          ),
        )
    : "baseUrl" in config
      ? Layer.succeed(base, connect(group, config))
      : Layer.effect(base)(connectFromTransportService(group));
  return Object.assign(base, {
    group,
    contract: group.contract,
    config,
    layer,
  });
}

/**
 * Build a typed remote client from a group service/definition value by reading
 * the group's URL from {@link ProcessManagerConnectionRegistry}.
 *
 * @public
 */
function connect<Source extends ConnectionSource<AnyProcessGroupContract>>(
  source: Source,
): Effect.Effect<
  RemoteProcessManager<ContractFromSource<Source>>,
  ProcessManagerConnectionError,
  ProcessManagerConnectionRegistry
>;

/**
 * Build a typed remote client from a group service/definition value. This is
 * the preferred Effect-style form when the group class is available at runtime.
 *
 * @public
 */
function connect<Source extends ContractSource<AnyProcessGroupContract>>(
  source: Source,
  options: {
    readonly baseUrl: string;
  },
): RemoteProcessManager<ContractFromSource<Source>>;

/**
 * Build a typed remote client from a group service/definition value and explicit
 * control transport.
 *
 * @public
 */
function connect<
  Source extends ContractSource<AnyProcessGroupContract>,
  Requirements,
>(
  source: Source,
  options: {
    readonly transport: ControlTransportClientShape<Requirements>;
  },
): RemoteProcessManager<ContractFromSource<Source>, Requirements>;

/**
 * Build a typed remote client from the ambient {@link ControlTransportClient}.
 *
 * @public
 */
function connect<Source extends ContractSource<AnyProcessGroupContract>>(
  source: Source,
  options: {
    readonly transport: "context";
  },
): Effect.Effect<
  RemoteProcessManager<ContractFromSource<Source>, never>,
  never,
  ControlTransportClientTag
>;

/**
 * Build a typed remote client from a raw contract. Use this form for generated
 * contracts or code that cannot import the group service class.
 *
 * @public
 */
function connect<const Contract extends AnyProcessGroupContract>(options: {
  readonly baseUrl: string;
  readonly contract: Contract;
}): RemoteProcessManager<Contract>;

/**
 * Build a typed remote client from a raw contract and explicit control
 * transport.
 *
 * @public
 */
function connect<
  const Contract extends AnyProcessGroupContract,
  Requirements,
>(options: {
  readonly transport: ControlTransportClientShape<Requirements>;
  readonly contract: Contract;
}): RemoteProcessManager<Contract, Requirements>;

function connect(
  sourceOrOptions:
    | ConnectionSource<AnyProcessGroupContract>
    | ContractSource<AnyProcessGroupContract>
    | {
        readonly baseUrl: string;
        readonly contract: AnyProcessGroupContract;
      }
    | {
        readonly transport: ControlTransportClientShape<unknown>;
        readonly contract: AnyProcessGroupContract;
      },
  options?: {
    readonly baseUrl: string;
  } | {
    readonly transport: ControlTransportClientShape<unknown>;
  } | {
    readonly transport: "context";
  },
):
  | RemoteProcessManager<AnyProcessGroupContract>
  | RemoteProcessManager<AnyProcessGroupContract, unknown>
  | Effect.Effect<
    RemoteProcessManager<AnyProcessGroupContract>,
    ProcessManagerConnectionError,
    ProcessManagerConnectionRegistry
  >
  | Effect.Effect<
    RemoteProcessManager<AnyProcessGroupContract, never>,
    never,
    ControlTransportClientTag
  >
{
  if (options !== undefined) {
    if ("baseUrl" in options) {
      return makeRemoteProcessManager(
        makeControlTransportHttpClient({ baseUrl: options.baseUrl }),
        sourceOrOptions.contract,
      );
    }
    if (options.transport === "context") {
      return connectFromTransportService(sourceOrOptions);
    }
    return makeRemoteProcessManager(options.transport, sourceOrOptions.contract);
  }
  if ("baseUrl" in sourceOrOptions) {
    return makeRemoteProcessManager(
      makeControlTransportHttpClient({ baseUrl: sourceOrOptions.baseUrl }),
      sourceOrOptions.contract,
    );
  }
  if ("transport" in sourceOrOptions) {
    return makeRemoteProcessManager(
      sourceOrOptions.transport,
      sourceOrOptions.contract,
    );
  }
  if ("id" in sourceOrOptions) {
    return connectFromRegistry(sourceOrOptions);
  }
  throw new TypeError("ProcessManager.connect requires connection options or a connection registry source");
}

function makeEndpointFactory<Self>() {
  /**
   * Endpoint services route remote control calls using `HttpClient` from the ambient context.
   *
   * @effect-expect-leaking HttpClient.HttpClient
   */
  function endpoint<const Source extends ConnectionSource<AnyProcessGroupContract>>(
    group: Source,
  ): ProcessManagerEndpoint<
    Self,
    Source["contract"]["id"],
    ContractFromSource<Source>,
    HttpClient.HttpClient,
    ProcessManagerConnectionError,
    ProcessManagerConnectionRegistry
  >;
  function endpoint<const Source extends ContractSource<AnyProcessGroupContract>>(
    group: Source,
    config: { readonly baseUrl: string },
  ): ProcessManagerEndpoint<
    Self,
    Source["contract"]["id"],
    ContractFromSource<Source>,
    HttpClient.HttpClient
  >;
  function endpoint<const Source extends ContractSource<AnyProcessGroupContract>>(
    group: Source,
    config: { readonly transport: "context" },
  ): ProcessManagerEndpoint<
    Self,
    Source["contract"]["id"],
    ContractFromSource<Source>,
    never,
    never,
    ControlTransportClientTag
  >;
  function endpoint(
    group: ContractSource<AnyProcessGroupContract>,
    config?: ProcessManagerEndpointConfig,
  ): ProcessManagerEndpoint<
    Self,
    string,
    AnyProcessGroupContract,
    unknown,
    ProcessManagerConnectionError,
    ProcessManagerConnectionRegistry | ControlTransportClientTag
  > {
    if (config === undefined) {
      if (!hasConnectionId(group)) {
        throw new TypeError("ProcessManager.Endpoint without config requires a group service with an id");
      }
      return makeEndpoint<Self, string, ConnectionSource<AnyProcessGroupContract>>(
        `${group.contract.id}/ProcessManagerEndpoint`,
        group,
      );
    }
    if ("baseUrl" in config) {
      return makeEndpoint<Self, string, ContractSource<AnyProcessGroupContract>>(
        `${group.contract.id}/ProcessManagerEndpoint`,
        group,
        config,
      );
    }
    return makeEndpoint<Self, string, ContractSource<AnyProcessGroupContract>>(
      `${group.contract.id}/ProcessManagerEndpoint`,
      group,
      config,
    );
  }
  return endpoint;
}

/**
 * Endpoint namespace for both endpoint-service factories and future
 * group-bundled endpoint config items.
 *
 * @remarks
 * The callable form remains the existing injectable endpoint service factory:
 * `ProcessManager.Endpoint<Self>()(Group)`. The attached helpers build labeled
 * endpoint config items for `ProcessGroup.Service(..., configItems)`.
 *
 * @public
 */
const childEndpointDefinition = (
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
  http: endpointHttp,

  local: (
    transport: ProcessManagerTransport,
    entry: string | ImportMeta,
  ): ProcessManagerEndpointConfigItem<"local", ProcessManagerChildEndpointDefinition, false> =>
    makeEndpointConfigItem("local", childEndpointDefinition(transport, entry), false),

  production: (
    transportOrDefinition: ProcessManagerTransport | ProcessManagerHttpEndpointDefinition,
  ): ProcessManagerEndpointConfigItem<"production", ProcessManagerHttpEndpointDefinition, false> =>
    makeEndpointConfigItem(
      "production",
      remoteEndpointFromTransport(transportFromEndpointInput(transportOrDefinition)),
      false,
    ),

  define: <const Label extends string>(
    label: Label,
    transportOrDefinition: ProcessManagerTransport | ProcessManagerHttpEndpointDefinition,
  ): ProcessManagerEndpointConfigItem<Label, ProcessManagerHttpEndpointDefinition, false> =>
    makeEndpointConfigItem(
      label,
      remoteEndpointFromTransport(transportFromEndpointInput(transportOrDefinition)),
      false,
    ),
});

/**
 * Remote ProcessManager namespace.
 *
 * @public
 */
/**
 * Default operator CLI logger (pretty console). Merge into the PM CLI runtime so
 * {@link watchGroupLogs} replays child entries with the same formatting as the operator.
 *
 * @public
 */
export const operatorLoggerLayer = Logger.layer([Logger.consolePretty()], {
  mergeWithExisting: true,
});

export const ProcessManager = {
  cli: makeCli,
  connect,
  ChildLaunch: {
    layerConfig: childLaunchLayerConfig,
    layerFromEnv: childLaunchLayerFromEnv,
    defaultPaths: defaultChildLaunchPaths,
    buildLaunchConfig: buildChildLaunchConfig,
  },
  /**
   * Layers required for operator commands (`group-start`, `group-stop`, `groups`, …).
   * Merge with Node platform layers (`NodeServices`, `NodeHttpClient`, …).
   */
  operatorLayer: childLaunchLayerFromEnv(),
  operatorLoggerLayer,
  ConnectionRegistry: {
    layer: makeConnectionRegistryLayer,
    layerConfig: makeConnectionRegistryConfigLayer,
  },
  Config: {
    layer: makeProcessManagerConfigLayer,
  },
  GroupConfig,
  Endpoint,
  Transport,
  groupLocalRuntime,
};

export type { ProcessManagerRunState } from "./processManagerRunState.js";
