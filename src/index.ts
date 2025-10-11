// ============================================================================
// Process Manager - Main Exports
// ============================================================================

// Core factories
export { createCronProcess } from "./cron-handler";
export { makeProcessManager } from "./process-manager";
export { makeQueueService } from "./priority-queue";
export { startControlService } from "./control-service";

// CLI
export { createCli, runCli } from "./cli";

// Service layer
export {
  ProcessManagerService,
  ProcessManagerLive,
} from "./process-manager-service";

// Storage
export {
  CronStorage,
  CronStorageLive,
  CronStorageError,
  type CronExecutionData,
  type CronExecution,
  type DateRange,
  type ProgramCronStorage,
  type CronStorageInterface,
} from "./cron-storage";

// Types - ProcessManager
export {
  type ProcessManager,
  type ProcessManagerDetails,
  type ProcessStatus,
  type QueueDetails,
  type PMError,
  type Process,
  type ProcessManagerDependencies,
  ProcessManagerError,
  ProcessNotFoundError,
  ProcessAlreadyRunningError,
  ProcessNotRunningError,
} from "./process-manager";

// Types - Cron Handler
export {
  type CronHandler,
  type CronDetails,
  type ScheduledProcessDetails,
} from "./cron-handler";

// Types - Priority Queue
export {
  type PriorityQueueProcessor,
  type QueueProcessorConfig,
  type QueueServiceConfig,
  type QueueProcessDetails,
} from "./priority-queue";

// Types - Control Service
export {
  type ControlCommand,
  type ControlRequestBody,
  type ControlResponse,
} from "./control-service";
