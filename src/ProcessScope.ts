/**
 * Process execution scope.
 *
 * @module ProcessScope
 */

import { Schema } from "effect";
import { State } from "./State";

export const ProcessScope = State.Scope("Process", {
  processId: Schema.String,
  scheduleKey: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  isStartupRun: Schema.Boolean,
})("@nikscripts/effect-pm/process/ProcessScope");

export type ProcessScopeLeaf = State.Type.Leaf<typeof ProcessScope>;
export type ProcessScopeState = State.Type.State<typeof ProcessScope>;
