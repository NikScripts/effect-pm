// ============================================================================
// ProcessManager - Main Exports
// ============================================================================

// Namespace exports (these export objects with .make methods)
export { Process } from "./Process";
export { ProcessManager } from "./ProcessManager";
export { QueueResource, Cause } from "./QueueResource";
export { RunResource } from "./RunResource";
export { HttpClientRunGate } from "./HttpClientRunGate";
export {
  HttpApiResource,
  acceptJson,
  type HttpApiResourceClientOptions,
  type HttpApiResourceMakeConfig,
} from "./HttpApiResource";
export { Resource } from "./Resource";
export { ControlService } from "./ControlService";

// CLI
export { createCli, runCli } from "./cli";

// Execution History
export {
  ExecutionHistory,
  ExecutionHistoryError,
  type ExecutionData,
  type Execution,
  type DateRange,
  type ProcessExecutionHistory,
  type ExecutionHistoryInterface,
} from "./ExecutionHistory";

// Types - ProcessManager
export type {
  ProcessManagerControls,
  ProcessManagerDetails,
  ProcessStatus,
  QueueDetails,
  PMError,
  ProcessManagerDependencies,
} from "./ProcessManager";

// Error classes - ProcessManager  
export {
  ProcessManagerError,
  ProcessNotFoundError,
  ProcessAlreadyRunningError,
  ProcessNotRunningError,
} from "./ProcessManager";

// Types - Process
export type {
  Process as ProcessInterface,
  CronDetails,
  ScheduledProcessDetails,
} from "./Process";

// Types - QueueResource
export type {
  QueueResourceInstance as QueueResourceInterface,
  QueueResourceConfig,
  QueueResourceConfigBase,
  QueueResourceDetails,
} from "./QueueResource";

// Types - RunResource
export type {
  RunResourceLimits,
  RunResourceConfigUnit,
  RunResourceConfigWithArg,
  RunResourceUnit,
  RunResourceApply,
  RunResourceRunner,
  RunResourceRunnerConfig,
} from "./RunResource";

// Types - Control Service
export type {
  ControlCommand,
  ControlRequestBody,
  ControlResponse,
} from "./ControlService";
