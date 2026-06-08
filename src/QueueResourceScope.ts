/**
 * Queue resource telemetry scopes.
 *
 * @module QueueResourceScope
 */

import { Schema } from "effect";
import { State } from "./State";

export class QueueResourceScope extends State.Scope(
  "@nikscripts/effect-pm/queue/QueueResourceScope",
  "QueueResource",
)({
  queueId: Schema.String,
}) {}

export class QueueEntryScope extends QueueResourceScope.withLeaf("Entry", {
  entryId: Schema.String,
}) {}

export class QueueDedupeKeyScope extends QueueResourceScope.withLeaf("DedupeKey", {
  key: Schema.String,
}) {}

export type QueueResourceScopeLeaf = State.Type.Leaf<typeof QueueResourceScope>;
export type QueueResourceScopeState = State.Type.State<typeof QueueResourceScope>;
export type QueueEntryScopeLeaf = State.Type.Leaf<typeof QueueEntryScope>;
export type QueueEntryScopeState = State.Type.State<typeof QueueEntryScope>;
export type QueueDedupeKeyScopeLeaf = State.Type.Leaf<typeof QueueDedupeKeyScope>;
export type QueueDedupeKeyScopeState = State.Type.State<typeof QueueDedupeKeyScope>;
