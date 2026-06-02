/**
 * Queue resource telemetry scopes.
 *
 * @module QueueResourceScope
 */

import { Schema } from "effect";
import { State } from "./State";

export const QueueResourceScope = State.Scope("QueueResource", {
  queueId: Schema.String,
})("@nikscripts/effect-pm/queue/QueueResourceScope");

export const QueueEntryScope = QueueResourceScope.withLeaf("Entry", {
  entryId: Schema.String,
})("@nikscripts/effect-pm/queue/QueueEntryScope");

export const QueueDedupeKeyScope = QueueResourceScope.withLeaf("DedupeKey", {
  key: Schema.String,
})("@nikscripts/effect-pm/queue/QueueDedupeKeyScope");

export type QueueResourceScopeLeaf = State.Type.Leaf<typeof QueueResourceScope>;
export type QueueResourceScopeState = State.Type.State<typeof QueueResourceScope>;
export type QueueEntryScopeLeaf = State.Type.Leaf<typeof QueueEntryScope>;
export type QueueEntryScopeState = State.Type.State<typeof QueueEntryScope>;
export type QueueDedupeKeyScopeLeaf = State.Type.Leaf<typeof QueueDedupeKeyScope>;
export type QueueDedupeKeyScopeState = State.Type.State<typeof QueueDedupeKeyScope>;
