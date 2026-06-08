/**
 * Process group lifecycle scope.
 *
 * @module ProcessGroupScope
 */

import { Schema } from "effect";
import { State } from "./State";

export class ProcessGroupScope extends State.Scope(
  "@nikscripts/effect-pm/process/ProcessGroupScope",
  "Process",
)({
  groupId: Schema.String,
}) {}

export class ProcessGroupMemberScope extends ProcessGroupScope.withLeaf("Member", {
  processId: Schema.String,
}) {}

export type ProcessGroupScopeLeaf = State.Type.Leaf<typeof ProcessGroupScope>;
export type ProcessGroupScopeState = State.Type.State<typeof ProcessGroupScope>;
export type ProcessGroupMemberScopeLeaf = State.Type.Leaf<typeof ProcessGroupMemberScope>;
export type ProcessGroupMemberScopeState = State.Type.State<typeof ProcessGroupMemberScope>;
