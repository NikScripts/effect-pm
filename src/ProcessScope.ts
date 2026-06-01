/**
 * Process execution scope.
 *
 * @module ProcessScope
 */

import { Schema } from "effect";
import { State } from "./State";

const processScopeFields = {
  processId: Schema.String,
  scheduleKey: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  isStartupRun: Schema.Boolean,
} as const;

const ProcessScopeBase: State.Scope.Class<
  ProcessScope,
  "@nikscripts/effect-pm/process/ProcessScope",
  typeof processScopeFields
> = State.Scope<ProcessScope>()(processScopeFields)(
  "@nikscripts/effect-pm/process/ProcessScope",
);

/**
 * Scope installed around one supervised process run.
 *
 * @public
 */
export class ProcessScope extends ProcessScopeBase {}

/**
 * Type helpers for {@link ProcessScope}.
 *
 * @public
 */
export declare namespace ProcessScope {
  export type Leaf = State.Scope.Leaf<typeof ProcessScope>;
  export type State = State.Scope.State<typeof ProcessScope>;
}
