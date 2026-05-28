/**
 * Shared helpers for control panel widgets (no styling dependencies).
 *
 * @module react/controlPanelUtils
 * @internal
 */

import { ControlPlaneRequestError } from "./controlHttp.js";

/** @internal */
export const formatUptime = (ms: number): string => {
  if (ms < 1000) {
    return `${String(ms)}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60)}s`;
};

/** @internal */
export const formatQueueSize = (size: {
  readonly high: number;
  readonly normal: number;
  readonly low: number;
  readonly total: number;
}): string =>
  `total ${String(size.total)} (H${String(size.high)} N${String(size.normal)} L${String(size.low)})`;

/** @internal */
export const toControlPanelErrorMessage = (error: unknown): string =>
  error instanceof ControlPlaneRequestError
    ? error.reason
    : error instanceof globalThis.Error
    ? error.message
    : String(error);
