/**
 * Process lifecycle scope.
 *
 * @module ProcessLifecycleScope
 */

import { Schema } from "effect";
import { State } from "./State";

export const ProcessLifecycleScope = State.Scope("Process", {
  processId: Schema.String,
})("@nikscripts/effect-pm/process/ProcessLifecycleScope");

export type ProcessLifecycleScopeLeaf = State.Type.Leaf<typeof ProcessLifecycleScope>;
export type ProcessLifecycleScopeState = State.Type.State<typeof ProcessLifecycleScope>;
