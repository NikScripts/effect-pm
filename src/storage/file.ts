/**
 * Legacy file-backed ProcessStore adapter (append-only NDJSON).
 *
 * @remarks
 * **Do not use for new code.** This path bypasses {@link RuntimeStorage} and exists
 * only for backward compatibility with early local analytics demos and tests.
 *
 * For durable storage, use {@link ProcessStore.layerRuntimeStorage} with
 * `@nikscripts/effect-pm/storage/sqlite` or `ProcessStore.Logs`.
 *
 * @deprecated Prefer `@nikscripts/effect-pm/storage/sqlite` and `ProcessStore.Logs`.
 * @module storage/file
 */

import { ProcessStore } from "../ProcessStore";

/**
 * @deprecated Do not use for new code. See module doc.
 * @public
 */
export const file = ProcessStore.file;

/**
 * @deprecated Do not use for new code. See module doc.
 * @public
 */
export const fileLayer = ProcessStore.fileLayer;

/**
 * @deprecated Do not use for new code. See module doc.
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
