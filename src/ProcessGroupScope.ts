/**
 * Process group lifecycle scope.
 *
 * @module ProcessGroupScope
 */

import { Schema } from "effect";
import { State } from "./State";

export const ProcessGroupScope = State.Scope("Process", {
  groupId: Schema.String,
})("@nikscripts/effect-pm/process/ProcessGroupScope");

export const ProcessGroupMemberScope = ProcessGroupScope.withLeaf("Member", {
  processId: Schema.String,
})("@nikscripts/effect-pm/process/ProcessGroupMemberScope");

export type ProcessGroupScopeLeaf = State.Type.Leaf<typeof ProcessGroupScope>;
export type ProcessGroupScopeState = State.Type.State<typeof ProcessGroupScope>;
export type ProcessGroupMemberScopeLeaf = State.Type.Leaf<typeof ProcessGroupMemberScope>;
export type ProcessGroupMemberScopeState = State.Type.State<typeof ProcessGroupMemberScope>;
