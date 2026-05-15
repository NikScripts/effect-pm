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

import { Context, Data, Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type { ControlResponse } from "./ControlService";
import { ProcessGroupContractSchema } from "./ProcessGroup";
import type {
  ProcessGroupContract,
  ProcessGroupEntry,
} from "./ProcessGroup";

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

const responseBodyJson = Schema.fromJsonString(Schema.Unknown);

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
> extends Context.ServiceClass<Self, Id, RemoteProcessManager<Contract>> {
  readonly group: ContractSource<Contract>;
  readonly contract: Contract;
  readonly config: ProcessManagerEndpointConfig;
  readonly layer: Layer.Layer<Self>;
}

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, "")}${path}`;

const decodeJsonResponse = (
  responseText: string,
): Effect.Effect<unknown, ProcessManagerRequestError> =>
  Schema.decodeUnknownEffect(responseBodyJson)(responseText).pipe(
    Effect.mapError(
      (cause) =>
        new ProcessManagerRequestError({
          reason: `Malformed JSON response: ${String(cause)}`,
        }),
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
        (cause) =>
          new ProcessManagerRequestError({
            reason: String(cause),
          }),
      ),
    );
    const text = yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new ProcessManagerRequestError({
            reason: String(cause),
            status: response.status,
          }),
      ),
    );
    const json = yield* decodeJsonResponse(text);
    if (response.status >= 200 && response.status < 300) {
      return json;
    }
    return yield* new ProcessManagerRequestError({
      reason: `HTTP ${response.status}`,
      status: response.status,
    });
  });

const decodeControlResponse = (
  json: unknown,
  status: number,
): Effect.Effect<ControlResponse<unknown>, ProcessManagerRequestError> =>
  Schema.decodeUnknownEffect(controlResponseSchema)(json).pipe(
    Effect.mapError(
      (cause) =>
        new ProcessManagerRequestError({
          reason: `Malformed control response: ${String(cause)}`,
          status,
        }),
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
        (cause) =>
          new ProcessManagerRequestError({
            reason: String(cause),
          }),
      ),
    );
    const json = yield* response.json.pipe(
      Effect.mapError(
        (cause) =>
          new ProcessManagerRequestError({
            reason: String(cause),
            status: response.status,
          }),
      ),
    );
    const decoded = yield* decodeControlResponse(json, response.status);
    if (response.status >= 200 && response.status < 300 && decoded.success) {
      return decoded;
    }
    return yield* new ProcessManagerRequestError({
      reason: decoded.error ?? `HTTP ${response.status}`,
      status: response.status,
    });
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
        (cause) =>
          new ProcessManagerRequestError({
            reason: String(cause),
          }),
      ),
    );
    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError(
        (cause) =>
          new ProcessManagerRequestError({
            reason: String(cause),
          }),
      ),
    );
    const json = yield* response.json.pipe(
      Effect.mapError(
        (cause) =>
          new ProcessManagerRequestError({
            reason: String(cause),
            status: response.status,
          }),
      ),
    );
    const decoded = yield* decodeControlResponse(json, response.status);
    if (response.status >= 200 && response.status < 300 && decoded.success) {
      return decoded;
    }
    return yield* new ProcessManagerRequestError({
      reason: decoded.error ?? `HTTP ${response.status}`,
      status: response.status,
    });
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

const findEntity = (
  entities: ReadonlyArray<ContractEntity>,
  id: string,
): ContractEntity | undefined =>
  entities.find((entity) => entity.id === id);

const describeEntityMismatch = (
  kind: "process" | "queue",
  expected: ReadonlyArray<ContractEntity>,
  remote: ReadonlyArray<ContractEntity>,
): string | undefined => {
  if (!sameStringSet(
    expected.map((entity) => entity.id),
    remote.map((entity) => entity.id),
  )) {
    return `Remote contract ${kind} ids did not match local contract`;
  }

  for (const expectedEntity of expected) {
    const remoteEntity = findEntity(remote, expectedEntity.id);
    if (remoteEntity === undefined) {
      return `Remote contract ${kind} '${expectedEntity.id}' was missing`;
    }
    if (!sameStringSet(expectedEntity.controls, remoteEntity.controls)) {
      return `Remote contract ${kind} '${expectedEntity.id}' controls did not match local contract`;
    }
  }

  return undefined;
};

const describeContractMismatch = (
  expected: AnyProcessGroupContract,
  remote: typeof ProcessGroupContractSchema.Type,
): string | undefined => {
  if (remote.id !== expected.id) {
    return `Remote contract id '${remote.id}' did not match '${expected.id}'`;
  }
  if (remote.version !== expected.version) {
    return `Remote contract version '${remote.version}' did not match '${expected.version}'`;
  }

  return describeEntityMismatch("process", expected.processes, remote.processes)
    ?? describeEntityMismatch("queue", expected.queues, remote.queues);
};

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
            new ProcessManagerRequestError({
              reason: `Malformed group contract: ${String(cause)}`,
            }),
        ),
      ),
    ),
  );

  return {
    contract,
    fetchContract,
    verifyContract: Effect.gen(function* () {
      const remote = yield* fetchContract;
      const mismatch = describeContractMismatch(contract, remote);
      if (mismatch !== undefined) {
        return yield* new ProcessManagerRequestError({
          reason: mismatch,
        });
      }
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

const makeEndpoint = <
  Self,
  const Id extends string,
  const Source extends ContractSource<AnyProcessGroupContract>,
>(
  id: Id,
  group: Source,
  config: ProcessManagerEndpointConfig,
): ProcessManagerEndpoint<Self, Id, ContractFromSource<Source>> => {
  const base = Context.Service<Self, RemoteProcessManager<ContractFromSource<Source>>>()(id);
  const manager = connect(group, config);
  return Object.assign(base, {
    group,
    contract: group.contract,
    config,
    layer: Layer.succeed(base, manager),
  });
};

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
    | ContractSource<AnyProcessGroupContract>
    | {
        readonly baseUrl: string;
        readonly contract: AnyProcessGroupContract;
      },
  options?: {
    readonly baseUrl: string;
  },
): RemoteProcessManager<AnyProcessGroupContract> {
  if (options !== undefined) {
    return makeRemoteProcessManager(options.baseUrl, sourceOrOptions.contract);
  }
  if ("baseUrl" in sourceOrOptions) {
    return makeRemoteProcessManager(
      sourceOrOptions.baseUrl,
      sourceOrOptions.contract,
    );
  }
  throw new TypeError("ProcessManager.connect requires connection options");
}

/**
 * Remote ProcessManager namespace.
 *
 * @public
 */
export const ProcessManager = {
  connect,
  Endpoint: <Self>() =>
  <const Source extends ContractSource<AnyProcessGroupContract>>(
    group: Source,
    config: ProcessManagerEndpointConfig,
  ) => makeEndpoint<Self, Source["contract"]["id"], Source>(
    `${group.contract.id}/ProcessManagerEndpoint`,
    group,
    config,
  ),
} as const;
