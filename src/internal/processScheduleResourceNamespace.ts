/**
 * @module internal/processScheduleResourceNamespace
 *
 * The single **`ProcessScheduleResource`** namespace, assembled from per-member named exports so
 * that `export * as ProcessScheduleResource` (in the barrel) tree-shakes per member: `Tag` is light
 * (engine-free spec), while `layer` / `server` / `serveHttp` pull the engine only when used.
 */
export {
  processScheduleTag as Tag,
  layer,
  server,
  serveHttp,
} from "../ProcessScheduleContract";
