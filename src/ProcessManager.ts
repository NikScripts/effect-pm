/**
 * **ProcessManager** — typed remote client for ProcessGroup control surfaces.
 *
 * @remarks
 * A manager does not own local process or queue internals. It connects to a
 * `ControlService` exposed by a `ProcessGroup`, uses the group's schema-backed
 * contract for typed IDs, and routes supported controls over HTTP.
 *
 * @module ProcessManager
 */

import { Config, Console, Context, Data, Effect, Layer, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type { ControlResponse } from "./ControlService";
import { ProcessGroupContractSchema } from "./ProcessGroup";
import type {
  ProcessGroupContract,
  ProcessGroupEntry,
} from "./ProcessGroup";
import {
  resolveProcessManagerTarget,
  type ProcessManagerTargetCandidate,
} from "./ProcessManagerTargetResolver";
import { responseBodyJson } from "./internal/json";

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
export interface ProcessManagerEndpointConfig {
  readonly baseUrl: string;
}

const controlResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  type: Schema.optional(Schema.Literals(["process", "queue"] as const)),
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
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

const requestErrorFromCause = (
  cause: unknown,
  status?: number,
): ProcessManagerRequestError => requestError(String(cause), status);

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
}

/**
 * Remote controls for one process ID from a group contract.
 *
 * @public
 */
export interface RemoteProcessControls {
  readonly start: Effect.Effect<void, ProcessManagerRequestError, HttpClient.HttpClient>;
  readonly stop: Effect.Effect<void, ProcessManagerRequestError, HttpClient.HttpClient>;
  readonly restart: Effect.Effect<void, ProcessManagerRequestError, HttpClient.HttpClient>;
  readonly runImmediately: Effect.Effect<void, ProcessManagerRequestError, HttpClient.HttpClient>;
  readonly status: Effect.Effect<
    ControlResponse<unknown>,
    ProcessManagerRequestError,
    HttpClient.HttpClient
  >;
}

/**
 * Remote controls for one queue ID from a group contract.
 *
 * @public
 */
export interface RemoteQueueControls {
  readonly pause: Effect.Effect<void, ProcessManagerRequestError, HttpClient.HttpClient>;
  readonly resume: Effect.Effect<void, ProcessManagerRequestError, HttpClient.HttpClient>;
  readonly clear: Effect.Effect<
    ControlResponse<unknown>,
    ProcessManagerRequestError,
    HttpClient.HttpClient
  >;
  readonly status: Effect.Effect<
    ControlResponse<unknown>,
    ProcessManagerRequestError,
    HttpClient.HttpClient
  >;
}

/**
 * Typed remote client for a single ProcessGroup contract.
 *
 * @public
 */
export interface RemoteProcessManager<Contract extends AnyProcessGroupContract> {
  readonly contract: Contract;
  readonly fetchContract: Effect.Effect<
    typeof ProcessGroupContractSchema.Type,
    ProcessManagerRequestError,
    HttpClient.HttpClient
  >;
  /**
   * Fetch the remote group contract and compare group id, version, process ids,
   * queue ids, and exposed control sets with the local contract.
   */
  readonly verifyContract: Effect.Effect<void, ProcessManagerRequestError, HttpClient.HttpClient>;
  readonly process: (id: ProcessId<Contract>) => RemoteProcessControls;
  readonly queue: (id: QueueId<Contract>) => RemoteQueueControls;
  readonly status: Effect.Effect<
    ControlResponse<unknown>,
    ProcessManagerRequestError,
    HttpClient.HttpClient
  >;
}

/**
 * Injectable endpoint service for one remote ProcessGroup.
 *
 * @public
 */
export interface ProcessManagerEndpoint<
  Self,
  Id extends string,
  Contract extends AnyProcessGroupContract,
  Error = never,
  Requirements = never,
> extends Context.ServiceClass<Self, Id, RemoteProcessManager<Contract>> {
  readonly group: ContractSource<Contract>;
  readonly contract: Contract;
  readonly config: ProcessManagerEndpointConfig | undefined;
  readonly layer: Layer.Layer<Self, Error, Requirements>;
}

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}${path}`;

const decodeJsonResponse = (
  responseText: string,
): Effect.Effect<unknown, ProcessManagerRequestError> =>
  Schema.decodeUnknownEffect(responseBodyJson)(responseText).pipe(
    Effect.mapError(
      (cause) =>
        requestError(`Malformed JSON response: ${String(cause)}`),
    ),
  );

const getJson = (
  baseUrl: string,
  path: string,
): Effect.Effect<unknown, ProcessManagerRequestError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      HttpClientRequest.get(joinUrl(baseUrl, path)),
    ).pipe(
      Effect.mapError(
        requestErrorFromCause,
      ),
    );
    const text = yield* response.text.pipe(
      Effect.mapError(
        (cause) => requestErrorFromCause(cause, response.status),
      ),
    );
    const json = yield* decodeJsonResponse(text);
    if (response.status >= 200 && response.status < 300) {
      return json;
    }
    return yield* requestError(`HTTP ${response.status}`, response.status);
  });

const decodeControlResponse = (
  json: unknown,
  status: number,
): Effect.Effect<ControlResponse<unknown>, ProcessManagerRequestError> =>
  Schema.decodeUnknownEffect(controlResponseSchema)(json).pipe(
    Effect.mapError(
      (cause) =>
        requestError(`Malformed control response: ${String(cause)}`, status),
    ),
  );

const getControl = (
  baseUrl: string,
  path: string,
): Effect.Effect<
  ControlResponse<unknown>,
  ProcessManagerRequestError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      HttpClientRequest.get(joinUrl(baseUrl, path)),
    ).pipe(
      Effect.mapError(
        requestErrorFromCause,
      ),
    );
    const json = yield* response.json.pipe(
      Effect.mapError(
        (cause) => requestErrorFromCause(cause, response.status),
      ),
    );
    const decoded = yield* decodeControlResponse(json, response.status);
    if (response.status >= 200 && response.status < 300 && decoded.success) {
      return decoded;
    }
    return yield* requestError(decoded.error ?? `HTTP ${response.status}`, response.status);
  });

const postControl = (
  baseUrl: string,
  path: string,
  body: unknown = {},
): Effect.Effect<
  ControlResponse<unknown>,
  ProcessManagerRequestError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(joinUrl(baseUrl, path)),
      body,
    ).pipe(
      Effect.mapError(
        requestErrorFromCause,
      ),
    );
    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError(
        requestErrorFromCause,
      ),
    );
    const json = yield* response.json.pipe(
      Effect.mapError(
        (cause) => requestErrorFromCause(cause, response.status),
      ),
    );
    const decoded = yield* decodeControlResponse(json, response.status);
    if (response.status >= 200 && response.status < 300 && decoded.success) {
      return decoded;
    }
    return yield* requestError(decoded.error ?? `HTTP ${response.status}`, response.status);
  });

const commandVoid = (
  baseUrl: string,
  path: string,
): Effect.Effect<void, ProcessManagerRequestError, HttpClient.HttpClient> =>
  Effect.asVoid(postControl(baseUrl, path));

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
>(
  baseUrl: string,
  contract: Contract,
): RemoteProcessManager<Contract> => {
  const fetchContract = getJson(baseUrl, "/contract").pipe(
    Effect.flatMap((json) =>
      Schema.decodeUnknownEffect(ProcessGroupContractSchema)(json).pipe(
        Effect.mapError(
          (cause) =>
            requestError(`Malformed group contract: ${String(cause)}`),
        ),
      ),
    ),
  );

  return {
    contract,
    fetchContract,
    verifyContract: Effect.gen(function* () {
      const remote = yield* fetchContract;
      yield* assertContractMatches(contract, remote);
    }),
    process: (id) => ({
      start: commandVoid(baseUrl, `/processes/${encodeURIComponent(id)}/start`),
      stop: commandVoid(baseUrl, `/processes/${encodeURIComponent(id)}/stop`),
      restart: commandVoid(baseUrl, `/processes/${encodeURIComponent(id)}/restart`),
      runImmediately: commandVoid(baseUrl, `/processes/${encodeURIComponent(id)}/now`),
      status: getControl(baseUrl, `/processes/${encodeURIComponent(id)}`),
    }),
    queue: (id) => ({
      pause: commandVoid(baseUrl, `/queues/${encodeURIComponent(id)}/pause`),
      resume: commandVoid(baseUrl, `/queues/${encodeURIComponent(id)}/resume`),
      clear: postControl(baseUrl, `/queues/${encodeURIComponent(id)}/clear`),
      status: getControl(baseUrl, `/queues/${encodeURIComponent(id)}`),
    }),
    status: getControl(baseUrl, "/status"),
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
      const baseUrls = new Map<string, string>();
      for (const [groupId, config] of Object.entries(connections)) {
        const baseUrl = yield* config;
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
    return makeRemoteProcessManager(baseUrl, source.contract);
  });

const targetCandidatesFrom = (
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
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

const managerFor = (
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
  groupId: string,
): Effect.Effect<
  RemoteProcessManager<AnyProcessGroupContract>,
  ProcessManagerConnectionError,
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
  return connectFromRegistry(group);
};

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
  return `Ambiguous target '${input}'.\nKIND\tTYPE THIS MINIMUM\tCANONICAL ID\n${rows}`;
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
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
  input: string,
  expectedKind: "process" | "queue",
): Effect.Effect<ProcessManagerTargetCandidate, ProcessManagerConnectionError> => {
  const resolution = resolveProcessManagerTarget(input, targetCandidatesFrom(groups));
  if (resolution._tag === "Missing") {
    return Effect.fail(
      new ProcessManagerConnectionError({
        groupId: "",
        reason: `No process or queue target matched '${input}'`,
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
    return Effect.fail(
      new ProcessManagerConnectionError({
        groupId: resolution.candidate.groupId,
        reason: `Target '${input}' is a ${resolution.candidate.kind}, not a ${expectedKind}`,
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
            `${target.kind} '${target.id}' does not expose '${control}'. Available controls: ${target.controls.join(", ") || "(none)"}`,
        }),
      );

const processControlFor = (
  operation: "start" | "stop" | "restart" | "now",
): "start" | "stop" | "restart" | "runImmediately" =>
  operation === "now" ? "runImmediately" : operation;

const targetResolutionError = (
  input: string,
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
): ProcessManagerConnectionError | undefined => {
  const resolution = resolveProcessManagerTarget(input, targetCandidatesFrom(groups));
  if (resolution._tag === "Missing") {
    return new ProcessManagerConnectionError({
      groupId: "",
      reason: `No process or queue target matched '${input}'`,
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
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
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
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
  target: ProcessManagerTargetCandidate,
): Effect.Effect<
  RemoteProcessManager<AnyProcessGroupContract>,
  ProcessManagerConnectionError | ProcessManagerRequestError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const manager = yield* managerFor(groups, target.groupId);
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
  operation: "pause" | "resume" | "clear",
) => {
  switch (operation) {
    case "pause":
      return queue.pause;
    case "resume":
      return queue.resume;
    case "clear":
      return Effect.asVoid(queue.clear);
  }
};

const runProcessCommand = (
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
  input: string,
  operation: "start" | "stop" | "restart" | "now",
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerRequestError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const target = yield* resolveCliTarget(groups, input, "process");
    yield* assertTargetControl(target, processControlFor(operation));
    const manager = yield* verifiedManagerForTarget(groups, target);
    yield* runRemoteProcessOperation(manager.process(target.id), operation);
    yield* Console.log(`OK process ${target.id} ${operation} requested`);
  });

const runQueueCommand = (
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
  input: string,
  operation: "pause" | "resume" | "clear",
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerRequestError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const target = yield* resolveCliTarget(groups, input, "queue");
    yield* assertTargetControl(target, operation);
    const manager = yield* verifiedManagerForTarget(groups, target);
    yield* runRemoteQueueOperation(manager.queue(target.id), operation);
    yield* Console.log(`OK queue ${target.id} ${operation} requested`);
  });

const runStatusCommand = (
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
  input: string,
  options: ProcessManagerCliOptions,
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerRequestError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const target = yield* resolveCliAnyTarget(groups, input);
    yield* assertTargetControl(target, "status");
    const manager = yield* verifiedManagerForTarget(groups, target);
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
      `STATUS ${target.kind} ${target.id}\n${data}`,
    );
  });

const runVerifyCommand = (
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
  options: ProcessManagerCliOptions,
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerRequestError,
  ProcessManagerConnectionRegistry | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const verified: Array<{ readonly groupId: string }> = [];
    for (const group of groups) {
      const manager = yield* managerFor(groups, group.id);
      yield* manager.verifyContract;
      verified.push({ groupId: group.id });
      if (options.json) {
        continue;
      }
      yield* Console.log(`OK contract verified for ${group.id}`);
    }
    if (options.json) {
      yield* Console.log(yield* encodeCliJson({ groups: verified }));
    }
  });

const runGroupsCommand = (
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
  options: ProcessManagerCliOptions,
): Effect.Effect<
  void,
  ProcessManagerConnectionError | ProcessManagerRequestError,
  ProcessManagerConnectionRegistry
> =>
  Effect.gen(function* () {
    const registry = yield* ProcessManagerConnectionRegistry;
    const rows: Array<{ readonly groupId: string; readonly baseUrl: string }> = [];
    const lines: string[] = ["GROUP\tENDPOINT"];
    for (const group of groups) {
      const baseUrl = yield* registry.baseUrl(group.id);
      rows.push({ groupId: group.id, baseUrl });
      lines.push(`${group.id}\t${baseUrl}`);
    }
    if (options.json) {
      yield* Console.log(yield* encodeCliJson({ groups: rows }));
      return;
    }
    yield* Console.log(lines.join("\n"));
  });

const runListCommand = (
  groups: ReadonlyArray<ConnectionSource<AnyProcessGroupContract>>,
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
    yield* Console.log(
      groups.map((group) => {
        const processLines = group.contract.processes.map((process) =>
          `process\t${process.id}`
        );
        const queueLines = group.contract.queues.map((queue) =>
          `queue\t${queue.id}`
        );
        return [`GROUP ${group.id}`, "KIND\tID", ...processLines, ...queueLines].join("\n");
      }).join("\n\n"),
    );
  });

const makeCli = <
  const Groups extends readonly ConnectionSource<AnyProcessGroupContract>[],
>(
  groups: Groups,
  config: ProcessManagerCliConfig = {},
) => {
  const target = Argument.string("target");
  const jsonOption = Flag.boolean("json").pipe(Flag.withDefault(false));
  const groupsCommand = Command.make("groups", { json: jsonOption }, ({ json }) =>
    runGroupsCommand(groups, { json })
  );
  const listCommand = Command.make("ls", { json: jsonOption }, ({ json }) =>
    runListCommand(groups, { json })
  );
  const verifyCommand = Command.make("verify", { json: jsonOption }, ({ json }) =>
    runVerifyCommand(groups, { json })
  );
  const statusCommand = Command.make("status", { target, json: jsonOption }, ({ target, json }) =>
    runStatusCommand(groups, target, { json })
  );
  const processCommand = (
    name: "start" | "stop" | "restart" | "now",
    operation: "start" | "stop" | "restart" | "now",
  ) =>
    Command.make(name, { target }, ({ target }) =>
      runProcessCommand(groups, target, operation)
    );
  const queueCommand = (name: "pause" | "resume" | "clear") =>
    Command.make(name, { target }, ({ target }) =>
      runQueueCommand(groups, target, name)
    );

  const root = Command.make(
    "pm",
    {},
    () => Effect.logInfo(`${config.name ?? "ProcessManager CLI"}. Use --help for commands.`),
  ).pipe(
    Command.withSubcommands([
      groupsCommand,
      listCommand,
      verifyCommand,
      statusCommand,
      processCommand("start", "start"),
      processCommand("stop", "stop"),
      processCommand("restart", "restart"),
      processCommand("now", "now"),
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
  config: ProcessManagerEndpointConfig,
): ProcessManagerEndpoint<Self, Id, ContractFromSource<Source>>;
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
  ProcessManagerConnectionError,
  ProcessManagerConnectionRegistry
> {
  const base = Context.Service<Self, RemoteProcessManager<ContractFromSource<Source>>>()(id);
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
    : Layer.succeed(base, connect(group, config));
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
 * Build a typed remote client from a raw contract. Use this form for generated
 * contracts or code that cannot import the group service class.
 *
 * @public
 */
function connect<const Contract extends AnyProcessGroupContract>(options: {
  readonly baseUrl: string;
  readonly contract: Contract;
}): RemoteProcessManager<Contract>;

function connect(
  sourceOrOptions:
    | ConnectionSource<AnyProcessGroupContract>
    | ContractSource<AnyProcessGroupContract>
    | {
        readonly baseUrl: string;
        readonly contract: AnyProcessGroupContract;
      },
  options?: {
    readonly baseUrl: string;
  },
):
  | RemoteProcessManager<AnyProcessGroupContract>
  | Effect.Effect<
    RemoteProcessManager<AnyProcessGroupContract>,
    ProcessManagerConnectionError,
    ProcessManagerConnectionRegistry
  >
{
  if (options !== undefined) {
    return makeRemoteProcessManager(options.baseUrl, sourceOrOptions.contract);
  }
  if ("baseUrl" in sourceOrOptions) {
    return makeRemoteProcessManager(
      sourceOrOptions.baseUrl,
      sourceOrOptions.contract,
    );
  }
  if ("id" in sourceOrOptions) {
    return connectFromRegistry(sourceOrOptions);
  }
  throw new TypeError("ProcessManager.connect requires connection options or a connection registry source");
}

function makeEndpointFactory<Self>() {
  function endpoint<const Source extends ConnectionSource<AnyProcessGroupContract>>(
    group: Source,
  ): ProcessManagerEndpoint<
    Self,
    Source["contract"]["id"],
    ContractFromSource<Source>,
    ProcessManagerConnectionError,
    ProcessManagerConnectionRegistry
  >;
  function endpoint<const Source extends ContractSource<AnyProcessGroupContract>>(
    group: Source,
    config: ProcessManagerEndpointConfig,
  ): ProcessManagerEndpoint<Self, Source["contract"]["id"], ContractFromSource<Source>>;
  function endpoint(
    group: ContractSource<AnyProcessGroupContract>,
    config?: ProcessManagerEndpointConfig,
  ) {
    if (config === undefined) {
      if (!hasConnectionId(group)) {
        throw new TypeError("ProcessManager.Endpoint without config requires a group service with an id");
      }
      return makeEndpoint<Self, string, ConnectionSource<AnyProcessGroupContract>>(
        `${group.contract.id}/ProcessManagerEndpoint`,
        group,
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
 * Remote ProcessManager namespace.
 *
 * @public
 */
export const ProcessManager = {
  cli: makeCli,
  connect,
  ConnectionRegistry: {
    layer: makeConnectionRegistryLayer,
    layerConfig: makeConnectionRegistryConfigLayer,
  },
  Endpoint: makeEndpointFactory,
} as const;
