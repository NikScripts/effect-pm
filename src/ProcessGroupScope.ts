/**
 * Process group lifecycle scope.
 *
 * @module ProcessGroupScope
 */

import { Schema } from "effect";
import { State } from "./State";

const processGroupScopeFields = {
  groupId: Schema.String,
} as const;

const ProcessGroupScopeBase: State.Scope.Class<
  ProcessGroupScope,
  "@nikscripts/effect-pm/process/ProcessGroupScope",
  typeof processGroupScopeFields
> = State.Scope<ProcessGroupScope>()(processGroupScopeFields)(
  "@nikscripts/effect-pm/process/ProcessGroupScope",
);

/**
 * Scope installed around process-group lifecycle telemetry.
 *
 * @public
 */
export class ProcessGroupScope extends ProcessGroupScopeBase {}

const processGroupMemberScopeFields = {
  processId: Schema.String,
} as const;

const ProcessGroupMemberScopeBase: State.Scope.AnyClass<
  ProcessGroupMemberScope,
  { readonly processId: string },
  ProcessGroupScope
> =
  ProcessGroupScope.withLeaf<ProcessGroupMemberScope>()(
  "Member",
  processGroupMemberScopeFields,
  )("@nikscripts/effect-pm/process/ProcessGroupMemberScope");

/**
 * Scope installed around one process member lifecycle transition.
 *
 * @public
 */
export class ProcessGroupMemberScope extends ProcessGroupMemberScopeBase {}

/**
 * Type helpers for {@link ProcessGroupScope}.
 *
 * @public
 */
export declare namespace ProcessGroupScope {
  export type Leaf = State.Scope.Leaf<typeof ProcessGroupScope>;
  export type State = State.Scope.State<typeof ProcessGroupScope>;
}

/**
 * Type helpers for {@link ProcessGroupMemberScope}.
 *
 * @public
 */
export declare namespace ProcessGroupMemberScope {
  export type Leaf = State.Scope.Leaf<typeof ProcessGroupMemberScope>;
  export type State = State.Scope.State<typeof ProcessGroupMemberScope>;
}
