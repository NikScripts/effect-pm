// ============================================================================
// effect-pm - Main Exports
// ============================================================================

// Namespace exports (these export objects with .make methods)
export { Process } from "./Process";
export { ProcessGroup } from "./ProcessGroup";
export { QueueResource, Cause } from "./QueueResource";
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
  CronDetails,
  ScheduledProcessDetails,
} from "./Process";

// Types - QueueResource
export type {
  QueueRef,
  /** @deprecated Use {@link QueueRef}. */
  QueueResourceInstance,
  QueueResourceInterface,
  QueueResourceConfig,
  QueueResourceConfigBase,
  QueueResourceDetails,
  QueueItemEffectRequirements,
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
