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
 * - **`QueueResource`** — Three-level **priority** queues with **concurrency** and optional
 *   **`rateLimit`** (Effect `RateLimiter`); each queue is a **Context**
 *   service with a `.layer`.
 * - **`ProcessStore`** — In-memory (or **Prisma**) **analytics**: execution rows + lifecycle
 *   events for processes.
 * - **Toolkit (location-transparent resources)** — **`Resource`** is the foundation: a tag is
 *   driven by the same `yield* Tag` code whether it runs **local or remote** (`Resource.client` /
 *   `server` / `serveHttp` / `Host` switch only the layer). Batteries-included resource kinds build
 *   on it — **`ScheduledProcess`**, **`ProcessScheduleResource`**, and the toolkit queue (from
 *   `@nikscripts/effect-pm/QueueContract`) — each with `Tag` / `layer` / `configure` / `server` /
 *   `serveHttp`. **`Group`** organizes member tags (nestable; members may be on the same or
 *   different hosts). Contracts are introspectable via `specOf` + `methodMeta` (build generic UIs).
 *   See `docs/guides/toolkit-by-example.md`.
 * - **`RunResource`**, **`HttpClientRunGate`**, **`HttpApiResource`** —
 *   Optional building blocks for **gated** HTTP and reusable resource patterns.
 * - **Persistence** — `DurableQueueStore` (durable priority queue) + `HistoryStore`
 *   (metrics/logs history); in-memory or SQLite (`@nikscripts/effect-pm/storage/sqlite`).
 * - **`DisarmedIdleSleep`** — Policy helpers for custom schedule layers (root aliases:
 *   `computeDisarmedIdleSleep`, `DEFAULT_SCHEDULE_POLL_WHILE_DISARMED`, …).
 *
 * ## Where to read next
 *
 * - Toolkit by example (every resource/group/host/UI pattern): `docs/guides/toolkit-by-example.md`
 * - Narrative architecture: `docs/PACKAGE-GUIDE.md`
 * - API tables (Process, Polling, Schedule): `docs/PROCESS-API.md`
 * - Runnable teaching scripts: `examples/README.md`
 * - Future roadmap (priority order, **not** shipped API truth): `docs/plans/README.md`
 * - Agent-oriented repo map: `docs/AGENTS.md`
 *
 * ## Import style
 *
 * Every public API lives under a **namespace** in its source module (`Query`,
 * `ResourceConfigure`, …). The root barrel re-exports the same bindings under **short
 * names** (`And`, `Endpoint`, …) so you can choose `import { And }` or `import { Query }`
 * with `Query.And` — they are identical.
 *
 * ## Dedicated subpaths
 *
 * Service/resource subpaths mirror namespaces: **`@nikscripts/effect-pm/Process`**,
 * **`@nikscripts/effect-pm/QueueResource`**, **`@nikscripts/effect-pm/Query`**,
 * **`@nikscripts/effect-pm/ResourceConfigure`**, **`@nikscripts/effect-pm/ProcessStore`**,
 * **`@nikscripts/effect-pm/RuntimeStorage`**, and **`@nikscripts/effect-pm/Logs`**.
 *
 * Toolkit subpaths: **`@nikscripts/effect-pm/Resource`** (foundation + `specOf` / `methodMeta`),
 * **`@nikscripts/effect-pm/QueueContract`** (toolkit queue), **`@nikscripts/effect-pm/ScheduledProcess`**,
 * **`@nikscripts/effect-pm/ProcessScheduleContract`**, **`@nikscripts/effect-pm/Group`**,
 * **`@nikscripts/effect-pm/HostLogs`**, **`@nikscripts/effect-pm/HistoryStore`**,
 * and **`@nikscripts/effect-pm/DurableQueueStore`**.
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
 * edges. Avoid scattering {@link Effect.provide} with
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
export type { ProcessSnapshot } from "./Process";
// Unified namespaces via `export * as` (module namespace, Effect-style) so member access
// tree-shakes — `ScheduledProcess.Tag` / `ProcessScheduleResource.Tag` pull no engine code.
export * as ScheduledProcess from "./internal/scheduledProcessNamespace";
export * as ProcessScheduleResource from "./internal/processScheduleResourceNamespace";
export {
  processControlSpec,
  processLogEntry,
  processScheduleEntry,
  processStatus,
} from "./ScheduledProcess";
export type { ProcessLayerConfig } from "./ScheduledProcess";
export {
  processScheduleSpec,
  reconcileResult,
} from "./ProcessScheduleContract";
export type { ProcessScheduleLayerConfig } from "./ProcessScheduleContract";
export { Polling } from "./Polling";
export { ProcessSchedule } from "./ProcessSchedule";
// The single unified QueueResource namespace. `export * as` (module namespace, Effect-style) so
// member access tree-shakes: `QueueResource.Tag` pulls zero engine code; `make`/`layer`/`serveHttp`
// pull the engine only when used.
export * as QueueResource from "./internal/queueResourceNamespace";
export { RunResource } from "./RunResource";
export { HttpClientRunGate } from "./HttpClientRunGate";
export {
  HttpApiResource,
  acceptJson,
  type HttpApiResourceLayerEffectConfig,
} from "./HttpApiResource";
export {
  DuplicateGroupId,
  DuplicateInstance,
  DuplicateResourceId,
  InstanceRoutingError,
  LocalOnlyMethod,
  MissingContractMethod,
  Resource,
  // Contract introspection — the basis for generic UIs (walk a tag's spec, render a widget
  // per method from its kind/description/destructive/streaming). See examples/resource-tui.
  methodMeta,
  specOf,
} from "./Resource";
export type {
  AnyLocalMethod,
  AnyMethod,
  HostKey,
  HostTagFactory,
  LocalCapability,
  LocalMethod,
  Method,
  MethodAnnotations,
  MethodKind,
  MethodMeta,
  ResourceInstance,
  ResourceTag,
  ServiceOf,
  Spec,
  TagFactory,
  TagHandlers,
} from "./Resource";
export { ProcessStorage } from "./ProcessStorage";


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

// Process Manager
export {
  encodeLogEntryNdjson,
  decodeLogEntryNdjson,
  logEntryFromLoggerOptions,
  LogEntrySchema,
  LogEntry,
} from "./LogEntry";
export {
  LogRelay,
  captureLogger,
  captureLoggerLayer,
  relayLayer,
  logsRelayLayer,
  replayLogEntry,
  relayOnlyLayer as logRelayLayer,
  relayWithCaptureLoggerLayer,
  Logs,
} from "./Logs";
export { HostLogs } from "./HostLogs";
export type { HostLogEntry } from "./HostLogs";
export { HistoryStore } from "./HistoryStore";
export type { HistoryReadOptions, HistoryStoreShape } from "./HistoryStore";
export {
  DurableQueueStore,
  DurableQueueError,
  durablePriorityRank,
} from "./DurableQueueStore";
export type {
  DurableEntry,
  DurableEntryInput,
  DurablePriority,
  DurableQueueStoreShape,
  DurableSizes,
  FailResult,
  OfferResult,
} from "./DurableQueueStore";
export { Group } from "./Group";
export {
  ProcessGroupLogContext,
  LogAnnotationKeys,
  layerProcessGroupLogContext,
  withProcessLogAnnotations,
  withQueueLogAnnotations,
  LogContext,
} from "./LogContext";
export type { LogEntryRecordedEvent } from "./store/log";
export { isLogEntryRecorded } from "./store/log";

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

// Error classes - ProcessGroup

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
  QueueResourceConfigWithoutItemSchema,
  QueueResourceConfigWithItemSchema,
  QueueResourceOptionsWithoutItemSchema,
  QueueResourceOptionsWithItemSchema,
  QueueConfigFromEffect,
  QueueWorkerEffect,
  QueueShutdownError,
  EffectContext,
  QueueBatch,
  QueueEncodedEntry,
  QueueEntry,
  QueueEntrySelector,
  QueueEntryTimestamps,
  QueueEnqueueEntries,
  QueueEvent,
  QueueStatus,
  QueueMetrics,
  QueueFailureDisposition,
  QueueOnFailure,
  QueueReleaseOptions,
  QueueRouteOptions,
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
  schemaVersionAnnotation,
  withSchemaVersion,
  schemaVersionOf,
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
