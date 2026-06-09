/**
 * RunResource domain tag — `Context.Service` id `@nikscripts/effect-pm/RunResource`.
 *
 * Declared on this module path for Effect `deterministicKeys`. Factory API,
 * types, and {@link runResourceLayer} are exported from {@link ./RunResourceModule}.
 *
 * @module RunResource
 */

import { Context } from "effect";
import type { RunResourceApi } from "./internal/runResource/service";

/**
 * Concurrency-gate domain {@link Context.Service}.
 *
 * @public
 */
export class RunResource extends Context.Service<RunResource, RunResourceApi>()(
  "@nikscripts/effect-pm/RunResource",
) {}
