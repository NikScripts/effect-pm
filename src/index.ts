/**
 * @packageDocumentation
 *
 * **effect-pm** (`@nikscripts/effect-pm`) — Effect-first **process orchestration** and **queue
 * resources** for long-running applications.
 *
 * @remarks
 * ## What this package provides
 *
 * - **`Process`**, **`Polling`**, **`ProcessSchedule`** — Build a **managed process** with
 *   a trigger-driven runtime: a long-lived driver follows an Effect `Schedule` and spawns
 *   process instances; each instance checks `ProcessSchedule` and exits naturally when
 *   disarmed while `Polling` controls in-instance repeat cadence. Optional `polling` /
 *   `schedule` layers on `Process.make` are merged into `process.effect` so fork-time
 *   requirements stay accurate in TypeScript.
 * - **`ProcessGroup`** — Bundle **process and queue entries**; `start` /
 *   `startAll` fork supervisors; contracts power the **localhost** control HTTP API
 *   and remote group layers; `awaitShutdown` waits for OS signals (Node).
 * - **`QueueResource`** — Three-level **priority** queues with **concurrency** and optional
 *   **throttle**; each queue is a **Context** service with a `.layer`.
 * - **`ProcessStore`** — In-memory (or **Prisma**) **analytics**: execution rows + lifecycle
 *   events for processes.
 * - **`RunResource`**, **`HttpClientRunGate`**, **`HttpApiResource`**, **`Resource`** —
 *   Optional building blocks for **gated** HTTP and reusable resource patterns.
 * - **`ControlService`** + **`ProcessManager`** + **`createCli` / `runCli`** — Local and
 *   remote **control plane** helpers for ops (used by the examples CLI).
 * - **`disarmedIdleSleep` exports** — Compatibility helpers for custom schedule layers and
 *   migration tooling.
 *
 * ## Where to read next
 *
 * - Narrative architecture: `docs/PACKAGE-GUIDE.md`
 * - API tables (Process, Polling, Schedule, ProcessGroup): `docs/PROCESS-API.md`
 * - Runnable teaching scripts: `examples/README.md`
 * - Architecture contracts: `docs/plans/README.md` (especially plan **09** for process runtime)
 * - Agent-oriented repo map: `docs/AGENTS.md`
 *
 * ## Dedicated subpaths
 *
 * Root imports remain backwards compatible. Dedicated service/resource subpaths
 * are also available: **`@nikscripts/effect-pm/Process`**,
 * **`@nikscripts/effect-pm/QueueResource`**,
 * **`@nikscripts/effect-pm/ProcessGroup`**,
 * **`@nikscripts/effect-pm/ProcessStore`**,
 * **`@nikscripts/effect-pm/ProcessManager`**, **`@nikscripts/effect-pm/Logs`**, and
 * **`@nikscripts/effect-pm/ControlService`**.
 *
 * Group log persistence: `ProcessStore.GroupLog`. Capture/relay: `@nikscripts/effect-pm/Logs`.
 * Queue helpers: `ProcessStore.QueueResource`. Storage is `layerProcessStore` from
 * `@nikscripts/effect-pm/storage/sqlite` or other `RuntimeStorage` + `ProcessStore` composition.
 *
 * Storage adapters use lower-case subpaths:
 * **`@nikscripts/effect-pm/storage/sqlite`** and **`@nikscripts/effect-pm/storage/prisma`**
 * for durable runtime records. **`@nikscripts/effect-pm/storage/file`** is legacy-only.
 * The legacy
 * **`@nikscripts/effect-pm/prisma`** subpath remains available for
 * compatibility.
 *
 * ## Source-only helpers
 *
 * The published **`exports["."]`** surface is this file. Small utilities (`utcDate`, etc.)
 * live under `src/` for tests and tooling; they are not part of the semver API unless promoted
 * here.
 *
 * **Layers in `src/`:** Prefer attaching dependencies via **built {@link Context.Context}**
 * (`Effect.provide(effect, context)`) inside the runtime, or **`ManagedRuntime`** at true OS
 * edges (see `src/bin/effect-pm.ts`). Avoid scattering {@link Effect.provide} with
 * {@link Layer.Layer} through library internals — examples attach a **single** composed layer
 * at script entry (`examples/shared/demo-harness.ts`, same idea as `@effect/platform-node`
 * samples). **Tests** may use `Effect.provide` with layers, matching Effect’s own suites.
 *
 * @module @nikscripts/effect-pm
 */

// ============================================================================
// effect-pm - Main exports (see @packageDocumentation above)
// ============================================================================

export {
  computeDisarmedIdleSleep,
  resolveDisarmedFallbackPoll,
  DEFAULT_SCHEDULE_POLL_WHILE_DISARMED,
  MIN_SCHEDULE_POLL_WHILE_DISARMED,
  DISARMED_HINT_SLEEP_MIN,
  DISARMED_HINT_SLEEP_MAX,
} from "./disarmedIdleSleep";

// Namespace exports (these export objects with .make methods)
export { Process, ProcessMakeInvalidLayerArgument } from "./Process";
export { Polling } from "./Polling";
export { ProcessSchedule } from "./ProcessSchedule";
export { ProcessGroup } from "./ProcessGroup";
export { QueueResource } from "./QueueResource";
export { RunResource } from "./RunResource";
export { HttpClientRunGate } from "./HttpClientRunGate";
export {
  HttpApiResource,
  acceptJson,
  type HttpApiResourceLayerEffectConfig,
} from "./HttpApiResource";
export { Resource } from "./Resource";
export { RuntimeObserver } from "./RuntimeState";
export { ControlService } from "./ControlService";
export {
  ControlRouter,
  ControlResponseSchema,
  ControlTransportClient,
  ControlTransportError,
  ControlTransportServer,
  ControlProtocolRequestSchema,
  ControlProtocolRequestEnvelopeSchema,
  ControlProtocolMetadataSchema,
  ControlProtocolResponseEnvelopeSchema,
  ControlProtocolResponseSchema,
  makeControlProtocolRequestEnvelope,
  makeControlProtocolResponseEnvelope,
  makeControlProtocolRouter,
} from "./ControlProtocol";
export {
  ControlTransportHttp,
  makeControlTransportHttpClient,
  makeControlTransportHttpServer,
} from "./ControlTransportHttp";
export type {
  ControlRouterShape,
  ControlProtocolMetadata,
  ControlProtocolRequest,
  ControlProtocolRequestEnvelope,
  ControlProtocolResponse,
  ControlProtocolResponseEnvelope,
  ControlProtocolRouter,
  ControlTransportClientShape,
  ControlTransportServerShape,
} from "./ControlProtocol";
export type {
  ControlTransportHttpClientConfig,
  ControlTransportHttpServerConfig,
} from "./ControlTransportHttp";

// Query / Runtime Storage
export {
  And,
  Attributes,
  Created,
  Delete,
  Id,
  IndexA,
  IndexB,
  IndexC,
  IndexD,
  IndexE,
  IndexF,
  IndexG,
  IndexH,
  Insert,
  Key,
  Limit,
  Occurred,
  Offset,
  Or,
  OrderBy,
  Payload,
  ProcessId,
  ProcessType,
  Readonly,
  RunId,
  Select,
  SubjectId,
  SubjectType,
  Type,
  Update,
  Upsert,
  Where,
  Xor,
} from "./Query";
export type {
  RuntimeRecordAssignment,
  RuntimeRecordComparison,
  RuntimeRecordOrderBy,
  RuntimeRecordOrderField,
  RuntimeRecordPatch,
  RuntimeRecordPredicate,
  RuntimeRecordQuery,
} from "./Query";
export {
  RuntimeStorage,
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
} from "./RuntimeStorage";
export type {
  DeleteResult,
  RuntimeRecord,
  RuntimeStorageError,
  RuntimeStorageService,
  UpdateResult,
} from "./RuntimeStorage";

// CLI
export { createCli, runCli } from "./cli";
export {
  decodeProcessManagerRunStateJson,
  encodeProcessManagerRunStateJson,
  ProcessManagerRunStateSchema,
} from "./processManagerRunState.js";
export type { ProcessManagerRunState } from "./processManagerRunState.js";

// Process Manager
export {
  Endpoint,
  GroupConfig,
  ProcessManager,
  ProcessManagerConnectionError,
  ProcessManagerConnectionRegistry,
  ProcessManagerConfig,
  ProcessManagerEndpointConfigError,
  ProcessManagerRequestError,
  Transport,
  operatorLoggerLayer,
} from "./ProcessManager";
export { httpEndpoint } from "./processManagerTransport.js";
export {
  encodeProcessManagerLogEntryNdjson,
  decodeProcessManagerLogEntryNdjson,
  processManagerLogEntryFromLoggerOptions,
  ProcessManagerLogEntrySchema,
  type ProcessManagerLogEntry,
} from "./processManagerLogEntry.js";
export {
  ProcessManagerLogRelay,
  captureLogger,
  captureLoggerLayer,
  relayLayer,
  logsRelayLayer,
  replayLogEntry,
  relayOnlyLayer as processManagerLogRelayLayer,
} from "./Logs.js";
export { groupLocalRuntime } from "./processManagerGroupRuntime.js";
export {
  groupLogEntryStream,
  streamGroupLogs,
  ProcessManagerGroupLogError,
  type ProcessManagerGroupLogOptions,
} from "./processManagerGroupLogs.js";
export {
  watchGroupLogs,
  type ProcessManagerGroupLogWatchOptions,
} from "./processManagerGroupLogsInteractive.js";
export {
  buildProcessManagerLogQuery,
  queryGroupLogs,
  ProcessManagerLogQueryError,
  type ProcessManagerLogQuery,
  type ProcessManagerLogSort,
} from "./processManagerLogQuery.js";
export {
  ProcessGroupLogContext,
  ProcessManagerLogAnnotationKeys,
  layerProcessGroupLogContext,
  logEntryMatchesScope,
  logScopeGroupId,
  resolveLogScope,
  withProcessLogAnnotations,
  withQueueLogAnnotations,
  type ProcessManagerLogScope,
} from "./processManagerLogContext.js";
export type { ProcessStoreGroupLogApi } from "./ProcessStoreLogs.js";
export { makeRecordedEvent, storeEventQueryFromLogQuery } from "./ProcessStoreLogs.js";
export { groupLogSqlitePath } from "./processManagerChildLaunch.js";
export { queryGroupLogsForCatalog } from "./processManagerLogHistory.js";
export type { GroupLogEntryRecordedEvent } from "./ProcessStore.js";
export { isGroupLogEntryRecorded } from "./ProcessStore.js";
export type {
  ProcessManagerEndpointConfigItem,
  ProcessManagerConnectionConfigMap,
  ProcessManagerCliConfig,
  ProcessManagerConnectionMap,
  ProcessManagerConnectionRegistryService,
  ProcessManagerEndpointDefinition,
  ProcessManagerEndpointSelection,
  ProcessManagerConfigService,
  RemoteProcessManager,
  RemoteProcessControls,
  RemoteQueueControls,
  ProcessManagerEndpointConfig,
  ProcessManagerEndpoint,
  ProcessManagerGroupEndpointStatus,
  ProcessManagerGroupConfigItem,
  ProcessManagerGroupConfig,
  ProcessManagerHttpEndpointDefinition,
  ProcessManagerHttpTransport,
  ProcessManagerChildEndpointDefinition,
  ProcessManagerChildLaunchConfig,
} from "./ProcessManager";

// Process Store
export {
  ProcessStore,
  ProcessStoreDuplicateRecordError,
  ProcessStoreQueueResourceContextError,
  ProcessStoreReadonlyRecordError,
  type QueryOpts,
  type StoreEventQuery,
  type RuntimeFactQuery,
  type RuntimeStateHistoryQuery,
  type AnalyticsEventBase,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleTag,
  type ProcessLifecycleChangedEvent,
  type QueueItemStatus,
  type QueueItemCompletedEvent,
  type QueueLifecycleTag,
  type QueueLifecycleChangedEvent,
  type ProcessStoreQueueResourceApi,
  type ProcessStoreQueueResourceContext,
  type ProcessStoreQueueResourceDedupeKeyInput,
  type ProcessStoreQueueResourceDedupeKeyStatus,
  type ProcessStoreQueueResourceEntryInput,
  type ProcessStoreQueueResourceEntryStatus,
  type ProcessStoreQueueResourceLifecycleInput,
  type ProcessStoreQueueResourceLifecycleTag,
  type ProcessStoreQueueResourcePriority,
  type RuntimeFactRecordedEvent,
  type RuntimeStateChangedEvent,
  type AnalyticsEvent,
  type ProcessStoreInterface,
  type ProcessStoreWriteError,
} from "./ProcessStore";

// Types - ProcessGroup
export type {
  ProcessGroup as ProcessGroupInterface,
  ProcessGroupControls,
  ProcessGroupDetails,
  ProcessStatus,
  QueueDetails,
  ProcessGroupErrors,
  ProcessEffectRequirements,
  AllGroupProcessesRequirements,
  ProcessGroupEntry,
  ProcessGroupProcessEntries,
  ProcessGroupQueueEntries,
  ProcessGroupQueueRegistration,
  TypedProcessGroupQueueRequirements,
  ProcessGroupEntryRequirements,
  ProcessGroupQueueItem,
  ProcessGroupProcessControl,
  ProcessGroupQueueControl,
  ProcessGroupProcessContract,
  ProcessGroupQueueContract,
  ProcessGroupContract,
  TypedProcessControls,
  TypedQueueControls,
  TypedProcessGroup,
  ProcessGroupControlError,
  ProcessGroupRemoteEndpointDefinition,
  ProcessGroupServiceDefinition,
  ProcessGroupQueueEnqueueError,
  ProcessGroupQueueEnqueueRequirements,
} from "./ProcessGroup";

// Error classes - ProcessGroup
export {
  ProcessNotFoundError,
  ProcessAlreadyRunningError,
  ProcessNotRunningError,
  ProcessGroupRemoteControlError,
  UnsupportedRemoteControlError,
  ProcessGroupProcessControlSchema,
  ProcessGroupQueueControlSchema,
  ProcessGroupProcessContractSchema,
  ProcessGroupQueueContractSchema,
  ProcessGroupContractSchema,
} from "./ProcessGroup";

// Types - Process
export type {
  Process as ProcessInterface,
  ProcessDefinition,
  ProcessServiceDefinition,
  ProcessDetails,
  ProcessMakeConfig,
  ProcessMakeOptions,
  ProcessSupervisorRequirements,
  ProcessPollingInput,
  ProcessScheduleInput,
  ProcessScheduleLayerInput,
  ProcessMake,
  ProcessServiceBuilder,
  ProcessServiceFactory,
} from "./Process";

// Types - Polling / ProcessSchedule
export type { PollingService, AcceleratingPollConfig } from "./Polling";
export type { ProcessScheduleService } from "./ProcessSchedule";

// Types - QueueResource
export type {
  QueueHandle,
  QueueEnqueue,
  QueueResourceDefinition,
  QueueResourceMetadata,
  QueueResourceServiceDefinition,
  QueueResourceConfig,
  QueueResourceConfigBase,
  QueueResourceConfigWithoutItemSchema,
  QueueResourceConfigWithItemSchema,
  QueueResourceOptionsWithoutItemSchema,
  QueueResourceOptionsWithItemSchema,
  QueueConfigFromEffect,
  QueueWorkerEffect,
  QueueShutdownError,
  EffectContext,
  QueueBatch,
  QueueClearedEvent,
  QueueCompletedEvent,
  QueueControls,
  QueueDeadLetteredEvent,
  QueueDrainedEvent,
  QueueDroppedEvent,
  QueueEncodedEntry,
  QueueEntry,
  QueueEntrySelector,
  QueueEntryTimestamps,
  QueueExitEvent,
  QueueFailedEvent,
  QueueReleasedEvent,
  QueueReleaseOptions,
  QueueRouteOptions,
  QueueRetryExhaustedEvent,
  QueueRetryScheduledEvent,
  QueueStartEvent,
  QueueReleaseEncodingError,
  Priority,
  QueueItemCodecDescriptor,
  InferQueueEnqueueError,
  InferQueueItem,
  InferQueueWorkerError,
  InferQueueWorkerRequirements,
} from "./QueueResource";

export {
  QueueItemCodecDescriptorSchema,
  makeQueueItemCodecDescriptor,
  QueueItemValidationError,
  QueueBatchValidationError,
  QueueMissingItemSchemaError,
  QueueItemEncodingError,
} from "./QueueResource";

// Types - RunResource
export type {
  RunResourceConfig,
  RunGate,
  RunResourceRunner,
  RunResourceRunnerConfig,
  RunResourceState,
} from "./RunResource";

// Types - RuntimeState
export type {
  RuntimeFact,
  RuntimeObserverService,
  RuntimeObserverListener,
  RuntimeRef,
  RuntimeStateBase,
  RuntimeStateChange,
} from "./RuntimeState";

// Types - Control Service
export type {
  ControlResponse,
} from "./ControlProtocol";

export {
  GroupChildArgvError,
  GroupChildImportError,
  GroupChildNotFoundError,
  runGroupChildCli,
} from "./groupChild.js";
