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
 * - **`ProcessGroup`** — Bundle **queue tags** and **process handles**; `startProcess` /
 *   `startAll` fork supervisors; `serve` exposes a **localhost** control HTTP API;
 *   `awaitShutdown` waits for OS signals (Node).
 * - **`QueueResource`** — Three-level **priority** queues with **concurrency** and optional
 *   **throttle**; each queue is a **Context** service with a `.layer`.
 * - **`ProcessStore`** — In-memory (or **Prisma**) **analytics**: execution rows + lifecycle
 *   events for processes.
 * - **`RunResource`**, **`HttpClientRunGate`**, **`HttpApiResource`**, **`Resource`** —
 *   Optional building blocks for **gated** HTTP and reusable resource patterns.
 * - **`ControlService`** + **`createCli` / `runCli`** — Local **control plane** for ops
 *   (used by the examples CLI).
 * - **`disarmedIdleSleep` exports** — Compatibility helpers for custom schedule layers and
 *   migration tooling.
 *
 * ## Where to read next
 *
 * - Narrative architecture: `docs/PACKAGE-GUIDE.md`
 * - API tables (Process, Polling, Schedule, ProcessGroup): `docs/PROCESS-API.md`
 * - Runnable teaching scripts: `examples/README.md`
 * - Architecture contracts: `docs/plans/README.md` (especially plan **09** for process v2)
 * - Agent-oriented repo map: `docs/AGENTS.md`
 *
 * ## Prisma subpath
 *
 * Durable analytics: import from **`@nikscripts/effect-pm/prisma`** (see package `exports`
 * in `package.json`).
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
  type HttpApiResourceClientOptions,
  type HttpApiResourceLayerEffectConfig,
  type HttpApiResourceMakeConfig,
} from "./HttpApiResource";
export { Resource } from "./Resource";
export { ControlService } from "./ControlService";

// CLI
export { createCli, runCli } from "./cli";

// Process Store
export {
  ProcessStore,
  type QueryOpts,
  type AnalyticsEventBase,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleTag,
  type ProcessLifecycleChangedEvent,
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
  ProcessGroupDependencies,
  AwaitShutdownOptions,
  ProcessEffectRequirements,
  AllGroupProcessesRequirements,
} from "./ProcessGroup";

// Error classes - ProcessGroup
export {
  ProcessGroupError,
  ProcessNotFoundError,
  ProcessAlreadyRunningError,
  ProcessNotRunningError,
} from "./ProcessGroup";

// Types - Process
export type {
  Process as ProcessInterface,
  ProcessDetails,
  ProcessMakeConfig,
  ProcessSupervisorRequirements,
  CronDetails,
  ScheduledProcessDetails,
} from "./Process";

// Types - Polling / ProcessSchedule
export type { PollingService, AcceleratingPollConfig } from "./Polling";
export type { ProcessScheduleService } from "./ProcessSchedule";

// Types - QueueResource
export type {
  QueueRef,
  QueueHandle,
  QueueResourceConfig,
  QueueShutdownError,
  EffectContext,
  HandlerContext,
  Priority,
} from "./QueueResource";

// Types - RunResource
export type {
  RunResourceLimits,
  RunResourceConfig,
  RunGate,
  RunResourceRunner,
  RunResourceRunnerConfig,
} from "./RunResource";

// Types - Control Service
export type {
  ControlCommand,
  ControlRequestBody,
  ControlResponse,
} from "./ControlService";
