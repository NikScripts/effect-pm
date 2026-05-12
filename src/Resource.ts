/**
 * **Resource** — convenience barrel over {@link RunResource}, {@link HttpApiResource}, and
 * {@link QueueResource} for apps that prefer a single `Resource.*` import surface.
 *
 * @remarks
 * Prefer importing {@link RunResource} / {@link HttpApiResource} / {@link QueueResource}
 * directly when tree-shaking or API clarity matters; this object is a thin alias table.
 *
 * @module Resource
 */

import { RunResource } from "./RunResource";
import { HttpApiResource } from "./HttpApiResource";
import { QueueResource } from "./QueueResource";

/**
 * @public
 */
export const Resource = {
  /** @see {@link RunResource.make} */
  make: RunResource.make,
  /** @see {@link RunResource.makeRunner} */
  makeRunner: RunResource.makeRunner,
  /** @see {@link HttpApiResource.make} */
  makeHttpApiClient: HttpApiResource.make,
  /** @see {@link HttpApiResource.layerEffect} */
  layerHttpApiClient: HttpApiResource.layerEffect,
  /** @see {@link QueueResource.layer} */
  makeQueue: QueueResource.layer,
  /** @see {@link HttpApiResource.acceptJson} */
  acceptJson: HttpApiResource.acceptJson,
} as const;
