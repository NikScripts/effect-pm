/**
 * Run resource telemetry scopes.
 *
 * @module RunResourceScope
 */

import { Schema } from "effect";
import { RunResource } from "./internal/runResource/service";
import { State } from "./State";

export class RunResourceScope extends State.Scope(RunResource)({
  resourceId: Schema.String,
}) {}

export class RunScope extends RunResourceScope.withLeaf("Run", {
  runId: Schema.String,
}) {}

export type RunResourceScopeLeaf = State.Type.Leaf<typeof RunResourceScope>;
export type RunResourceScopeState = State.Type.State<typeof RunResourceScope>;
export type RunScopeLeaf = State.Type.Leaf<typeof RunScope>;
export type RunScopeState = State.Type.State<typeof RunScope>;
