/**
 * Log-bucket telemetry scope for {@link LogStore} writes.
 *
 * @module LogScope
 */

import { Schema } from "effect";
import { State } from "./State";

export const LogScope = State.Scope("Log", {
  groupId: Schema.String,
})("@nikscripts/effect-pm/log/LogScope");

export type LogScopeLeaf = State.Type.Leaf<typeof LogScope>;
export type LogScopeState = State.Type.State<typeof LogScope>;
