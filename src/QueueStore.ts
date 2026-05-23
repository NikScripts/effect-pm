/**
 * Re-exports the queue facet of {@link ProcessStoreInterface} for ergonomic imports.
 *
 * @remarks
 * Prefer `const { QueueStore } = yield* ProcessStore` when you already have the store.
 * These top-level helpers delegate to `store.QueueStore` via {@link ProcessStore}.
 *
 * @module QueueStore
 */

import { Effect } from "effect";
import type { RuntimeRecordQuery } from "./Query.js";
import {
  ProcessStore,
  type ProcessStoreQueueResourceDedupeKeyInput,
  type ProcessStoreQueueResourceEntryInput,
  type ProcessStoreQueueResourceLifecycleInput,
  type QueueStoreApi,
} from "./ProcessStore.js";

export type { QueueStoreApi };

export const withQueue = <A, E, R>(queueId: string, use: Effect.Effect<A, E, R>) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.withQueue(queueId, use));

export const withEntry = <A, E, R>(entryId: string, use: Effect.Effect<A, E, R>) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.withEntry(entryId, use));

export const withBatch = <A, E, R>(batchId: string, use: Effect.Effect<A, E, R>) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.withBatch(batchId, use));

export const withDedupeKey = <A, E, R>(key: string, use: Effect.Effect<A, E, R>) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.withDedupeKey(key, use));

export const entryEnqueued = (input?: ProcessStoreQueueResourceEntryInput) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.entryEnqueued(input));

export const entryStarted = (input?: ProcessStoreQueueResourceEntryInput) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.entryStarted(input));

export const entryCompleted = (input?: ProcessStoreQueueResourceEntryInput) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.entryCompleted(input));

export const entryFailed = (input?: ProcessStoreQueueResourceEntryInput) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.entryFailed(input));

export const entryRetried = (input?: ProcessStoreQueueResourceEntryInput) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.entryRetried(input));

export const entryExhausted = (input?: ProcessStoreQueueResourceEntryInput) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.entryExhausted(input));

export const lifecycleChanged = (input: ProcessStoreQueueResourceLifecycleInput) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.lifecycleChanged(input));

export const dedupeKeyAdded = (input?: ProcessStoreQueueResourceDedupeKeyInput) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.dedupeKeyAdded(input));

export const dedupeKeyReleased = (input?: ProcessStoreQueueResourceDedupeKeyInput) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.dedupeKeyReleased(input));

export const dedupeKeyHydrated = (input?: ProcessStoreQueueResourceDedupeKeyInput) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.dedupeKeyHydrated(input));

export const entries = (queueId?: string, query?: RuntimeRecordQuery) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.entries(queueId, query));

export const entry = (entryId: string, query?: RuntimeRecordQuery) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.entry(entryId, query));

export const entriesByKey = (key: string, query?: RuntimeRecordQuery) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.entriesByKey(key, query));

export const dedupeKeys = (queueId?: string, query?: RuntimeRecordQuery) =>
  Effect.flatMap(ProcessStore, (store) => store.QueueStore.dedupeKeys(queueId, query));
