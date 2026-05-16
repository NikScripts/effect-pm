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
 *   `schedule` layers on `Process.make(id, config)` are merged into `process.effect` so fork-time
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
 * **`@nikscripts/effect-pm/ProcessManager`**, and
 * **`@nikscripts/effect-pm/ControlService`**.
 *
 * Storage adapters use lower-case subpaths:
 * **`@nikscripts/effect-pm/storage/file`** and
 * **`@nikscripts/effect-pm/storage/prisma`**. The legacy
 * **`@nikscripts/effect-pm/prisma`** subpath remains available for
 * compatibility.
 *
 * ## Source-only helpers
 *
 * The published **`exports["."]`** surface is this file. Small utilities such as
 * **`provideLayer`** (strict `Effect.provide` alias) and **`utcDate`** helpers live under
 * `src/` for tests, examples, and internal call sites only; they are not part of the semver
 * API unless promoted here later.
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
export { Process } from "./Process";
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

// CLI
export { createCli, runCli } from "./cli";

// Process Manager
export {
  ProcessManager,
  ProcessManagerConnectionError,
  ProcessManagerConnectionRegistry,
  ProcessManagerRequestError,
} from "./ProcessManager";
export type {
  ProcessManagerConnectionConfigMap,
  ProcessManagerCliConfig,
  ProcessManagerConnectionMap,
  ProcessManagerConnectionRegistryService,
  RemoteProcessManager,
  RemoteProcessControls,
  RemoteQueueControls,
  ProcessManagerEndpointConfig,
  ProcessManagerEndpoint,
} from "./ProcessManager";

// Process Store
export {
  ProcessStore,
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
  type RuntimeFactRecordedEvent,
  type RuntimeStateChangedEvent,
  type AnalyticsEvent,
  type ProcessStoreInterface,
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
  CronDetails,
  ScheduledProcessDetails,
} from "./Process";

// Types - Polling / ProcessSchedule
export type { PollingService, AcceleratingPollConfig } from "./Polling";
export type { ProcessScheduleService } from "./ProcessSchedule";

// Types - QueueResource
export type {
  QueueHandle,
  QueueEnqueue,
  QueueResourceDefinition,
  QueueResourceConfig,
  QueueResourceConfigBase,
  QueueResourceConfigWithoutItemSchema,
  QueueResourceConfigWithItemSchema,
  QueueShutdownError,
  EffectContext,
  HandlerContext,
  Priority,
  QueueItemCodecDescriptor,
  InferQueueEnqueueError,
} from "./QueueResource";

export {
  QueueItemCodecDescriptorSchema,
  makeQueueItemCodecDescriptor,
  QueueItemValidationError,
  QueueBatchValidationError,
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
} from "./ControlService";
