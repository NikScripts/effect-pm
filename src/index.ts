// ============================================================================
// ProcessManager - Main Exports
// ============================================================================

// Namespace exports (these export objects with .make methods)
export { Process } from "./Process";
export { ProcessManager } from "./ProcessManager";
export { ResourcePool } from "./ResourcePool";
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
  PoolDetails,
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

// Types - ResourcePool
export type {
  ResourcePool as ResourcePoolInterface,
  ResourcePoolConfig,
  ResourcePoolDetails,
} from "./ResourcePool";

// Types - Control Service
export type {
  ControlCommand,
  ControlRequestBody,
  ControlResponse,
} from "./ControlService";
