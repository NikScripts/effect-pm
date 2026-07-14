/**
 * SQLite storage adapters for durable queue and history stores.
 *
 * @packageDocumentation
 *
 * ## Import path
 *
 * ```ts
 * import {
 *   SQLiteDurableQueueStore,
 *   SQLiteHistoryStore,
 * } from "@nikscripts/effect-pm/storage/sqlite";
 * ```
 *
 * Structured log persistence uses an app {@link Store.Service} with `Node.logs` /
 * toolkit `*.store` registrations and `Store.layer({ filename })`.
 *
 * @module storage/sqlite
 */

export { SQLiteDurableQueueStore } from "./durableQueue";
export { SQLiteHistoryStore } from "./historyStore";
