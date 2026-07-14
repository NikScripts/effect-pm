/**
 * Per-tag live stream level stamps for {@link Resource.logs}.
 *
 * @module internal/logs/streamLevel
 * @internal
 */

import type { StoreLogLevel } from "../store/types";

export const logStreamLevelSym = Symbol.for(
  "@nikscripts/effect-pm/Resource/logStreamLevel",
);

/** @internal */
export type StreamLevelCarrier = {
  readonly [logStreamLevelSym]?: StoreLogLevel;
};

/** @internal */
export const streamLevelOf = (tag: StreamLevelCarrier): StoreLogLevel =>
  tag[logStreamLevelSym] ?? "All";
