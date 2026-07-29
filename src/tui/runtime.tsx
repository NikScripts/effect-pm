/**
 * @module tui/runtime
 *
 * TUI re-export of shared {@link ../ui/runtime} — same `RuntimeProvider` context as web
 * so {@link ../ui/View.compose}`().data` works under either shell.
 */
export {
  type AnyRuntime,
  type DataDoor,
  type DataTag,
  RuntimeProvider,
  data,
  useApiBundle,
  useDaemonBundle,
  useFleetHealthBundle,
  useGateBundle,
  useNodeBundle,
  usePriorityBundle,
  useQueueBundle,
  useRuntime,
  useShardMapBundle,
  useTelemetryBundle,
} from "../ui/runtime";
