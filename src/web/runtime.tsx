/**
 * @module web/runtime
 *
 * Web re-export of shared {@link ../ui/runtime} — `RuntimeProvider` + bundle hooks +
 * {@link data} door. Prefer `ui.data` from {@link ../ui/View.compose} in compose apps.
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
