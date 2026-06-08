/**
 * Process execution scope.
 *
 * @module ProcessScope
 */

import { Schema } from "effect";
import { State } from "./State";

export class ProcessScope extends State.Scope(
  "@nikscripts/effect-pm/process/ProcessScope",
  "Process",
)({
  processId: Schema.String,
  scheduleKey: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  isStartupRun: Schema.Boolean,
}) {}

export type ProcessScopeLeaf = State.Type.Leaf<typeof ProcessScope>;
export type ProcessScopeState = State.Type.State<typeof ProcessScope>;
