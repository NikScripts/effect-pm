/**
 * {@link Resource.logStreamLevel} — stamp a live-relay floor on a tag for {@link Resource.logs}.
 *
 * @module internal/logs/resourceStreamLevel
 * @internal
 */

import type { StoreLogLevel } from "../store/types";
import { logStreamLevelSym, type StreamLevelCarrier } from "./streamLevel";

/**
 * Stamp `level` onto a tag for {@link Resource.logs} stream filtering.
 *
 * @category spec fields
 * @public
 */
export const logStreamLevel =
  (level: StoreLogLevel) =>
  <Tag extends object>(tag: Tag): Tag & StreamLevelCarrier =>
    Object.assign(tag, { [logStreamLevelSym]: level }) as Tag & StreamLevelCarrier;

/**
 *
 * @category spec fields
 * @public
 */
export const logStreamLevelAll = logStreamLevel("All");
/**
 *
 * @category spec fields
 * @public
 */
export const logStreamLevelDebug = logStreamLevel("Debug");
/**
 *
 * @category spec fields
 * @public
 */
export const logStreamLevelInfo = logStreamLevel("Info");
/**
 *
 * @category spec fields
 * @public
 */
export const logStreamLevelWarn = logStreamLevel("Warn");
/**
 *
 * @category spec fields
 * @public
 */
export const logStreamLevelError = logStreamLevel("Error");
/**
 *
 * @category spec fields
 * @public
 */
export const logStreamLevelNone = logStreamLevel("None");
