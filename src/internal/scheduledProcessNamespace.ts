/**
 * @module internal/scheduledProcessNamespace
 *
 * The single **`ScheduledProcess`** namespace — the target of both the `./ScheduledProcess` subpath and the
 * barrel's `export * as ScheduledProcess`. Assembled from per-member named exports so member access
 * **tree-shakes**: `Tag` / `configure` / the schemas (`processStatus`, `processScheduleEntry`, …) / `kind`
 * are light (engine-free, browser-safe), while `layer` / `serve` / `serveRemote` pull the Process engine
 * only when actually used (a Node entrypoint). The `@internal` wire mappers are deliberately **not**
 * re-exported.
 */
export {
  Tag,
  configure,
  layer,
  serve,
  serveRemote,
  kind,
  processControlSpec,
  processStatus,
  processScheduleEntry,
  processLogEntry,
  historyQuery,
} from "../ScheduledProcess";
export type { ProcessLayerConfig } from "../ScheduledProcess";
