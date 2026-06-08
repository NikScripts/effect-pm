/**
 * Process lifecycle scope.
 *
 * @module ProcessLifecycleScope
 */

import { Schema } from "effect";
import { State } from "./State";

export class ProcessLifecycleScope extends State.Scope(
  "@nikscripts/effect-pm/process/ProcessLifecycleScope",
  "Process",
)({
  processId: Schema.String,
}) {}

export type ProcessLifecycleScopeLeaf = State.Type.Leaf<typeof ProcessLifecycleScope>;
export type ProcessLifecycleScopeState = State.Type.State<typeof ProcessLifecycleScope>;
