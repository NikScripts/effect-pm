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
 *   **`rateLimit`** (Effect `RateLimiter`); each queue is a **Context**
 *   service with a `.layer`.
 * - **`ProcessStore`** — In-memory (or **Prisma**) **analytics**: execution rows + lifecycle
 *   events for processes.
 * - **`RunResource`**, **`HttpClientRunGate`**, **`HttpApiResource`**, **`Resource`** —
 *   Optional building blocks for **gated** HTTP and reusable resource patterns.
 * - **`ControlService`** + **`ProcessManager`** + **`createCli` / `runCli`** — Local and
 *   remote **control plane** helpers for ops (used by the examples CLI).
 * - **`DisarmedIdleSleep`** — Policy helpers for custom schedule layers (root aliases:
 *   `computeDisarmedIdleSleep`, `DEFAULT_SCHEDULE_POLL_WHILE_DISARMED`, …).
 *
 * ## Where to read next
 *
 * - Narrative architecture: `docs/PACKAGE-GUIDE.md`
 * - API tables (Process, Polling, Schedule, ProcessGroup): `docs/PROCESS-API.md`
 * - Runnable teaching scripts: `examples/README.md`
 * - Future roadmap (priority order, **not** shipped API truth): `docs/plans/README.md`
 * - Agent-oriented repo map: `docs/AGENTS.md`
 *
 * ## Import style
 *
 * Every public API lives under a **namespace** in its source module (`Query`,
 * `ProcessManager`, `ResourceConfigure`, …). The root barrel re-exports the same
 * bindings under **short names** (`And`, `Endpoint`, `createCli`, …) so you can
 * choose `import { And }` or `import { Query }` with `Query.And` — they are identical.
 *
 * ## Dedicated subpaths
 *
 * Service/resource subpaths mirror namespaces: **`@nikscripts/effect-pm/Process`**,
 * **`@nikscripts/effect-pm/QueueResource`**, **`@nikscripts/effect-pm/Query`**,
 * **`@nikscripts/effect-pm/ResourceConfigure`**, **`@nikscripts/effect-pm/ProcessGroup`**,
 * **`@nikscripts/effect-pm/ProcessStore`**, **`@nikscripts/effect-pm/RuntimeStorage`**,
 * **`@nikscripts/effect-pm/CommandAuth`**, **`@nikscripts/effect-pm/ProcessManager`**,
 * **`@nikscripts/effect-pm/Terminal`**, **`@nikscripts/effect-pm/TerminalRpc`**,
 * **`@nikscripts/effect-pm/Logs`**, **`@nikscripts/effect-pm/ControlService`**,
 * and **`@nikscripts/effect-pm/ControlTransportRpc`**, and
 * **`@nikscripts/effect-pm/LogTransportRpc`**.
 *
 * Structured log persistence: `ProcessStore.Log` (also exported as the
 * dedicated `ProcessStoreLog` facet) on the composed store. Capture/relay
 * pipeline: `@nikscripts/effect-pm/Logs`.
 * Queue analytics: optional `ProcessStore.QueueResource` facet (internal service, composed by `ProcessStorage.layer`).
 * Storage is `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite` or other `RuntimeStorage` + `ProcessStore` composition.
 *
 * Storage adapters use lower-case subpaths:
 * **`@nikscripts/effect-pm/storage/sqlite`** and **`@nikscripts/effect-pm/storage/prisma`**
 * for durable runtime records.
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
  DisarmedIdleSleep,
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
export type { MethodSpec, ServiceOf, Spec } from "./Resource";
export { ProcessStorage } from "./ProcessStorage";
export { ControlService } from "./ControlService";
export { ControlProtocol } from "./ControlProtocol";
export {
  CommandAuth,
  CommandAuthSigner,
  CommandAuthVerifier,
  MissingSignatureHeader,
  MalformedSignatureHeader,
  UnknownKeyId,
  ExpiredKey,
  SignatureVerificationFailed,
  ReplayedCommand,
  CanonicalPayloadError,
  KeyMaterialError,
  CommandAuthReplayStoreError,
  generateEd25519KeyPair,
  loadPrivateKeyRecord,
  ed25519Signer,
  ed25519Verifier,
  canonicalPayload,
  canonicalPayloadText,
  decodePublicKeyRecordsJson,
  formatSignatureHeader,
  parseSignatureHeader,
  commandAuthErrorMessage,
  loadPublicKeyRecords,
  publicKeyRecordJson,
  publicKeyRecordsJson,
  mergePublicKeyRecords,
} from "./CommandAuth";
export type {
  PublicKeyRecord,
  PrivateKeyRecord,
  GeneratedEd25519KeyPair,
  GenerateEd25519KeyPairOptions,
  LoadPrivateKeyRecordOptions,
  LoadPublicKeyRecordsOptions,
  CanonicalCommandAuthRequest,
  CommandAuthSigningInput,
  CommandAuthSignatureHeader,
  CommandAuthReplayStoreReserveInput,
  CommandAuthReplayStore,
  CommandAuthSignerService,
  CommandAuthVerifyInput,
  CommandAuthVerifierService,
  CommandAuthError,
  Ed25519VerifierOptions,
} from "./CommandAuth";

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
export {
  ControlRpc,
  ControlRpcErrorSchema,
  ControlTransportRpc,
  ControlTransportRpcLive,
  controlRpcErrorFromTransportError,
  makeControlTransportRpcClient,
  makeControlTransportRpcServer,
  rpcErrorToControlTransportError,
} from "./ControlTransportRpc";
export {
  LogRpc,
  LogRpcErrorSchema,
  LogStreamRequestSchema,
  LogStreamScopeSchema,
  LogTransportClient,
  LogTransportRpc,
  LogTransportRpcLive,
  makeLogStream,
  makeLogTransportRpcClient,
  makeLogTransportRpcServer,
} from "./LogTransportRpc";
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
export type {
  ControlRpcClient,
  ControlRpcError,
  ControlRpcServerProtocol,
  ControlTransportRpcApi,
  ControlTransportRpcServerConfig,
} from "./ControlTransportRpc";
export type {
  LogRpcClient,
  LogRpcError,
  LogRpcServerProtocol,
  LogStreamRequest,
  LogStreamScope,
  LogTransportClientShape,
  LogTransportRpcApi,
  LogTransportRpcServerConfig,
} from "./LogTransportRpc";
export {
  Terminal,
  TerminalAuditMetadataSchema,
  OpenTerminalSessionSchema,
  TerminalSessionIdSchema,
  TerminalEventSchema,
  TerminalSessionErrorSchema,
  TerminalSessionError,
  TerminalSessionService,
} from "./Terminal";
export type {
  OpenTerminalSession,
  TerminalAuditMetadata,
  TerminalSessionId,
  TerminalEvent,
  TerminalSessionPort,
  TerminalSessionHandle,
  TerminalSessionServiceShape,
} from "./Terminal";
export {
  TerminalRpc,
  TerminalRpcGroup,
} from "./TerminalRpc";

// Query / Runtime Storage
export { Query } from "./Query";
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
  RuntimeStorageConnectionError,
  RuntimeStorageDecodeError,
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageEncodeError,
  RuntimeStorageQueryError,
  RuntimeStorageReadonlyRecordError,
  RuntimeStorageSchemaError,
  RuntimeStorageTransactionError,
  RuntimeStorageUnavailableError,
  selectRuntimeRecords,
  applyRuntimeRecordPatch,
} from "./RuntimeStorage";
export type {
  DeleteResult,
  RuntimeRecord,
  RuntimeStorageAdapter,
  RuntimeStorageError,
  RuntimeStorageLogicalError,
  RuntimeStorageOperation,
  RuntimeStorageOperationalFields,
  RuntimeStorageOperationalError,
  RuntimeStorageService,
  UpdateResult,
} from "./RuntimeStorage";

/**
 * Layer-composed configure patches for {@link Process.Service}, {@link QueueResource.Service},
 * and {@link RunResource.Service}. See `docs/guides/resource-configure.md`.
 */
export {
  configureLayer,
  foldConfig,
  resourceConfigureTagKey,
  ResourceConfigure,
} from "./ResourceConfigure";
export type { ConfigPatch } from "./ResourceConfigure";

// CLI
export { createCli, runCli, Cli } from "./cli";

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
  groupLocalRuntime,
} from "./ProcessManager";
export { httpEndpoint } from "./Transport";
export {
  encodeProcessManagerLogEntryNdjson,
  decodeProcessManagerLogEntryNdjson,
  processManagerLogEntryFromLoggerOptions,
  ProcessManagerLogEntrySchema,
  LogEntry,
  type ProcessManagerLogEntry,
} from "./LogEntry";
export {
  ProcessManagerLogRelay,
  captureLogger,
  captureLoggerLayer,
  relayLayer,
  logsRelayLayer,
  replayLogEntry,
  relayOnlyLayer as processManagerLogRelayLayer,
  relayWithCaptureLoggerLayer,
  Logs,
} from "./Logs";
export {
  ProcessGroupLogContext,
  ProcessManagerLogAnnotationKeys,
  layerProcessGroupLogContext,
  withProcessLogAnnotations,
  withQueueLogAnnotations,
  LogContext,
} from "./LogContext";
export type { ProcessManagerRunState } from "./ProcessManager";
export type { LogEntryRecordedEvent } from "./store/log";
export { isLogEntryRecorded } from "./store/log";
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
  ProcessStoreReadonlyRecordError,
  ProcessStoreStorageError,
  type AnalyticsEventBase,
  type ProcessStoreWriteError,
  type QueryOpts,
} from "./ProcessStore";

export { LogStore } from "./store/log";
export type { LogStoreApi } from "./store/log";
export { RunResourceStore } from "./store/runResource";
export { ProcessExecutionStore } from "./store/processExecution";
export { ProcessLifecycleStore } from "./store/processLifecycle";
export { ProcessGroupStore } from "./store/processGroup";
export type {
  ProcessExecutionCompletedEvent,
  ProcessExecutionFinishInput,
  ProcessExecutionQuery,
  ProcessExecutionScopedFinishInput,
  ProcessExecutionScopedQuery,
  ProcessExecutionStatus,
} from "./store/processExecution";
export type {
  ProcessLifecycleChangedEvent,
  ProcessLifecycleRecordInput,
  ProcessLifecycleTag,
} from "./store/processLifecycle";
export type {
  ProcessGroupMemberLifecycleInput,
} from "./store/processGroup";
export type {
  QueueResourceStoreDedupeKeyStatus,
  QueueResourceStoreEntryStatus,
  QueueResourceStoreLifecycleTag,
  QueueResourceStorePriority,
  QueueDedupeKeyAddedChange,
  QueueDedupeKeyChange,
  QueueDedupeKeyChangeType,
  QueueDedupeKeyHydratedChange,
  QueueDedupeKeyQuery,
  QueueDedupeKeyReleasedChange,
  QueueEntryCompletedFact,
  QueueEntryDeadLetteredFact,
  QueueEntryDroppedFact,
  QueueEntryEnqueuedFact,
  QueueEntryExhaustedFact,
  QueueEntryFact,
  QueueEntryFactType,
  QueueEntryFailedFact,
  QueueEntryQuery,
  QueueEntryReleasedFact,
  QueueEntryRetriedFact,
  QueueEntryStartedFact,
  QueueLifecycleChange,
  QueueLifecycleChangeType,
  QueueLifecycleClearedChange,
  QueueLifecycleDrainedChange,
  QueueLifecyclePausedChange,
  QueueLifecycleQuery,
  QueueLifecycleResumedChange,
  QueueLifecycleShutdownChange,
  QueueLifecycleStartedChange,
  QueueRateLimitExceededFact,
  QueueRateLimitExceededFactType,
  QueueRateLimitQuery,
} from "./store/queueResource";
export { QueueResourceStore } from "./store/queueResource";
export type {
  RunResourceFact,
  RunResourceFactQuery,
  RunResourceFactType,
  RunResourceRef,
  RunResourceRun,
  RunResourceRunCompletedFact,
  RunResourceRunCompletedPayload,
  RunResourceRunFailedFact,
  RunResourceRunFailedPayload,
  RunResourceRunStartedFact,
  RunResourceRunStartedPayload,
  RunResourceScopedFactQuery,
  RunResourceScopedStateHistoryQuery,
  RunResourceState,
  RunResourceStateChange,
  RunResourceStateChangeReason,
  RunResourceStateHistoryQuery,
} from "./store/runResource";

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
  ProcessGroupDuplicateDefinitionError,
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
  QueueResourceRateLimitOptions,
  QueueRateLimitExceededEvent,
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
  ConsumeResult,
} from "./QueueResource";

export {
  QueueItemCodecDescriptorSchema,
  makeQueueItemCodecDescriptor,
  QueueItemValidationError,
  QueueBatchValidationError,
  QueueMissingItemSchemaError,
  QueueItemEncodingError,
  queueRateLimiterLayer,
} from "./QueueResource";

// Types - RunResource
export type {
  RunResourceConfig,
  RunGate,
  RunResourceRunner,
  RunResourceRunnerConfig,
} from "./RunResource";

// Types - Control Service
export type {
  ControlResponse,
} from "./ControlProtocol";
