/**
 * @packageDocumentation
 *
 * **hyperlink-ts** (`hyperlink-ts`) — Effect-first **process orchestration** and **queue
 * resources** for long-running applications.
 *
 * @remarks
 * ## What this package provides
 *
 * - **`Daemon`**, **`Polling`** — Build a **managed process** with a trigger-driven runtime: a
 *   long-lived driver follows a schedule and spawns process instances; each instance checks its
 *   schedule and exits naturally when disarmed while `Polling` controls in-instance repeat cadence.
 *   Optional `polling` / `schedule` layers on `Daemon.make` are merged into `process.effect` so
 *   fork-time requirements stay accurate in TypeScript. Run windows are built with
 *   `Daemon.scheduleInMemory` / `scheduleDefine` (and the toolkit `Daemon.Schedule` resource /
 *   `Daemon.window` / `Daemon.at`).
 * - **`WorkPool`** — Three-level **priority** queues with **concurrency** and optional
 *   **`rateLimit`** (Effect `RateLimiter`); each queue is a **Context**
 *   service with a `.layer`.
 * - **`Store`** — EventJournal-backed execution / queue / run / log history; process stores via
 *   `Daemon.store(tag)` and `Store.Service`.
 * - **Toolkit (location-transparent resources)** — **`Hyperlink`** is the foundation: a tag is
 *   driven by the same `yield* Tag` code whether it runs **local or remote** (`Hyperlink.client` /
 *   `serve` / `serveRemote` / `Node` switch only the layer). Batteries-included resource kinds build
 *   on it — the toolkit process (`Daemon.Tag` / `Daemon.Schedule`, from
 *   `hyperlink-ts/Daemon`) and the toolkit queue (from
 *   `hyperlink-ts/WorkPool`) — each with `Tag` / `layer` / `configure` / `serve` /
 *   `serveRemote`. **`Group`** organizes member tags (nestable; members may be on the same or
 *   different nodes). Contracts are introspectable via `specOf` + `methodMeta` (build generic UIs).
 *   See the live book under `docs/resources/` and `docs/guides/`.
 * - **`Gate`**, **`HttpClientRunGate`**, **`Gate.httpApiClient`** —
 *   Optional building blocks for **gated** HTTP and reusable resource patterns.
 * - **Persistence** — `DurableQueueStore` (durable priority queue) + `HistoryStore`
 *   (metrics/logs history); in-memory or SQLite (`hyperlink-ts/storage/sqlite`).
 *
 * ## Where to read next
 *
 * - Live book: `docs/index.md`, `docs/resources/`, `docs/guides/`, `docs/standards/`
 * - Logs: `docs/guides/logs.md` (and `docs/LOGS.md` while the guide absorbs it)
 * - Runnable teaching scripts: `examples/README.md`
 * - Future roadmap (priority order, **not** shipped API truth): `docs/plans/README.md`
 * - Agent / supervisor bus: `docs/handoffs/agent-status.md`
 *
 * ## Import style
 *
 * Every public API lives under a **namespace** in its source module
 * (`HyperlinkConfigure`, `Store`, …). The root barrel re-exports the same bindings under
 * short names where useful.
 *
 * ## Dedicated subpaths
 *
 * Service/resource subpaths mirror namespaces: **`hyperlink-ts/Daemon`**,
 * **`hyperlink-ts/WorkPool`**, **`hyperlink-ts/HyperlinkConfigure`**,
 * **`hyperlink-ts/Store`**, and **`hyperlink-ts/Logs`**.
 *
 * Toolkit subpaths: **`hyperlink-ts/Hyperlink`** (foundation + `specOf` / `methodMeta`),
 * **`hyperlink-ts/WorkPool`** (toolkit queue),
 * **`hyperlink-ts/MultiNode`** (multi-instance gather/fold),
 * **`hyperlink-ts/Group`**,
 * **`hyperlink-ts/HistoryStore`**,
 * and **`hyperlink-ts/DurableQueueStore`**.
 *
 * Durable logs: register `Node.logs` / toolkit `*.store(tag)` on a {@link Store.Service}
 * (`layerMemory` / `layer` bake in capture + per-registration tails). Capture/relay:
 * `hyperlink-ts/Logs`.
 *
 * Durable adapters: **`hyperlink-ts/storage/sqlite`**
 * (`SQLiteDurableQueueStore`, `SQLiteHistoryStore`).
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
 * @module hyperlink-ts
 */

// ============================================================================
// hyperlink-ts - Main exports (see @packageDocumentation above)
// ============================================================================

// The single unified `Daemon` namespace. `export * as` (module namespace, Effect-style) so member
// access tree-shakes: `Daemon.Tag` pulls zero engine code; `make` / `layer` / `serve` pull the
// engine only when used. Engine + Hyperlink toolkit are both members (`Daemon.make`, `Daemon.Tag`, …).
export * as Daemon from "./Daemon";
export { DaemonMakeInvalidLayerArgument } from "./Daemon";
export type { DaemonSnapshot } from "./Daemon";
export * as Polling from "./Polling";
// The single unified WorkPool namespace. `export * as` (module namespace, Effect-style) so
// member access tree-shakes: `WorkPool.Tag` pulls zero engine code; `make`/`layer`/`serve`
// pull the engine only when used.
export * as WorkPool from "./WorkPool";
export * as Gate from "./Gate";
export * as HttpClientRunGate from "./HttpClientRunGate";
export {
  acceptJson,
  instrumentEndpoints,
  type HttpApiClientConfig,
  type HttpApiClientLayerEffectConfig,
} from "./Gate";
export * as ApiMetrics from "./ApiMetrics";
export {
  apiUsageEndpointMetrics,
  apiUsageMetrics,
  apiUsageSnapshot,
  type ApiUsageMetrics,
  type ApiUsageSnapshot,
} from "./ApiUsageSchema";
export * as Telemetry from "./Telemetry";
export * as FleetHealth from "./FleetHealth";
export * as ShardMap from "./ShardMap";
export * as DynamicConfig from "./DynamicConfig";
export {
  ConfigKeyNotSwappable,
  DynamicConfigStore,
} from "./DynamicConfig";
export type {
  AllConfig,
  ConfigBag,
  ConfigField,
  FixedField,
  SwappableField,
} from "./DynamicConfig";
export {
  DuplicateGroupId,
  DuplicateInstance,
  DuplicateHyperlinkKey,
  EffectFnMissingPayload,
  IdentityMultiNode,
  IdentitySelfRequired,
  InstanceRoutingError,
  LocalOnlyMethod,
  LookupClientError,
  MissingClientProtocol,
  MissingContractMethod,
  ProtocolMismatch,
  // Contract introspection — the basis for generic UIs (walk a tag's spec, render a widget
  // per method from its kind/description/destructive/streaming). See examples/resource-tui.
  methodMeta,
  isVoidCommand,
  isEffect,
  specOf,
} from "./Hyperlink";
// `Hyperlink` as a tree-shakeable module namespace (Effect-style): `Hyperlink.Tag` /
// `Node.Tag` pull only what's used. Import `* as Hyperlink` / `* as Node` from the subpath.
export * as Hyperlink from "./Hyperlink";
export * as Node from "./Node";
export * as MultiNode from "./MultiNode";
export * as Lookup from "./Lookup";
export type {
  AnyLocalMethod,
  AnyMethod,
  Local,
  LocalEffect,
  LocalMethod,
  LocalShape,
  LocalShapeOf,
  NodeTagFactory,
  Of,
  Method,
  MethodAnnotations,
  MethodKind,
  MethodMeta,
  HyperlinkInstance,
  HyperlinkTag,
  ServiceOf,
  Shape,
  ShapeOf,
  Spec,
  TagFactory,
  TagHandlers,
  Wire,
  WireOf,
  WireShape,
} from "./Hyperlink";
export type {
  AnyNode,
  AddressedNode,
  CatalogNode,
  DialableTarget,
  ListenOptions,
  NamelessListenOptions,
  NodeKey,
  ProtocolKind,
} from "./Node";

/**
 * Layer-composed configure patches for {@link Daemon.Service}, {@link WorkPool.Service},
 * and {@link Gate.Service}.
 */
export {
  configureLayer,
  foldConfig,
  resourceConfigureTagKey,
} from "./HyperlinkConfigure";
export * as HyperlinkConfigure from "./HyperlinkConfigure";
export type { ConfigPatch } from "./HyperlinkConfigure";

// CLI

// Daemon Manager
export {
  encodeLogEntryNdjson,
  decodeLogEntryNdjson,
  logEntryFromLoggerOptions,
  LogEntrySchema,
} from "./LogEntry";
export * as LogEntry from "./LogEntry";
// Module namespace (Effect-style): `Logs.layer` / `Logs.Relay` / `Logs.replay`.
export * as Logs from "./Logs";
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
} from "./LogContext";
export * as LogContext from "./LogContext";
// Types - Daemon
export type {
  Daemon as DaemonInterface,
  DaemonDefinition,
  DaemonServiceDefinition,
  DaemonMakeConfig,
  DaemonMakeOptions,
  DaemonSupervisorRequirements,
  DaemonPollingInput,
  DaemonScheduleInput,
  DaemonScheduleLayerInput,
  DaemonMake,
  DaemonServiceBuilder,
  DaemonServiceFactory,
} from "./Daemon";

// Types - Polling

// Types - WorkPool (the leveled queue folded into WorkPool.priority)
export type {
  PriorityTagConfig,
} from "./WorkPool";

export {
  priorityControlSpec,
  priorityEntry,
  priorityLane,
  prioritySizes,
  prioritySpec,
  priorityStatus,
} from "./WorkPool";

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
} from "./WorkPool";

// Types - Gate
export type {
  GateRunHandle,
  GateStatus,
  GateConfig,
  GateHandle,
  GateLayerConfig,
  GateLayerEffect,
  GateRunner,
  GateRunnerConfig,
  GateServiceConfig,
  GateServiceDefinition,
  GateServiceEffect,
  GateStaticRun,
  GateTagDefinition,
  GateTagSchemas,
  GateWireSchemas,
  GateInstanceSpec,
} from "./Gate";
export {
  gateStatus,
  gateSpec,
  kind as gateKind,
  layer as gateLayer,
  serve as gateServe,
  serveRemote as gateServeRemote,
} from "./Gate";

// Types - Control Service
