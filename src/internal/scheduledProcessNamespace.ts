/**
 * @module internal/scheduledProcessNamespace
 *
 * The single **`ScheduledProcess`** namespace, assembled from per-member named exports so that
 * `export * as ScheduledProcess` (in the barrel) tree-shakes per member: `Tag` / `configure` are
 * light (the contract's spec is engine-free), while `layer` / `server` / `serveHttp` pull the
 * Process engine only when actually used (e.g. in a Node entrypoint).
 */
export {
  processTag as Tag,
  configure,
  layer,
  server,
  serveHttp,
  serverEntry,
} from "../ScheduledProcess";
