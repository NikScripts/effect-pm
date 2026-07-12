/**
 * @packageDocumentation
 *
 * **effect-pm** (`@nikscripts/effect-pm`) — Effect-first **process orchestration** and **queue
 * resources** for long-running applications.
 *
 * @remarks
 * ## What this package provides
 *
 * - **`Process`**, **`Polling`** — Build a **managed process** with a trigger-driven runtime: a
 *   long-lived driver follows a schedule and spawns process instances; each instance checks its
 *   schedule and exits naturally when disarmed while `Polling` controls in-instance repeat cadence.
 *   Optional `polling` / `schedule` layers on `Process.make` are merged into `process.effect` so
 *   fork-time requirements stay accurate in TypeScript. Run windows are built with
 *   `Process.scheduleInMemory` / `scheduleDefine` (and the toolkit `Process.Schedule` resource /
 *   `Process.window` / `Process.at`).
 * - **`QueueResource`** — Three-level **priority** queues with **concurrency** and optional
 *   **`rateLimit`** (Effect `RateLimiter`); each queue is a **Context**
 *   service with a `.layer`.
 * - **`ProcessStore`** — In-memory (or **SQLite**) **analytics**: execution rows + lifecycle
 *   events for processes.
 * - **Toolkit (location-transparent resources)** — **`Resource`** is the foundation: a tag is
 *   driven by the same `yield* Tag` code whether it runs **local or remote** (`Resource.client` /
 *   `serve` / `serveRemote` / `Node` switch only the layer). Batteries-included resource kinds build
 *   on it — the toolkit process (`Process.Tag` / `Process.Schedule`, from
 *   `@nikscripts/effect-pm/Process`) and the toolkit queue (from
 *   `@nikscripts/effect-pm/QueueResource`) — each with `Tag` / `layer` / `configure` / `serve` /
 *   `serveRemote`. **`Group`** organizes member tags (nestable; members may be on the same or
 *   different nodes). Contracts are introspectable via `specOf` + `methodMeta` (build generic UIs).
 *   See `docs/legacy/guides/toolkit-by-example.md`.
 * - **`RunResource`**, **`HttpClientRunGate`**, **`HttpApiResource`** —
 *   Optional building blocks for **gated** HTTP and reusable resource patterns.
 * - **Persistence** — `DurableQueueStore` (durable priority queue) + `HistoryStore`
 *   (metrics/logs history); in-memory or SQLite (`@nikscripts/effect-pm/storage/sqlite`).
 * - **`DisarmedIdleSleep`** — Policy helpers for custom schedule layers (root aliases:
 *   `computeDisarmedIdleSleep`, `DEFAULT_SCHEDULE_POLL_WHILE_DISARMED`, …).
 *
 * ## Where to read next
 *
 * - Toolkit by example (every resource/group/node/UI pattern): `docs/legacy/guides/toolkit-by-example.md`
 * - Narrative architecture: `docs/legacy/PACKAGE-GUIDE.md`
 * - API tables (Process, Polling, Schedule): `docs/legacy/PROCESS-API.md`
 * - Runnable teaching scripts: `examples/README.md`
 * - Future roadmap (priority order, **not** shipped API truth): `docs/legacy/plans/README.md`
 * - Agent-oriented repo map: `docs/legacy/AGENTS.md`
 *
 * ## Import style
 *
 * Every public API lives under a **namespace** in its source module (`Query`,
 * `ResourceConfigure`, …). The root barrel re-exports the same bindings under **short
 * names** (`And`, `Node`, …) so you can choose `import { And }` or `import { Query }`
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
 * **`@nikscripts/effect-pm/QueueResource`** (toolkit queue),
 * **`@nikscripts/effect-pm/Group`**,
 * **`@nikscripts/effect-pm/NodeLogs`**, **`@nikscripts/effect-pm/HistoryStore`**,
 * and **`@nikscripts/effect-pm/DurableQueueStore`**.
 *
 * Structured log persistence: `ProcessStore.Log` (also exported as the
 * dedicated `ProcessStoreLog` facet) on the composed store. Capture/relay
 * pipeline: `@nikscripts/effect-pm/Logs`.
 * Queue analytics: optional `ProcessStore.QueueResource` facet (internal service, composed by `ProcessStorage.layer`).
 * Storage is `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite` or other `RuntimeStorage` + `ProcessStore` composition.
 *
 * Storage adapters use lower-case subpaths:
 * **`@nikscripts/effect-pm/storage/sqlite`** and **`@nikscripts/effect-pm/storage/redis`**
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

// The single unified `Process` namespace. `export * as` (module namespace, Effect-style) so member
// access tree-shakes: `Process.Tag` pulls zero engine code; `make` / `layer` / `serve` pull the
// engine only when used. Engine + Resource toolkit are both members (`Process.make`, `Process.Tag`, …).
export * as Process from "./Process";
export { ProcessMakeInvalidLayerArgument } from "./Process";
export type { ProcessSnapshot } from "./Process";
export { Polling } from "./Polling";
// The single unified QueueResource namespace. `export * as` (module namespace, Effect-style) so
// member access tree-shakes: `QueueResource.Tag` pulls zero engine code; `make`/`layer`/`serve`
// pull the engine only when used.
export * as QueueResource from "./QueueResource";
export * as RunResource from "./RunResource";
export * as HttpClientRunGate from "./HttpClientRunGate";
export {
  acceptJson,
  instrumentEndpoints,
  type HttpApiResourceConfig,
  type HttpApiResourceLayerEffectConfig,
} from "./HttpApiResource";
export * as HttpApiResource from "./HttpApiResource";
export * as ApiMetrics from "./ApiMetrics";
export {
  apiUsageEndpointMetrics,
  apiUsageMetrics,
  apiUsageSnapshot,
  type ApiUsageMetrics,
  type ApiUsageSnapshot,
} from "./ApiUsageSchema";
export * as Telemetry from "./Telemetry";
export {
  DuplicateGroupId,
  DuplicateInstance,
  DuplicateResourceKey,
  EffectFnMissingPayload,
  InstanceRoutingError,
  LocalOnlyMethod,
  MissingContractMethod,
  // Contract introspection — the basis for generic UIs (walk a tag's spec, render a widget
  // per method from its kind/description/destructive/streaming). See examples/resource-tui.
  methodMeta,
  isVoidCommand,
  isEffect,
  specOf,
} from "./Resource";
// `Resource` as a tree-shakeable module namespace (Effect-style): `Resource.Tag` / `Resource.Node`
// pull only what's used. Import `* as Resource` from the subpath, or `{ Resource }` from here.
export * as Resource from "./Resource";
export type {
  AnyLocalMethod,
  AnyMethod,
  Local,
  LocalEffect,
  LocalMethod,
  LocalShape,
  LocalShapeOf,
  NodeKey,
  NodeTagFactory,
  Of,
  Method,
  MethodAnnotations,
  MethodKind,
  MethodMeta,
  ResourceInstance,
  ResourceTag,
  ServiceOf,
  Shape,
  ShapeOf,
  Spec,
  TagFactory,
  TagHandlers,
  Wire,
  WireOf,
  WireShape,
} from "./Resource";
export * as ProcessStorage from "./ProcessStorage";


// Query / Runtime Storage
export * as Query from "./Query";
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
 * and {@link RunResource.Service}. See `docs/legacy/guides/resource-configure.md`.
 */
export {
  configureLayer,
  foldConfig,
  resourceConfigureTagKey,
} from "./ResourceConfigure";
export * as ResourceConfigure from "./ResourceConfigure";
export type { ConfigPatch } from "./ResourceConfigure";

// CLI

// Process Manager
export {
  encodeLogEntryNdjson,
  decodeLogEntryNdjson,
  logEntryFromLoggerOptions,
  LogEntrySchema,
} from "./LogEntry";
export * as LogEntry from "./LogEntry";
export {
  LogRelay,
  captureLogger,
  captureLoggerLayer,
  relayLayer,
  logsRelayLayer,
  replayLogEntry,
  relayOnlyLayer as logRelayLayer,
  relayWithCaptureLoggerLayer,
} from "./Logs";
// Module namespace (Effect-style) so `Logs.captureLoggerLayer` etc. resolve the
// same bindings as the flat root re-exports above.
export * as Logs from "./Logs";
export * as NodeLogs from "./NodeLogs";
export type { NodeLogEntry } from "./NodeLogs";
export * as NodeStatus from "./NodeStatus";
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
export * as Group from "./Group";
export * as Store from "./Store";
export {
  LogAnnotationKeys,
  withNodeLogAnnotations,
  withProcessLogAnnotations,
  withQueueLogAnnotations,
} from "./LogContext";
export * as LogContext from "./LogContext";
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
export { ProcessLifecycleStore } from "./store/processLifecycle";
export type {
  ProcessLifecycleChangedEvent,
  ProcessLifecycleRecordInput,
  ProcessLifecycleTag,
} from "./store/processLifecycle";

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

// Types - Polling
export type { PollingService, AcceleratingPollConfig } from "./Polling";

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
  BuiltInTakeAlgorithm,
  TakeAlgorithm,
  TakeAlgorithmPick,
  TakeAlgorithmPickContext,
  CustomTakeAlgorithm,
  QueueItemCodecDescriptor,
  InferQueueEnqueueError,
  InferQueueItem,
  InferQueueWorkerError,
  InferQueueWorkerRequirements,
  ConsumeResult,
} from "./internal/queueResource";

export * as CustomQueueResource from "./CustomQueueResource";

export type {
  CustomQueueHandle,
  CustomQueueEnqueue,
  CustomQueueLevelConfig,
  CustomQueueRefill,
  CustomQueueResourceConfig,
  CustomQueueResourceConfigWithoutItemSchema,
  CustomQueueResourceConfigWithItemSchema,
  CustomQueueStatus,
} from "./internal/customQueueResource";

export type {
  CustomQueueTagConfig,
} from "./CustomQueueResource";

export {
  customQueueControlSpec,
  customQueueEntry,
  customQueueLevel,
  customQueueSizes,
  customQueueSpec,
  customQueueStatus,
} from "./CustomQueueResource";

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
} from "./internal/queueResource";

// Types - RunResource
export type {
  RunGateHandle,
  RunGateStatus,
  RunResourceConfig,
  RunResourceHandle,
  RunResourceLayerConfig,
  RunResourceLayerEffect,
  RunResourceRunner,
  RunResourceRunnerConfig,
  RunResourceServiceConfig,
  RunResourceServiceDefinition,
  RunResourceServiceEffect,
  RunResourceStaticRun,
  RunResourceTagDefinition,
  RunResourceTagSchemas,
  RunResourceWireSchemas,
  RunInstanceSpec,
} from "./RunResource";
export {
  runGateStatus,
  runSpec,
  kind as runResourceKind,
  layer as runResourceLayer,
  serve as runResourceServe,
  serveRemote as runResourceServeRemote,
} from "./RunResource";

// Types - Control Service
