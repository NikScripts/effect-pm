/**
 * {@link Resource.logStreamLevel} — stamp a live-relay floor on a tag for {@link Resource.logs}.
 *
 * @module internal/logs/resourceStreamLevel
 * @internal
 */

import type { StoreLogLevel } from "../store/types";
import { logStreamLevelSym, type StreamLevelCarrier } from "./streamLevel";

/** Stamp `level` onto a tag for {@link Resource.logs} stream filtering. @public */
export const logStreamLevel =
  (level: StoreLogLevel) =>
  <Tag extends StreamLevelCarrier>(tag: Tag): Tag =>
    Object.assign(tag, { [logStreamLevelSym]: level });

/** @public */
export const logStreamLevelAll = logStreamLevel("All");
/** @public */
export const logStreamLevelDebug = logStreamLevel("Debug");
/** @public */
export const logStreamLevelInfo = logStreamLevel("Info");
/** @public */
export const logStreamLevelWarn = logStreamLevel("Warn");
/** @public */
export const logStreamLevelError = logStreamLevel("Error");
/** @public */
export const logStreamLevelNone = logStreamLevel("None");
