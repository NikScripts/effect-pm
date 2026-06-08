/**
 * Run resource telemetry scopes.
 *
 * @module RunResourceScope
 */

import { Schema } from "effect";
import { TypeTag as RunResourceTag } from "./RunResourceIdentity";
import { State } from "./State";

export const RunResourceScope = State.Scope(RunResourceTag, {
  resourceId: Schema.String,
})(RunResourceTag);

export const RunScope = RunResourceScope.withLeaf("Run", {
  runId: Schema.String,
})("@nikscripts/effect-pm/run/RunScope");

export type RunResourceScopeLeaf = State.Type.Leaf<typeof RunResourceScope>;
export type RunResourceScopeState = State.Type.State<typeof RunResourceScope>;
export type RunScopeLeaf = State.Type.Leaf<typeof RunScope>;
export type RunScopeState = State.Type.State<typeof RunScope>;
