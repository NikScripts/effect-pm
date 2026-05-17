/**
 * File-backed ProcessStore adapter.
 *
 * @remarks
 * Prefer this package subpath for local durable analytics storage:
 *
 * ```ts
 * import { fileLayer } from "@nikscripts/effect-pm/storage/file";
 * ```
 *
 * @module storage/file
 */

import { ProcessStore } from "../ProcessStore";

/**
 * Build a file-backed ProcessStore effect.
 *
 * @public
 */
export const file = ProcessStore.file;

/**
 * Build a file-backed ProcessStore layer.
 *
 * @public
 */
export const fileLayer = ProcessStore.fileLayer;

/**
 * Namespace-style file adapter facade.
 *
 * @public
 */
export const FileProcessStore = {
  file,
  fileLayer,
} as const;

export type {
  AnalyticsEvent,
  ProcessStoreInterface,
  QueryOpts,
  StoreEventQuery,
} from "../ProcessStore";
