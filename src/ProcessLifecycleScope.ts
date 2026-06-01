/**
 * Process lifecycle scope.
 *
 * @module ProcessLifecycleScope
 */

import { Schema } from "effect";
import { State } from "./State";

const processLifecycleScopeFields = {
  processId: Schema.String,
} as const;

const ProcessLifecycleScopeBase: State.Scope.Class<
  ProcessLifecycleScope,
  "@nikscripts/effect-pm/process/ProcessLifecycleScope",
  typeof processLifecycleScopeFields
> = State.Scope<ProcessLifecycleScope>()(processLifecycleScopeFields)(
  "@nikscripts/effect-pm/process/ProcessLifecycleScope",
);

/**
 * Scope installed around one process lifecycle transition.
 *
 * @public
 */
export class ProcessLifecycleScope extends ProcessLifecycleScopeBase {}

/**
 * Type helpers for {@link ProcessLifecycleScope}.
 *
 * @public
 */
export declare namespace ProcessLifecycleScope {
  export type Leaf = State.Scope.Leaf<typeof ProcessLifecycleScope>;
  export type State = State.Scope.State<typeof ProcessLifecycleScope>;
}
