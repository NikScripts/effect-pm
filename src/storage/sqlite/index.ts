/**
 * SQLite storage adapters for durable queue and history stores.
 *
 * @packageDocumentation
 *
 * ## Import path
 *
 * ```ts
 * import {
 *   SQLiteDurableWorkPoolStore,
 *   SQLiteHistoryStore,
 * } from "hyperlink-ts/storage/sqlite";
 * ```
 *
 * Structured log persistence uses an app {@link Store.Service} with `Node.logs` /
 * toolkit `*.store` registrations and `Store.layer({ filename })`.
 *
 * @module storage/sqlite
 */

export { SQLiteDurableWorkPoolStore } from "./durableWorkPool";
export { SQLiteHistoryStore } from "./historyStore";
