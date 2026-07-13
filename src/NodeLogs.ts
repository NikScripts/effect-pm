/**
 * @deprecated Import {@link Logs} instead — `NodeLogs` is a compatibility shim.
 *
 * Node log keys must equal {@link Resource.Node} `.key` — see `docs/LOGS.md`.
 *
 * @module NodeLogs
 */

import type { LogEntry } from "./LogEntry";
import * as Logs from "./Logs";

/** @public */
export type NodeLogEntry = LogEntry;

/** @public */
export const layer = Logs.layer;

/** @public */
export const snapshot = Logs.snapshot;

/** @public */
export const stream = Logs.stream;

/** @public */
export const persistLayer = Logs.persistLayer;

/** @public */
export const byNode = Logs.byNode;

/** @public */
export const byResource = Logs.byResource;

/** @public */
export const Relay = Logs.Relay;

/** @public */
export type LogReadOptions = Logs.LogReadOptions;
