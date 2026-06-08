/**
 * Aggregated domain service tags for **external** consumers — the public entry
 * point for cross-module tag references (e.g. `ProcessStore` filter inputs).
 *
 * `Tag.RunResource` is a `Context.Service` class (id
 * `@nikscripts/effect-pm/RunResource`). In-repo modules import the class
 * directly from its service module; this aggregator is for downstream apps.
 *
 * @module Tags
 */

import { RunResource } from "./internal/runResource/kernel";

/**
 * Domain tag namespace.
 *
 * @public
 */
export const Tag = {
  RunResource,
} as const;

/** @public */
export declare namespace Tag {
  export type RunResource = import("./internal/runResource/service").RunResource;
}
