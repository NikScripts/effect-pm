/**
 * **CustomQueueHyperlink** — DEPRECATED shim. This module folded into {@link WorkPool}: the leveled
 * (N-level lane) queue is now the `WorkPool.priority` peer constructor, and `WorkPool`'s
 * `layer` / `serve` / `serveRemote` / `configure` / `store` dispatch to the leveled engine when the
 * tag is a priority tag. Import from `hyperlink-ts/WorkPool` instead; this subpath is retained only so
 * existing `CustomQueueHyperlink.*` call sites keep working during the migration.
 *
 * @module CustomQueueHyperlink
 */

// The leveled tag + schemas + spec + the dispatching runtime verbs all live in WorkPool now.
export {
  priority as Tag,
  priorityKind as kind,
  layer,
  layerMemory,
  serve,
  serveMemory,
  serveRemote,
  serveRemoteMemory,
  configure,
  store,
  customQueueSizes,
  customQueueStatus,
  customQueueLevel,
  customQueueEntry,
  customQueueEntrySelector,
  customQueueControlSpec,
  customQueueSpec,
  queueLogEntry as customQueueLogEntry,
} from "./WorkPool";
export type {
  CustomQueueAddMethod,
  CustomQueueInstanceSpec,
  CustomQueueTagConfig,
  CustomQueueLayerConfig,
} from "./WorkPool";

// The engine surface stays in its internal module (tree-shaken away from a Tag-only import).
export {
  makeCustomQueueEffect as make,
  queueRateLimiterLayer as rateLimiterLayer,
} from "./internal/customQueueHyperlink";
export type {
  CustomQueueEnqueue,
  CustomQueueHandle,
  CustomQueueLevelConfig,
  CustomQueueRefill,
  CustomQueueHyperlinkConfig,
  CustomQueueHyperlinkConfigWithItemSchema,
  CustomQueueHyperlinkConfigWithoutItemSchema,
  CustomQueueStatus,
} from "./internal/customQueueHyperlink";
