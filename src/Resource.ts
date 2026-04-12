/**
 * Umbrella namespace: run gate, HTTP API client, queue, and small helpers.
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
  make: RunResource.make,
  makeRunner: RunResource.makeRunner,
  makeHttpApiClient: HttpApiResource.make,
  layerHttpApiClient: HttpApiResource.layerEffect,
  makeQueue: QueueResource.make,
  acceptJson: HttpApiResource.acceptJson,
} as const;
