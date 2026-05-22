/**
 * @deprecated Use {@link Logs} from `@nikscripts/effect-pm/Logs` instead.
 *
 * @module processManagerLogStore
 */

import * as Logs from "./Logs.js";

/** @deprecated Use {@link Logs.sqlitePath}. */
export const groupLogStoreSqlitePath = Logs.sqlitePath;

/** @deprecated Use {@link Logs.layer}. */
export const groupLogStoreLayer = Logs.layer;

/** @deprecated Use {@link Logs.makeRecordedEvent}. */
export const makeGroupLogEntryRecordedEvent = Logs.makeRecordedEvent;

/** @deprecated Use {@link Logs.storeEventQueryFromLogQuery}. */
export const storeEventQueryFromLogQuery = Logs.storeEventQueryFromLogQuery;

/** @deprecated Use {@link Logs.load}. */
export const loadGroupLogEntriesFromStore = Logs.load;

/** @deprecated Use {@link Logs.scopedLoad}. */
export const loadGroupLogEntriesFromSqlite = Logs.scopedLoad;

/** @deprecated Use {@link Logs.query}. */
export const queryGroupLogsFromStore = Logs.query;

/** @deprecated Use {@link Logs.scopedQuery}. */
export const queryGroupLogsFromSqlite = Logs.scopedQuery;

/** @deprecated Use {@link Logs.relayLayer}. */
export const layerWithProcessStore = Logs.relayLayer;
