/**
 * Log-bucket telemetry scope for {@link LogStore} writes.
 *
 * @module LogScope
 */

import { Schema } from "effect";
import { State } from "./State";

export class LogScope extends State.Scope(
  "@nikscripts/effect-pm/log/LogScope",
  "Log",
)({
  groupId: Schema.String,
}) {}

export type LogScopeLeaf = State.Type.Leaf<typeof LogScope>;
export type LogScopeState = State.Type.State<typeof LogScope>;
